// Smoke test for the built wasm: loads it via the Node entrypoint with a
// stubbed fetch, exercises the JS<->wasm boundary, and asserts the fetch path
// builds the right request. Run after ./wasm/build.sh:
//   node wasm/smoke-test.mjs
import assert from "node:assert/strict";

const calls = [];
const canned = {
  total_count: 2,
  items: [
    { id: "loc_1", name: "Joe's Pizza", city: "Columbia", state: "MO", country: "USA" },
    { id: "loc_2", name: "Shakespeare's Pizza", city: "Columbia", state: "MO" },
  ],
};

globalThis.fetch = async (url, init = {}) => {
  const h = init.headers || {};
  const get = (n) => (typeof h.get === "function" ? h.get(n) : h[n]);
  calls.push({ url: String(url), method: init.method, apiKey: get("x-api-key") });
  return new Response(JSON.stringify(canned), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { createBrightLocal } = await import(new URL("./node.js", import.meta.url));
const bl = await createBrightLocal();

// version() — synchronous JS<->wasm round trip.
const v = bl.version();
assert.ok(typeof v.version === "string" && v.version.length > 0, "version() returns a version");

// locationsSearch() — async path through the wasm fetch transport.
const res = await bl.locationsSearch("test-key-abc", { query: "Columbia, MO", limit: 5 });
assert.equal(res.total_count, 2, "parsed total_count");
assert.equal(res.items[0].name, "Joe's Pizza", "parsed nested item");
assert.equal(calls.length, 1, "exactly one fetch");
assert.match(calls[0].url, /\/data\/v1\/locations\/search$/, "correct URL");
assert.equal(calls[0].method, "POST", "POST");
assert.equal(calls[0].apiKey, "test-key-abc", "x-api-key forwarded");

// Validation errors reject.
await assert.rejects(() => bl.locationsSearch("k", { query: "" }), /query is required/);
await assert.rejects(() => bl.locationsSearch("", { query: "x" }), /apiKey is required/);

console.log("smoke test passed:", JSON.stringify(v));
