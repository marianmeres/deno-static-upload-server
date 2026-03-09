# deno-static-upload-server — Agent Guide

## Quick Reference

- **Stack**: Deno, TypeScript, `@std/http`, `@std/path`
- **Test**: `deno task test`
- **Dev**: `deno task dev`
- **Example**: `deno task example` (loads `.env.example`)
- **Format**: `deno fmt` (tabs, 90-char lines, indent 4)

## Project Structure

```
src/server.ts          — Core: createServer(), handler, StaticServerOptions
src/cli.ts             — CLI entry point (reads env vars, calls createServer)
src/config.ts          — ProjectConfig interface, loadProjectConfig(), cache
src/auth.ts            — isAuthorized(), extractBearerToken()
src/jwt.ts             — HS256 JWT verification via Web Crypto API
src/plugin.ts          — PluginHandler type, PluginContext, loadPlugin()
src/handlers/form.ts   — GET /:projectId (upload form)
src/handlers/upload.ts — POST /:projectId (file upload)
src/handlers/serve.ts  — GET/HEAD /:projectId/* (static file serving)
src/handlers/delete.ts — DELETE /:projectId/* (file deletion)
src/upload.html        — HTML upload form template
tests/                 — Tests using Deno.test + @std/assert
example/main.ts        — Example usage
.env.example           — Example env config
```

## Exports (deno.json)

| Specifier    | File            | Purpose                       |
| ------------ | --------------- | ----------------------------- |
| `"."`        | `src/cli.ts`    | CLI entry (default, runnable) |
| `"./server"` | `src/server.ts` | Programmatic API              |

## Key Patterns

- `createServer(opts)` returns `{ handler, start }` — handler is the raw `(Request) => Promise<Response>`, start calls `Deno.serve()`
- Per-project JSON config in `CONFIG_DIR/{projectId}.json` — lazy-loaded, cached forever
- `uploadTokens` is **required** in each project config (empty array = no auth)
- Plugin system: optional `"plugin"` field in project config points to a .ts module
- Tests call `handler()` directly (no HTTP server needed)
- `upload.html` uses `{{PROJECT_ID}}` and `{{VERSION}}` template placeholders
- Path sanitization: strips `..` and `.`, replaces unsafe chars with `_`, verifies resolved path stays within `staticDir`
- `serveDir` only accepts GET — HEAD is handled by converting to GET, calling serveDir, then stripping the body

## Routes

| Method | Path            | Handler                         |
| ------ | --------------- | ------------------------------- |
| GET    | `/`             | Version signature `{ version }` |
| GET    | `/:projectId`   | Upload form                     |
| POST   | `/:projectId`   | Upload file(s)                  |
| GET    | `/:projectId/*` | Serve static file               |
| HEAD   | `/:projectId/*` | File info (headers only)        |
| DELETE | `/:projectId/*` | Delete file                     |

## Critical Conventions

1. Use tabs for indentation (configured in `deno.json` fmt)
2. No external dependencies — only `@std/*`
3. Env vars: `PORT`, `STATIC_DIR`, `CONFIG_DIR`, `ENABLE_UPLOAD_FORM`, `JWT_SECRET`
4. Project IDs must match `/^[a-zA-Z0-9\-_]+$/`
5. Project config `uploadTokens` is required (empty array = auth disabled)

## Before Making Changes

- [ ] Read `src/server.ts` — main routing and handler orchestration
- [ ] Run `deno task test` — all 30 tests must pass
- [ ] Run `deno fmt` after changes
