// Cloudflare Workers / workerd entrypoint.
//
// Wrangler resolves a `.wasm` import to a compiled `WebAssembly.Module`, which
// is exactly what `instantiate` expects. Call `createBrightLocal()` inside your
// fetch handler (not at module top level) and await it.

import wasmModule from "./brightlocal.wasm";
import { instantiate } from "./runtime.js";

/** @returns {Promise<import("./index.js").BrightLocal>} */
export function createBrightLocal() {
  return instantiate(wasmModule);
}

export { wasmModule };
