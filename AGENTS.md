# deno-static-upload-server — Agent Guide

## Quick Reference

- **Stack**: Deno, TypeScript, `@std/http`, `@std/path`
- **Test**: `deno task test`
- **Dev**: `deno task dev`
- **Example**: `deno task example` (loads `.env.example`)
- **Format**: `deno fmt` (tabs, 90-char lines, indent 4)

## Project Structure

```
src/server.ts      — Core: createServer(), handler, StaticServerOptions
src/cli.ts         — CLI entry point (reads env vars, calls createServer)
src/upload.html    — HTML upload form template (served on GET /upload/:projectId)
tests/             — Tests using Deno.test + @std/assert
example/main.ts    — Example usage
.env.example       — Example env config for deno task example
```

## Exports (deno.json)

| Specifier    | File            | Purpose                       |
| ------------ | --------------- | ----------------------------- |
| `"."`        | `src/cli.ts`    | CLI entry (default, runnable) |
| `"./server"` | `src/server.ts` | Programmatic API              |

## Key Patterns

- `createServer(opts)` returns `{ handler, start }` — handler is the raw `(Request) => Promise<Response>`, start calls `Deno.serve()`
- Tests call `handler()` directly (no HTTP server needed)
- `upload.html` uses `{{PROJECT_ID}}` template placeholder
- Path sanitization: strips `..` and `.`, replaces unsafe chars with `_`, verifies resolved path stays within `staticDir`
- `serveDir` only accepts GET — HEAD is handled by converting to GET, calling serveDir, then stripping the body

## Critical Conventions

1. Use tabs for indentation (configured in `deno.json` fmt)
2. No external dependencies — only `@std/*`
3. All env vars: `PORT`, `STATIC_DIR`, `UPLOAD_TOKENS`, `UPLOAD_PATH`, `STATIC_ROUTE_PATH`, `ENABLE_UPLOAD_FORM`
4. Project IDs must match `/^[a-zA-Z0-9\-_]+$/`

## Before Making Changes

- [ ] Read `src/server.ts` — single source file, ~160 lines
- [ ] Run `deno task test` — all 15 tests must pass
- [ ] Run `deno fmt` after changes
