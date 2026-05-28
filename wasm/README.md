# @viewengine/brightlocal-wasm

The BrightLocal API client from `brightlocal-cli`, compiled to WebAssembly and
wrapped for JavaScript. Runs in **Cloudflare Workers**, **Node.js**, and **edge
runtimes** (Vercel Edge / Next.js).

It exposes the API surface as async functions — it does **not** run the Kong CLI
or use the OS keyring. You pass the API key into each call (in a Worker, from an
`env` binding / secret).

## How it works

Built with **TinyGo** (`-target=wasm`), not standard Go — standard Go bakes its
whole runtime + GC into every binary (~2.6 MB gzipped floor), while TinyGo lands
around **352 KB raw / 150 KB gzipped**.

TinyGo's `net/http` client can't talk over `fetch`, so `internal/api`'s
transport is swapped at build time: `client.go` is tagged `//go:build !tinygo`
and `client_tinygo.go` (tagged `tinygo`) reimplements the same `Get`/`Post`
surface directly on the host **`fetch()`** API. `internal/brightlocal` is
unchanged and works with either. The **asyncify** scheduler keeps goroutines, so
the transport can block on a channel while the JS event loop drives the fetch
Promise — callers keep the same synchronous-looking API.

`cmd/wasm/main.go` registers an object on `globalThis.__brightlocal` and parks
(`select {}`) so the functions stay callable for the life of the isolate.
`runtime.js` instantiates the module once per isolate and wraps the boundary
(JSON in, JSON out, Promises). `wasm_exec.js` is TinyGo's runtime shim, patched
for Workers (see below).

## Install / build

The artifacts (`brightlocal.wasm`, `wasm_exec.js`) are **generated**, not checked
in (see `.gitignore`). Build them with:

```bash
./wasm/build.sh
```

Requires **TinyGo** (`brew tap tinygo-org/tools && brew install tinygo`) and Go
1.25+. `wasm-opt` (binaryen), if present, shaves a few more KB. The script also
runs `patch-wasm-exec.mjs`, which strips Node-only paths from TinyGo's
`wasm_exec.js` (bare `global`, `require`, `node:` builtins, a CLI auto-run
block) that esbuild/wrangler otherwise mishandles — without the patch the Worker
crashes at startup with "Maximum call stack size exceeded".

`npm publish` still ships the artifacts because they're listed in `package.json`
`files`.

## Maintenance: tracking upstream

This wasm layer is designed to stay cleanly mergeable with the upstream Go repo
([`Robben-Media/brightlocal-cli`](https://github.com/Robben-Media/brightlocal-cli)).
The design choices that make upstream PRs "merge down" without conflicts:

- **The wasm binding only *consumes* upstream code.** `cmd/wasm/main.go` calls
  `internal/brightlocal` — it never edits it. When upstream changes the client
  (new endpoints, changed types, bug fixes), you `git merge` and rebuild; the
  changes flow through for free.
- **Everything new lives in new files** — `cmd/wasm/` and `wasm/`. Upstream
  doesn't have these paths, so they can never conflict on merge.
- **Only two upstream files are touched**, both minimally: `.gitignore`
  (append-only) and a single `//go:build !tinygo` line atop
  `internal/api/client.go` (so the TinyGo transport in `client_tinygo.go` can
  replace it). Both are different regions from where upstream typically edits, so
  conflicts are unlikely and trivial to resolve. The build lives in
  `wasm/build.sh`, not the Makefile, so the Makefile stays identical to upstream.
- **`go.mod` / `go.sum` are untouched**, so there are no dependency conflicts.

### Sync workflow

```bash
# one-time: point origin at your fork, add upstream
git remote add upstream https://github.com/Robben-Media/brightlocal-cli.git

# each time upstream merges PRs:
git fetch upstream
git merge upstream/main      # conflict-free except possibly .gitignore
./wasm/build.sh              # rebuild the wasm from the updated client
```

If upstream changes the client's public API (e.g. renames a method), the **Go
compiler** points at what to fix — `cmd/wasm/main.go` and, if the transport
signatures changed, `internal/api/client_tinygo.go`. That's the only
hand-maintenance this layer needs.

## API

```ts
const bl = await createBrightLocal();

bl.version(): { version, commit, date }                 // sync, no network
bl.locationsSearch(apiKey, { query, country?, limit? }) // Promise
bl.rankingsCheck(apiKey, { business_name, location, search_terms }) // Promise
bl.rankingsGet(apiKey, requestId)                       // Promise
```

Errors (validation or API errors like `API error (401): Unauthorized`) reject
the returned Promise.

## Cloudflare Workers

```js
import { createBrightLocal } from "@viewengine/brightlocal-wasm"; // resolves to ./workerd.js

export default {
  async fetch(request, env) {
    const bl = await createBrightLocal();
    const res = await bl.locationsSearch(env.BRIGHTLOCAL_API_KEY, {
      query: "Columbia, MO",
      limit: 10,
    });
    return Response.json(res);
  },
};
```

`wrangler.toml` must declare the wasm as a compiled module:

```toml
[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
```

A complete, runnable example is in [`examples/worker`](./examples/worker).
Provide the key via `wrangler secret put BRIGHTLOCAL_API_KEY` (or `.dev.vars`
for local dev). Call `createBrightLocal()` inside the request handler, not at
module top level.

## Node.js

```js
import { createBrightLocal } from "@viewengine/brightlocal-wasm/node";
const bl = await createBrightLocal();
```

See [`examples/node-example.mjs`](./examples/node-example.mjs). The TinyGo
transport calls the host's global `fetch` directly (Node 18+ provides it), so no
environment-specific workaround is needed.

## Edge runtimes (Vercel / Next.js)

```js
import { createBrightLocal } from "@viewengine/brightlocal-wasm/edge-light";
```

Uses the `./brightlocal.wasm?module` import convention so the bundler provides a
`WebAssembly.Module`.

## Notes & limitations

- **Size:** ~352 KB raw / ~150 KB gzipped (TinyGo `-opt=z -panic=trap`, plus
  `wasm-opt` if available). Well under the Workers free tier (3 MiB compressed).
- **`-panic=trap`:** Go panics become unrecoverable wasm traps (no message) to
  save size. Normal errors are returned values, not panics, so this only affects
  unexpected bugs — at which point the isolate is recycled.
- **Per-isolate runtime:** one runtime per isolate, shared across concurrent
  requests (the asyncify scheduler interleaves them). The API key is per-call,
  so there's no shared auth state.
- **`conservative` GC**, not `leaking` — memory is reclaimed, so long-lived
  Worker isolates don't grow unbounded across requests.
- The native CLI's keyring/credential storage and interactive prompts are not
  compiled into the wasm build.
