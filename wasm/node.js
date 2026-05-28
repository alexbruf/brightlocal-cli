// Node.js entrypoint.
//
// Node cannot import `.wasm` as a module, so read the bytes from disk and
// compile a `WebAssembly.Module` once.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { instantiate } from "./runtime.js";

let modulePromise = null;

function loadModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasmPath = fileURLToPath(new URL("./brightlocal.wasm", import.meta.url));
      const bytes = await readFile(wasmPath);
      return new WebAssembly.Module(bytes);
    })();
  }
  return modulePromise;
}

/** @returns {Promise<import("./index.js").BrightLocal>} */
export async function createBrightLocal() {
  const module = await loadModule();
  return instantiate(module);
}
