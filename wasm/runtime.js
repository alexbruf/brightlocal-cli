// Shared runtime for the brightlocal-cli WebAssembly build.
//
// Go's `js/wasm` target runs `main()` to completion via wasm_exec.js. Our
// main() registers an object on `globalThis.__brightlocal` and then parks
// forever (Go `select {}`), so the registered functions stay callable for the
// life of the isolate. Each registered function returns a Promise and speaks
// JSON over the boundary; this module wraps them into an ergonomic JS API.

import "./wasm_exec.js"; // side effect: defines globalThis.Go

let cachedApiPromise = null;

/**
 * Instantiate the Go wasm runtime from an already-compiled WebAssembly.Module
 * and return the wrapped BrightLocal API. Cached per isolate so the Go runtime
 * is created at most once.
 *
 * @param {WebAssembly.Module} module
 */
export function instantiate(module) {
  if (!cachedApiPromise) {
    cachedApiPromise = doInstantiate(module).catch((err) => {
      // Reset on failure so a later call can retry.
      cachedApiPromise = null;
      throw err;
    });
  }
  return cachedApiPromise;
}

async function doInstantiate(module) {
  if (typeof globalThis.Go !== "function") {
    throw new Error("wasm_exec.js did not define globalThis.Go");
  }

  const go = new globalThis.Go();
  const instance = await WebAssembly.instantiate(module, go.importObject);

  // Do NOT await: main() parks on `select {}` and never resolves. Its
  // synchronous portion (which registers globalThis.__brightlocal) runs during
  // this call. The asyncify scheduler keeps the runtime alive afterward so the
  // registered functions remain callable. The fetch-based transport
  // (internal/api/client_tinygo.go) calls the host's global fetch() directly,
  // so there's no Node-vs-Workers detection to work around.
  go.run(instance);

  const api = await waitForApi();
  return wrap(api);
}

async function waitForApi() {
  // main() registers __brightlocal synchronously during go.run, but yield a
  // few microtasks defensively to tolerate runtime differences.
  for (let i = 0; i < 1000; i += 1) {
    const api = globalThis.__brightlocal;
    if (api && api.ready) {
      return api;
    }
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
  throw new Error("Go wasm did not initialize: globalThis.__brightlocal is missing");
}

function wrap(api) {
  const callJSON = async (fn, apiKey, options) => {
    if (!apiKey) {
      throw new Error("apiKey is required");
    }
    const payload = typeof options === "string" ? options : JSON.stringify(options ?? {});
    const json = await fn(apiKey, payload);
    return JSON.parse(json);
  };

  return {
    /**
     * Search for locations.
     * @param {string} apiKey
     * @param {{ query: string, country?: string, limit?: number }} options
     */
    locationsSearch: (apiKey, options) => callJSON(api.locationsSearch, apiKey, options),

    /**
     * Check local search rankings for a business.
     * @param {string} apiKey
     * @param {{ business_name: string, location: string, search_terms: string[] }} options
     */
    rankingsCheck: (apiKey, options) => callJSON(api.rankingsCheck, apiKey, options),

    /**
     * Get rankings results by request ID.
     * @param {string} apiKey
     * @param {string} requestId
     */
    rankingsGet: async (apiKey, requestId) => {
      if (!apiKey) {
        throw new Error("apiKey is required");
      }
      const json = await api.rankingsGet(apiKey, String(requestId ?? ""));
      return JSON.parse(json);
    },

    /** Build metadata: { version, commit, date }. */
    version: () => JSON.parse(api.version()),
  };
}
