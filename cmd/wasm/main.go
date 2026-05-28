//go:build js && wasm

// Command wasm is the WebAssembly entrypoint for brightlocal-cli.
//
// It does not run the Kong CLI. Instead it exposes the BrightLocal API
// surface (locations search, rankings check/get) as JavaScript-callable
// functions on a global `__brightlocal` object. Each function returns a
// Promise so the host can `await` it.
//
// Built with `GOOS=js GOARCH=wasm`, Go's net/http transport is implemented
// on top of the host `fetch()` API. That is exactly what Cloudflare Workers
// (and browsers/Node) provide, so outbound API calls work without sockets.
//
// The OS keyring/credential storage used by the native CLI is intentionally
// not compiled in: in a Worker the API key comes from the JS host (env
// binding) and is passed into each call.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/builtbyrobben/brightlocal-cli/internal/brightlocal"
)

// Build metadata, injectable via -ldflags "-X main.buildVersion=...".
var (
	buildVersion = "dev"
	buildCommit  = ""
	buildDate    = ""
)

func main() {
	api := map[string]any{
		"locationsSearch": js.FuncOf(locationsSearch),
		"rankingsCheck":   js.FuncOf(rankingsCheck),
		"rankingsGet":     js.FuncOf(rankingsGet),
		"version":         js.FuncOf(version),
		"ready":           true,
	}
	js.Global().Set("__brightlocal", js.ValueOf(api))

	// Park the main goroutine forever so the runtime stays alive and the
	// registered functions remain callable. If main returned, the Go runtime
	// would exit and any later call would throw "Go program has already exited".
	select {}
}

// locationsSearch(apiKey: string, optionsJSON: string) => Promise<string>
//
// optionsJSON is a JSON object: { query, country?, limit? }.
// Resolves with a JSON string of the LocationSearchResponse.
func locationsSearch(_ js.Value, args []js.Value) any {
	apiKey, optsJSON, err := twoStringArgs(args)
	if err != nil {
		return rejectedPromise(err)
	}

	return promise(func() (any, error) {
		var req brightlocal.LocationSearchRequest
		if err := unmarshalOpts(optsJSON, &req); err != nil {
			return nil, err
		}

		client := brightlocal.NewClient(apiKey)
		res, err := client.Locations().Search(context.Background(), req)
		if err != nil {
			return nil, err
		}

		return marshalJSON(res)
	})
}

// rankingsCheck(apiKey: string, optionsJSON: string) => Promise<string>
//
// optionsJSON is a JSON object: { business_name, location, search_terms }.
// Resolves with a JSON string of the RankingsCheckResponse.
func rankingsCheck(_ js.Value, args []js.Value) any {
	apiKey, optsJSON, err := twoStringArgs(args)
	if err != nil {
		return rejectedPromise(err)
	}

	return promise(func() (any, error) {
		var req brightlocal.RankingsCheckRequest
		if err := unmarshalOpts(optsJSON, &req); err != nil {
			return nil, err
		}

		client := brightlocal.NewClient(apiKey)
		res, err := client.Rankings().Check(context.Background(), req)
		if err != nil {
			return nil, err
		}

		return marshalJSON(res)
	})
}

// rankingsGet(apiKey: string, requestID: string) => Promise<string>
//
// Resolves with a JSON string of the RankingsGetResponse.
func rankingsGet(_ js.Value, args []js.Value) any {
	apiKey, requestID, err := twoStringArgs(args)
	if err != nil {
		return rejectedPromise(err)
	}

	return promise(func() (any, error) {
		client := brightlocal.NewClient(apiKey)
		res, err := client.Rankings().Get(context.Background(), requestID)
		if err != nil {
			return nil, err
		}

		return marshalJSON(res)
	})
}

// version() => string (JSON: { version, commit, date }).
func version(_ js.Value, _ []js.Value) any {
	s, _ := marshalJSON(map[string]string{
		"version": buildVersion,
		"commit":  buildCommit,
		"date":    buildDate,
	})
	return s
}

// twoStringArgs validates and extracts the (apiKey, second) string arguments
// common to every exported function.
func twoStringArgs(args []js.Value) (string, string, error) {
	if len(args) < 2 {
		return "", "", fmt.Errorf("expected 2 arguments, got %d", len(args))
	}

	apiKey := args[0].String()
	if apiKey == "" {
		return "", "", fmt.Errorf("apiKey is required")
	}

	return apiKey, args[1].String(), nil
}

func unmarshalOpts(optsJSON string, v any) error {
	if optsJSON == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(optsJSON), v); err != nil {
		return fmt.Errorf("parse options: %w", err)
	}
	return nil
}

func marshalJSON(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("encode response: %w", err)
	}
	return string(b), nil
}

// promise runs fn on a goroutine and returns a JS Promise that resolves with
// fn's value or rejects with a JS Error. The executor must not block, so the
// HTTP work happens in the goroutine.
func promise(fn func() (any, error)) any {
	executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			res, err := fn()
			if err != nil {
				reject.Invoke(jsError(err))
				return
			}
			resolve.Invoke(res)
		}()
		return nil
	})
	return js.Global().Get("Promise").New(executor)
}

// rejectedPromise returns an already-rejected Promise for synchronous
// validation failures.
func rejectedPromise(err error) any {
	return js.Global().Get("Promise").Call("reject", jsError(err))
}

func jsError(err error) js.Value {
	return js.Global().Get("Error").New(err.Error())
}
