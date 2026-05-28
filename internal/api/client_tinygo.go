//go:build tinygo

// TinyGo build of the API client. TinyGo's net/http client doesn't support the
// js/wasm fetch transport, so this reimplements the same api.Client surface
// that internal/brightlocal depends on (NewClient, the With* options, Get,
// Post) directly on top of the host's global fetch().
//
// The asyncify scheduler lets the goroutine block on a channel while the JS
// event loop runs the fetch Promise callbacks, so callers keep the same
// synchronous-looking Get/Post API as the standard build.

package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"syscall/js"
)

type Client struct {
	baseURL    string
	apiKey     string
	userAgent  string
	authHeader string
}

type ClientOption func(*Client)

func WithBaseURL(url string) ClientOption {
	return func(c *Client) { c.baseURL = url }
}

func WithUserAgent(ua string) ClientOption {
	return func(c *Client) { c.userAgent = ua }
}

// WithAuthHeader sets a custom auth header name (e.g. "x-api-key").
func WithAuthHeader(name string) ClientOption {
	return func(c *Client) { c.authHeader = name }
}

func NewClient(apiKey string, opts ...ClientOption) *Client {
	c := &Client{
		apiKey:    apiKey,
		userAgent: "brightlocal-cli/1.0",
		baseURL:   "https://api.example.com",
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func (c *Client) Get(ctx context.Context, path string, result any) error {
	return c.doJSON(ctx, "GET", path, nil, result)
}

func (c *Client) Post(ctx context.Context, path string, body, result any) error {
	return c.doJSON(ctx, "POST", path, body, result)
}

func (c *Client) doJSON(ctx context.Context, method, path string, body, result any) error {
	status, respBody, err := c.fetch(ctx, method, path, body)
	if err != nil {
		return err
	}

	if status >= 400 {
		return parseAPIError(status, respBody)
	}

	if result != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}

	return nil
}

// fetch performs the request via globalThis.fetch and blocks (cooperatively,
// via the asyncify scheduler) until the response body is read.
func (c *Client) fetch(_ context.Context, method, path string, body any) (int, []byte, error) {
	headers := map[string]any{"Content-Type": "application/json"}
	if c.userAgent != "" {
		headers["User-Agent"] = c.userAgent
	}
	if c.apiKey != "" {
		if c.authHeader != "" {
			headers[c.authHeader] = c.apiKey
		} else {
			headers["Authorization"] = "Bearer " + c.apiKey
		}
	}

	opts := map[string]any{"method": method, "headers": headers}
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("marshal request body: %w", err)
		}
		opts["body"] = string(b)
	}

	type result struct {
		status int
		body   string
		err    error
	}
	ch := make(chan result, 1)
	var status int
	var onResp, onText, onErr js.Func

	onResp = js.FuncOf(func(_ js.Value, args []js.Value) any {
		status = args[0].Get("status").Int()
		return args[0].Call("text") // Promise<string>
	})
	onText = js.FuncOf(func(_ js.Value, args []js.Value) any {
		ch <- result{status: status, body: args[0].String()}
		return nil
	})
	onErr = js.FuncOf(func(_ js.Value, args []js.Value) any {
		ch <- result{err: errors.New(errMessage(args))}
		return nil
	})

	js.Global().Call("fetch", c.baseURL+path, js.ValueOf(opts)).
		Call("then", onResp).
		Call("then", onText).
		Call("catch", onErr)

	r := <-ch
	onResp.Release()
	onText.Release()
	onErr.Release()

	if r.err != nil {
		return 0, nil, fmt.Errorf("execute request: %w", r.err)
	}
	return r.status, []byte(r.body), nil
}

func errMessage(args []js.Value) string {
	if len(args) > 0 && args[0].Truthy() {
		if m := args[0].Get("message"); m.Type() == js.TypeString {
			return m.String()
		}
		return args[0].String()
	}
	return "fetch failed"
}

type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("API error (%d): %s", e.StatusCode, e.Message)
}

func parseAPIError(status int, body []byte) error {
	var apiErr struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(body, &apiErr) == nil {
		msg := apiErr.Message
		if msg == "" {
			msg = apiErr.Error
		}
		if msg != "" {
			return &APIError{StatusCode: status, Message: msg}
		}
	}
	return &APIError{StatusCode: status, Message: statusText(status)}
}

func statusText(status int) string {
	switch status {
	case 400:
		return "Bad Request"
	case 401:
		return "Unauthorized"
	case 403:
		return "Forbidden"
	case 404:
		return "Not Found"
	case 429:
		return "Too Many Requests"
	case 500:
		return "Internal Server Error"
	case 502:
		return "Bad Gateway"
	case 503:
		return "Service Unavailable"
	default:
		return fmt.Sprintf("HTTP %d", status)
	}
}
