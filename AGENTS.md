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
src/auth.ts            — isAuthorized(req, tokens, globalToken?), extractBearerToken()
src/jwt.ts             — HS256 JWT verification via Web Crypto API
src/plugin.ts          — PluginHandler type, PluginContext, loadPlugin()
src/cdn.ts             — CdnAdapter interface, CdnOptions, createCdnAdapter() factory
src/cdn/cloudflare.ts  — CloudflareCdnAdapter (cache headers + CF API purge)
src/handlers/form.ts   — GET /:projectId (upload form)
src/handlers/upload.ts — POST /:projectId (file upload, CDN purge on overwrite)
src/handlers/serve.ts  — GET/HEAD /:projectId/* (static file serving, CDN cache headers)
src/handlers/delete.ts — DELETE /:projectId/* (file deletion, CDN purge)
src/upload.html        — HTML upload form template
tests/_helpers.ts      — Shared test utilities (setup, cleanup, makeUploadRequest, etc.)
tests/*_test.ts        — Tests split by concern (config, auth, upload, serve, delete, cdn)
example/main.ts        — Example usage
.env.example           — Example env config
```

## Exports (deno.json)

| Specifier    | File            | Purpose                       |
| ------------ | --------------- | ----------------------------- |
| `"."`        | `src/cli.ts`    | CLI entry (default, runnable) |
| `"./server"` | `src/server.ts` | Programmatic API              |

## Key Patterns

- `createServer(opts)` is **async** — returns `Promise<{ handler, start }>`. Handler is `(Request) => Promise<Response>`, start calls `Deno.serve()`
- Per-project JSON config in `CONFIG_DIR/{projectId}.json` — lazy-loaded, cached forever
- `uploadTokens` is **required** in each project config (empty array = no auth)
- `downloadTokens` is optional per project — if non-empty, GET requests require a matching bearer token
- `GLOBAL_TOKEN` env var provides a superuser token accepted for upload/delete/download across all projects (does not change per-project auth requirements)
- Plugin system: optional `"plugin"` field in project config points to a .ts module
- CDN adapter system: optional, provider-agnostic interface. Set `CDN_PROVIDER` env var to enable. Cloudflare is the first implementation. See `src/cdn.ts` for the `CdnAdapter` interface.
- Tests call `handler()` directly (no HTTP server needed). Shared helpers in `tests/_helpers.ts`
- `upload.html` uses `{{PROJECT_ID}}` and `{{VERSION}}` template placeholders
- Path sanitization: strips `..` and `.`, replaces unsafe chars with `_`, verifies resolved path stays within `staticDir`
- `serveDir` only accepts GET — HEAD is handled by converting to GET, calling serveDir, then stripping the body

## CDN Adapter System

Provider-agnostic CDN integration via `CdnAdapter` interface in `src/cdn.ts`:

- `applyCacheHeaders(res, immutable?)` — adds `Cache-Control` to 2xx responses. Mutable: `public, max-age=60, s-maxage=604800, stale-while-revalidate=86400`. Immutable: `public, max-age=31536000, immutable`.
- `purgeCache(paths[])` — purges file paths from CDN cache (fire-and-forget, never throws). Always called on upload/delete regardless of cache strategy.
- Non-static responses (version endpoint, upload form) get `Cache-Control: no-store` when CDN is enabled.

Per-project `"cacheStrategy"` in project config: `"mutable"` (default) or `"immutable"` (for content-hashed filenames).

Factory `createCdnAdapter(opts)` dispatches on `opts.provider`. Adding a new provider: create `src/cdn/{provider}.ts` implementing `CdnAdapter`, add a case in the factory switch.

Cloudflare adapter (`src/cdn/cloudflare.ts`): uses CF API `POST /zones/{zoneId}/purge_cache`.

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
2. No external dependencies — only `@std/*` and native `fetch`
3. Server env vars: `PORT`, `STATIC_DIR`, `CONFIG_DIR`, `ENABLE_UPLOAD_FORM`, `JWT_SECRET`, `GLOBAL_TOKEN`
   CDN env vars: `CDN_PROVIDER`, `CDN_CACHE_PURGE_URL_PREFIX`, `CDN_CACHE_MAX_AGE`, `CDN_CACHE_S_MAXAGE`, `CDN_STALE_WHILE_REVALIDATE`
   Cloudflare env vars: `CF_ZONE_ID`, `CF_API_TOKEN`
   Docker-specific env vars: `PUID`, `PGID` (host user UID/GID for volume ownership, default `1000`)
4. Project IDs must match `/^[a-zA-Z0-9\-_]+$/`
5. Project config `uploadTokens` is required (empty array = auth disabled)

## Before Making Changes

- [ ] Read `src/server.ts` — main routing and handler orchestration
- [ ] Run `deno task test` — all 48 tests must pass
- [ ] Run `deno fmt` after changes
