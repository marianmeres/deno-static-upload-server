# deno-static-upload-server — Agent Guide

## Quick Reference

- **Stack**: Deno, TypeScript, `@std/http`, `@std/path`
- **Test**: `deno task test`
- **Dev**: `deno task dev`
- **Example**: `deno task example` (loads `.env.example`)
- **Format**: `deno fmt` (tabs, 90-char lines, indent 4)
- **Typecheck**: `deno check src/**/*.ts`

## Project Structure

```
src/server.ts          — createServer(), handler, StaticServerOptions
src/cli.ts             — CLI entry (reads env vars, calls createServer)
src/config.ts          — ProjectConfig, loadProjectConfig(), cache (keyed by configDir+projectId)
src/auth.ts            — isAuthorized(), extractBearerToken(), timingSafeEqualStr()
src/jwt.ts             — HS256 JWT verification (Web Crypto); `typ` is optional per RFC 7519
src/paths.ts           — sanitizePath(), resolveUnderStaticDir() (uses @std/path `relative()`)
src/content-type.ts    — extOf(), mimeMatches(), checkUploadPolicy() (size/ext/mime gates)
src/logger.ts          — Logger interface, defaultLogger(), silentLogger
src/plugin.ts          — PluginHandler, PluginContext, loadPlugin() (sandboxed to configDir)
src/cdn.ts             — CdnAdapter, CdnOptions, createCdnAdapter(), noStoreHeaders()
src/cdn/cloudflare.ts  — CloudflareCdnAdapter
src/cache-strategy.ts  — resolveCacheStrategy(cfg, filePath) (longest-prefix lookup)
src/handlers/form.ts   — GET /:projectId (upload form, lazy-loads HTML)
src/handlers/upload.ts — POST /:projectId (streaming write with byte cap, partial-failure reporting)
src/handlers/serve.ts  — GET/HEAD /:projectId/* (nosniff, forceDownload, CORS off for protected)
src/handlers/delete.ts — DELETE /:projectId/*
src/upload.html        — Upload form template
tests/_helpers.ts      — Shared test utilities
tests/*.test.ts        — auth, auth_timing, cache, cache-strategy, cdn, config, delete, hardening, jwt, plugin, policy, serve, upload
example/main.ts        — Example usage
.env.example           — Example env config
```

## Exports (deno.json)

| Specifier    | File            | Purpose                       |
| ------------ | --------------- | ----------------------------- |
| `"."`        | `src/cli.ts`    | CLI entry (default, runnable) |
| `"./server"` | `src/server.ts` | Programmatic API              |

## Programmatic API

- `createServer(opts)` → `Promise<{ handler, start, version }>`. **async** (CDN adapter init, version read).
- `clearConfigCache(configDir?)` — clear all, or only entries for a given configDir.
- Types re-exported from `server`: `CdnAdapter`, `CdnOptions`, `Logger`, `PluginContext`, `ProjectConfig`, `StaticServerOptions`.

## Configuration

### `StaticServerOptions`

| Field              | Type                  | Default      | Notes                                                                                  |
| ------------------ | --------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `port`             | `number`              | `8000`       |                                                                                        |
| `staticDir`        | `string`              | `"./static"` |                                                                                        |
| `configDir`        | `string`              | `"./config"` |                                                                                        |
| `enableUploadForm` | `boolean`             | `true`       | Server-level default; per-project `enableUploadForm` overrides                         |
| `jwtSecret`        | `string`              | —            | Fallback for projects without `jwt.secret`                                             |
| `globalToken`      | `string`              | —            | Superuser upload/delete/download                                                       |
| `cdn`              | `Partial<CdnOptions>` | —            | Omit to disable                                                                        |
| `rootFiles`        | `string[]`            | `[]`         | Exact filenames to serve from staticDir root (e.g. `["favicon.ico"]`). No config load. |
| `logger`           | `boolean \| Logger`   | `false`      | `true` = JSON-line to stderr; object = custom                                          |
| `tmpSweepMaxAgeMs` | `number`              | `3_600_000`  | On startup, remove `.tmp_*` files older than this. `0` disables.                       |

### `ProjectConfig` (JSON at `{configDir}/{projectId}.json`)

| Field               | Type                           | Default     | Notes                                                              |
| ------------------- | ------------------------------ | ----------- | ------------------------------------------------------------------ |
| `uploadTokens`      | `string[]`                     | required    | `[]` disables upload auth                                          |
| `downloadTokens`    | `string[]`                     | —           | Non-empty → GET requires bearer token                              |
| `enableUploadForm`  | `boolean`                      | server-side | Per-project override of server default                             |
| `enableDelete`      | `boolean`                      | `true`      | Also requires non-empty `uploadTokens`                             |
| `plugin`            | `string`                       | —           | Path relative to configDir; **must resolve inside configDir**      |
| `jwt.secret`        | `string`                       | —           | Per-project JWT secret                                             |
| `getAccessControl`  | `"public" \| "token" \| "jwt"` | `"public"`  | GET access control                                                 |
| `cacheStrategy`     | `CacheStrategyConfig`          | `"mutable"` | Scalar (`"mutable"`/`"immutable"`) **or** `Record<prefix, strategy>` for per-subpath control. Longest matching prefix wins; `*`/`/` is the fallback bucket. Resolved per request by `resolveCacheStrategy` ([src/cache-strategy.ts](src/cache-strategy.ts)) before being passed to `CdnAdapter.applyCacheHeaders`. |
| `maxFileSize`       | `number`                       | —           | Bytes; per-file cap. Oversize → `413` with `rejected` in response. |
| `allowedExtensions` | `string[]`                     | —           | Lowercase, no dot. Non-match → `400` with `rejected`.              |
| `allowedMimeTypes`  | `string[]`                     | —           | Exact or `type/*` wildcard. Non-match → `400` with `rejected`.     |
| `forceDownload`     | `boolean`                      | `false`     | Adds `Content-Disposition: attachment` on served files             |

## Key Patterns

- **Streaming uploads with byte cap**: `src/handlers/upload.ts` uses `Deno.open` + manual chunk loop so size limits are enforced mid-stream without buffering the whole file.
- **Partial success reporting**: upload response is `{ uploaded, rejected? }`. `rejected` is `[{ name, reason }]` if any files were skipped. All-rejected → `413` (size-only) or `400`.
- **CDN purge is fire-and-forget** (`queueMicrotask`): response is not blocked on CDN round-trip. `CdnAdapter.purgeCache` contract: must never throw.
- **Per-prefix cache strategy**: `cacheStrategy` accepts a `{ prefix: "mutable" | "immutable" }` map alongside the scalar form. `normalizeCacheStrategy` ([src/config.ts](src/config.ts)) strips trailing `*` and stores the fallback (`*` / `/` / `""` / `/*`) as `""`. The serve handler resolves once per request with the project-relative path (`"/" + filePath`).
- **Hardening headers** on all served files: `X-Content-Type-Options: nosniff` (always), `Content-Disposition: attachment` (if `forceDownload`).
- **CORS**: enabled only for fully public GETs. Disabled when `downloadTokens` set OR `getAccessControl` is `"token"` / `"jwt"`.
- **Timing-safe token comparison** (`timingSafeEqualStr`): walks full `expected.length`, XOR-accumulates diff, compares once at end.
- **Path boundary**: `resolveUnderStaticDir()` uses `@std/path` `relative()` instead of string `startsWith`.
- **Plugin sandbox**: `loadPlugin` rejects paths that resolve outside configDir; imports via `toFileUrl` for cross-platform safety.
- **Lazy module loads**: `deno.json` (for version) and `src/upload.html` are loaded on first use, not at import time.
- **Logger**: all handlers receive a `Logger`. `silentLogger` by default. Events: `upload.unauthorized`, `upload.done`, `upload.write_failed`, `delete.unauthorized`, `delete.done`, `serve.unauthorized`, `serve.jwt_not_configured`, `config.load_failed`, `plugin.error`, `cdn.purge_failed`, `tmp.swept`.
- **Tmp sweep**: on startup, walks `staticDir`, removes `*.tmp_<uuid>` files older than `tmpSweepMaxAgeMs`. Non-blocking, never throws.
- **Root files**: `GET /<name>` serves `staticDir/<name>` ONLY for names listed in `opts.rootFiles`. No implicit allow.
- **Config cache**: keyed by `configDir\0projectId`. Multiple `createServer` instances with different configDirs are isolated.

## Env Vars

Server: `PORT`, `STATIC_DIR`, `CONFIG_DIR`, `ENABLE_UPLOAD_FORM`, `JWT_SECRET`, `GLOBAL_TOKEN`, `ROOT_FILES` (comma-separated), `LOG` (`true`/`1` for JSON-line stderr), `TMP_SWEEP_MAX_AGE_MS`.
CDN: `CDN_PROVIDER`, `CDN_CACHE_PURGE_URL_PREFIX`, `CDN_CACHE_MAX_AGE`, `CDN_CACHE_S_MAXAGE`, `CDN_STALE_WHILE_REVALIDATE`.
Cloudflare: `CF_ZONE_ID`, `CF_API_TOKEN`.
Docker: `PUID`, `PGID`.

## Routes

| Method | Path            | Handler                         |
| ------ | --------------- | ------------------------------- |
| GET    | `/`             | Version signature `{ version }` |
| GET    | `/<rootFile>`   | Whitelisted root file           |
| GET    | `/:projectId`   | Upload form (if enabled)        |
| POST   | `/:projectId`   | Upload file(s)                  |
| GET    | `/:projectId/*` | Serve static file               |
| HEAD   | `/:projectId/*` | File info (headers only)        |
| DELETE | `/:projectId/*` | Delete file                     |

## Critical Conventions

1. Tabs for indentation (`deno fmt` enforces)
2. No external dependencies — only `@std/*`
3. Project IDs match `/^[a-zA-Z0-9\-_]+$/`
4. `uploadTokens` required (empty array = auth disabled)
5. Plugin paths must resolve inside `configDir`

## Breaking Changes (from 1.4.3)

| Change                                                                   | Mitigation                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Root files: `/favicon.ico` etc. now require `rootFiles: ["favicon.ico"]` | Add filenames to `rootFiles` (or env `ROOT_FILES=favicon.ico,robots.txt`)             |
| `enableUploadForm: false` server-level **actually disables** the form    | Previously silently ignored. Remove the option if the old no-op was relied on.        |
| CORS disabled for auth-protected GETs (`downloadTokens`, `token`, `jwt`) | Serve protected files from same-origin, or write a plugin that sets CORS manually     |
| CDN purge no longer awaited before upload/delete response                | Response returns faster. Clients must not assume cache was purged before 200.         |
| Config cache keyed by `configDir\0projectId` (was projectId only)        | Same-project-id across different configDirs is now isolated (bug fix).                |
| JWT `typ` now OPTIONAL (was required to be `"JWT"`)                      | Spec-compliant. Tokens without `typ` now verify; explicit wrong `typ` still rejected. |
| Upload response may include `rejected: [{name, reason}]`                 | Additive; existing `uploaded` field unchanged                                         |
| `handleForm` is now async (internal)                                     | Internal. If you import it directly, `await` the call.                                |
| `X-Content-Type-Options: nosniff` added to served files                  | Security hardening. Should be non-breaking for browsers.                              |

## Before Making Changes

- [ ] Read `src/server.ts` — main routing and handler orchestration
- [ ] Run `deno task test` — all tests must pass
- [ ] Run `deno fmt` and `deno check src/**/*.ts`
- [ ] For security-adjacent changes, add a test in `tests/hardening.test.ts` or `tests/policy.test.ts`
