// Vercel Edge Runtime / Next.js edge entrypoint.
//
// The `?module` import query asks the bundler (webpack/turbopack) to provide a
// compiled `WebAssembly.Module` rather than a URL or bytes.

import wasmModule from "./brightlocal.wasm?module";
import { instantiate } from "./runtime.js";

/** @returns {Promise<import("./index.js").BrightLocal>} */
export function createBrightLocal() {
  return instantiate(wasmModule);
}

export { wasmModule };
