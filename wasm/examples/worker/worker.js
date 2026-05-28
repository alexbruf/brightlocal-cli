// Example Cloudflare Worker using the brightlocal-cli wasm build.
//
// The API key comes from an env binding (secret), never from a keyring.
// Routes:
//   GET /version                      -> build metadata (no API call)
//   GET /locations?query=Columbia,%20MO[&country=USA&limit=10]
//   GET /rankings?business=...&location=...&terms=pizza,best%20pizza
//   GET /rankings/:requestId
//
// In Workers there is no `process` global and `fetch` is available, so Go's
// net/http transport routes outbound calls through the runtime's fetch().

import { createBrightLocal } from "../../workerd.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // createBrightLocal() is cached per isolate; cheap to call every request.
    const bl = await createBrightLocal();

    if (url.pathname === "/version") {
      return Response.json(bl.version());
    }

    const apiKey = env.BRIGHTLOCAL_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "BRIGHTLOCAL_API_KEY is not set (wrangler secret put BRIGHTLOCAL_API_KEY)" },
        { status: 500 },
      );
    }

    try {
      if (url.pathname === "/locations") {
        const query = url.searchParams.get("query");
        if (!query) {
          return Response.json({ error: "query is required" }, { status: 400 });
        }
        const res = await bl.locationsSearch(apiKey, {
          query,
          country: url.searchParams.get("country") || undefined,
          limit: Number(url.searchParams.get("limit")) || undefined,
        });
        return Response.json(res);
      }

      if (url.pathname === "/rankings") {
        const res = await bl.rankingsCheck(apiKey, {
          business_name: url.searchParams.get("business") || "",
          location: url.searchParams.get("location") || "",
          search_terms: (url.searchParams.get("terms") || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        });
        return Response.json(res);
      }

      const rankingsGet = url.pathname.match(/^\/rankings\/(.+)$/);
      if (rankingsGet) {
        const res = await bl.rankingsGet(apiKey, rankingsGet[1]);
        return Response.json(res);
      }
    } catch (err) {
      return Response.json({ error: String(err?.message ?? err) }, { status: 502 });
    }

    return Response.json(
      { routes: ["/version", "/locations?query=", "/rankings?business=&location=&terms=", "/rankings/:requestId"] },
      { status: 404 },
    );
  },
};
