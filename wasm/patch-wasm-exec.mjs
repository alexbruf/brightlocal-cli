// Patch TinyGo's wasm_exec.js to be Cloudflare Workers / bundler safe.
//
// TinyGo's shim targets Node/browser: it uses bare `global`, captures `require`,
// pulls node: builtins, and auto-runs a CLI block referencing `module`. esbuild
// (wrangler) mishandles these and the worker crashes at startup with
// "Maximum call stack size exceeded". Workers/Node18+/browsers all provide the
// web globals the shim needs (crypto, performance, Text(En|De)coder), so we
// strip the Node-only paths and just alias `global = globalThis`.
//
// Invoked by build.sh after copying the shim. Each replacement is asserted, so
// a future TinyGo layout change fails the build loudly instead of silently
// producing a broken shim.

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node patch-wasm-exec.mjs <wasm_exec.js>");
  process.exit(1);
}

let src = readFileSync(path, "utf8");

const replacements = [
  {
    name: "env detection -> globalThis alias",
    from: `	if (typeof global !== "undefined") {
		// global already exists
	} else if (typeof window !== "undefined") {
		window.global = window;
	} else if (typeof self !== "undefined") {
		self.global = self;
	} else {
		throw new Error("cannot export Go (neither global, window nor self is defined)");
	}

	if (!global.require && typeof require !== "undefined") {
		global.require = require;
	}

	if (!global.fs && global.require) {
		global.fs = require("node:fs");
	}`,
    to: `	// Patched for Cloudflare Workers / bundlers: use globalThis directly and
	// drop Node-only environment detection (bare global, require, node:fs).
	const global = globalThis;`,
  },
  {
    name: "node: require polyfills -> web-global asserts",
    from: `	if (!global.crypto) {
		const nodeCrypto = require("node:crypto");
		global.crypto = {
			getRandomValues(b) {
				nodeCrypto.randomFillSync(b);
			},
		};
	}

	if (!global.performance) {
		global.performance = {
			now() {
				const [sec, nsec] = process.hrtime();
				return sec * 1000 + nsec / 1000000;
			},
		};
	}

	if (!global.TextEncoder) {
		global.TextEncoder = require("node:util").TextEncoder;
	}

	if (!global.TextDecoder) {
		global.TextDecoder = require("node:util").TextDecoder;
	}`,
    to: `	if (!global.crypto) {
		throw new Error("globalThis.crypto is required (crypto.getRandomValues)");
	}

	if (!global.performance) {
		throw new Error("globalThis.performance is required (performance.now)");
	}

	if (!global.TextEncoder) {
		throw new Error("globalThis.TextEncoder is required");
	}

	if (!global.TextDecoder) {
		throw new Error("globalThis.TextDecoder is required");
	}`,
  },
  {
    name: "remove Node CLI auto-run block",
    from: `	if (
		global.require &&
		global.require.main === module &&
		global.process &&
		global.process.versions &&
		!global.process.versions.electron
	) {
		if (process.argv.length != 3) {
			console.error("usage: go_js_wasm_exec [wasm binary] [arguments]");
			process.exit(1);
		}

		const go = new Go();
		WebAssembly.instantiate(fs.readFileSync(process.argv[2]), go.importObject).then(async (result) => {
			let exitCode = await go.run(result.instance);
			process.exit(exitCode);
		}).catch((err) => {
			console.error(err);
			process.exit(1);
		});
	}
})();`,
    to: `})();`,
  },
];

for (const { name, from, to } of replacements) {
  if (!src.includes(from)) {
    console.error(`patch failed: could not find block "${name}".`);
    console.error("TinyGo's wasm_exec.js layout may have changed; update patch-wasm-exec.mjs.");
    process.exit(1);
  }
  src = src.replace(from, to);
}

writeFileSync(path, src);
console.log("patched wasm_exec.js for Workers");
