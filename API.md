# API

## Functions

### `createServer(options?)`

Creates a static upload server instance. This is an **async** function due to CDN adapter initialization and version read.

**Parameters:**

- `options` (`StaticServerOptions`, optional) — Server configuration. All fields optional with sensible defaults.

**Returns:** `Promise<{ handler, start, version }>`

- `handler(req: Request): Promise<Response>` — The raw request handler. Useful for testing or embedding in another server.
- `start(): Deno.HttpServer` — Starts listening and returns the `Deno.HttpServer` instance.
- `version: string` — The resolved package version.

**Example:**

```ts
import { createServer } from "jsr:@marianmeres/deno-static-upload-server/server";

const { handler, start } = await createServer({
	port: 8080,
	staticDir: "/var/data/uploads",
	configDir: "/var/data/config",
	logger: true,
});

// Option A: start the server
start();

// Option B: use the handler directly (e.g. in tests)
const res = await handler(new Request("http://localhost/proj/file.txt"));
```

### `clearConfigCache(configDir?)`

Clears the project-config cache. Pass a `configDir` to clear only entries loaded from that directory; omit to clear all.

```ts
import { clearConfigCache } from "jsr:@marianmeres/deno-static-upload-server/server";
clearConfigCache("/var/data/config");
```

---

## Types

### `StaticServerOptions`

```ts
interface StaticServerOptions {
	port?: number; // Default: 8000
	staticDir?: string; // Default: "./static"
	configDir?: string; // Default: "./config"
	enableUploadForm?: boolean; // Default: true
	jwtSecret?: string; // Default: undefined
	globalToken?: string; // Default: undefined
	cdn?: Partial<CdnOptions>; // Default: undefined (disabled)
	rootFiles?: string[]; // Default: []
	logger?: boolean | Logger; // Default: false (silent)
	tmpSweepMaxAgeMs?: number; // Default: 3_600_000 (1 hour)
}
```

| Field              | Type                  | Default      | Description                                                                         |
| ------------------ | --------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `port`             | `number`              | `8000`       | Port to listen on                                                                   |
| `staticDir`        | `string`              | `"./static"` | Root directory for stored files                                                     |
| `configDir`        | `string`              | `"./config"` | Directory containing per-project JSON config files                                  |
| `enableUploadForm` | `boolean`             | `true`       | Server-level default for upload form (per-project `enableUploadForm` overrides)     |
| `jwtSecret`        | `string`              | —            | Shared JWT secret (per-project `jwt.secret` overrides)                              |
| `globalToken`      | `string`              | —            | Superuser token accepted across all projects                                        |
| `cdn`              | `Partial<CdnOptions>` | —            | CDN adapter options. Omit to disable                                                |
| `rootFiles`        | `string[]`            | `[]`         | Exact root filenames served from `staticDir` (e.g. `["favicon.ico", "robots.txt"]`) |
| `logger`           | `boolean \| Logger`   | `false`      | `true` → JSON-line logs to stderr; object → custom logger; falsey → silent          |
| `tmpSweepMaxAgeMs` | `number`              | `3_600_000`  | On startup, remove `.tmp_*` files older than this. `0` disables sweep.              |

### `ProjectConfig`

Each project requires a JSON config file at `{configDir}/{projectId}.json`:

```json
{
	"uploadTokens": ["token-a", "token-b"],
	"downloadTokens": ["dl-token"],
	"enableUploadForm": true,
	"enableDelete": true,
	"plugin": "./plugins/my-project.ts",
	"jwt": { "secret": "per-project-secret" },
	"getAccessControl": "public",
	"cacheStrategy": "mutable",
	"maxFileSize": 10485760,
	"allowedExtensions": ["png", "jpg", "webp"],
	"allowedMimeTypes": ["image/*"],
	"forceDownload": false
}
```

| Field               | Type       | Required | Default     | Description                                                                     |
| ------------------- | ---------- | -------- | ----------- | ------------------------------------------------------------------------------- |
| `uploadTokens`      | `string[]` | **Yes**  | —           | Bearer tokens for upload/delete auth. `[]` = open                               |
| `downloadTokens`    | `string[]` | No       | —           | Bearer tokens for download auth. If non-empty, GET requires auth                |
| `enableUploadForm`  | `boolean`  | No       | server-side | Per-project override of server default                                          |
| `enableDelete`      | `boolean`  | No       | `true`      | Enable DELETE endpoint (requires non-empty `uploadTokens`)                      |
| `plugin`            | `string`   | No       | —           | Plugin module path, relative to configDir (must resolve inside configDir)       |
| `jwt.secret`        | `string`   | No       | —           | Per-project JWT secret (falls back to global `jwtSecret`)                       |
| `getAccessControl`  | `string`   | No       | `"public"`  | `"public"`, `"token"`, or `"jwt"`                                               |
| `cacheStrategy`     | `string \| object` | No | `"mutable"` | `"mutable"` / `"immutable"`, or a `prefix → strategy` map. See [Cache strategies](#cache-strategies). |
| `maxFileSize`       | `number`   | No       | —           | Per-file byte cap. Oversize → `413`. Enforced streaming.                        |
| `allowedExtensions` | `string[]` | No       | —           | Lowercase, no dot. Non-match → `400`.                                           |
| `allowedMimeTypes`  | `string[]` | No       | —           | Exact MIME type or `type/*` wildcard. Non-match → `400`.                        |
| `forceDownload`     | `boolean`  | No       | `false`     | Adds `Content-Disposition: attachment` to served files (inline-XSS mitigation). |

### `Logger`

```ts
interface Logger {
	debug(event: string, data?: Record<string, unknown>): void;
	info(event: string, data?: Record<string, unknown>): void;
	warn(event: string, data?: Record<string, unknown>): void;
	error(event: string, data?: Record<string, unknown>): void;
}
```

Events emitted by the server (for filtering/monitoring):

| Event                      | Level | Data                                                                             |
| -------------------------- | ----- | -------------------------------------------------------------------------------- |
| `upload.unauthorized`      | warn  | `{ projectId }`                                                                  |
| `upload.write_failed`      | error | `{ projectId, name, error }`                                                     |
| `upload.done`              | info  | `{ projectId, uploaded, rejected }`                                              |
| `delete.unauthorized`      | warn  | `{ projectId, path }`                                                            |
| `delete.done`              | info  | `{ projectId, path }`                                                            |
| `serve.unauthorized`       | warn  | `{ reason }` where reason ∈ `downloadTokens`/`token`/`jwt_missing`/`jwt_invalid` |
| `serve.jwt_not_configured` | error | —                                                                                |
| `config.load_failed`       | error | `{ projectId, error }`                                                           |
| `plugin.error`             | error | `{ projectId, error }`                                                           |
| `cdn.purge_failed`         | error | `{ error }`                                                                      |
| `tmp.swept`                | info  | `{ path }`                                                                       |

---

## HTTP Endpoints

### `GET /`

Returns server version signature.

**Response (200):**

```json
{ "version": "1.5.0" }
```

---

### `GET /<rootFile>`

Serves `<rootFile>` directly from `staticDir` root, bypassing project config. Only filenames listed in `opts.rootFiles` (or `ROOT_FILES` env var) are handled here — unlisted requests return `404`.

Use for `favicon.ico`, `robots.txt`, etc.

---

### `POST /:projectId`

Upload one or more files via `multipart/form-data`.

**Headers:**

- `Authorization: Bearer <token>` — Required when project's `uploadTokens` is non-empty. The global token (`GLOBAL_TOKEN`) is also accepted.

**Request body:** Standard `multipart/form-data` with one or more file fields. Subdirectory paths in filenames are preserved (e.g., `images/thumbs/photo.webp`).

**Response (200):**

```json
{ "uploaded": ["/my-app/images/thumbs/photo.webp"] }
```

If any files were rejected by policy (size/extension/MIME) or failed to write, the response includes a `rejected` array:

```json
{
	"uploaded": ["/my-app/ok.png"],
	"rejected": [{ "name": "huge.mp4", "reason": "File exceeds maxFileSize (10485760)" }]
}
```

**Error responses:**

| Status | Body                                   | Cause                                                                                 |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| 400    | `Invalid form data`                    | Malformed multipart body                                                              |
| 400    | `No files received`                    | No file fields in form data                                                           |
| 400    | `{ uploaded: [], rejected: [...] }`    | All files rejected by policy (extension/MIME) or write failure                        |
| 413    | `{ uploaded: [...], rejected: [...] }` | One or more files rejected for exceeding `maxFileSize` (when all rejections are size) |
| 401    | `Unauthorized`                         | Missing or invalid bearer token                                                       |
| 404    | `Not found`                            | Project config not found                                                              |

---

### `DELETE /:projectId/path/to/file`

Delete a single file. Only available when project's `uploadTokens` is non-empty and `enableDelete` is true.

**Headers:**

- `Authorization: Bearer <token>` — Required.

**Response (200):**

```json
{ "deleted": "/my-app/images/photo.webp" }
```

**Error responses:**

| Status | Body                    | Cause                               |
| ------ | ----------------------- | ----------------------------------- |
| 400    | `File path is required` | No file path after project ID       |
| 400    | `Not a file`            | Path points to a directory          |
| 401    | `Unauthorized`          | Missing or invalid bearer token     |
| 404    | `Not found`             | File doesn't exist or auth disabled |

---

### `GET /:projectId`

Serves the built-in HTML upload form (when `enableUploadForm` is `true`). The form includes a token input and file picker, and submits via `fetch` to the same URL.

---

### `GET /:projectId/path/to/file`

Serves static files. Powered by `@std/http/file-server`.

Supports range requests, ETags, and correct `Content-Type` headers.

All served files receive:

- `X-Content-Type-Options: nosniff` — always
- `Content-Disposition: attachment` — if project's `forceDownload` is `true`
- `Access-Control-Allow-Origin: *` — only when content is fully public (no `downloadTokens`, `getAccessControl: "public"`)

Access can be restricted via `downloadTokens` or the project's `getAccessControl` setting:

- **`downloadTokens`** — if non-empty in project config, GET requires a bearer token from this list (or `GLOBAL_TOKEN`). Takes precedence over `getAccessControl`.
- `"public"` — no auth required (default `getAccessControl`)
- `"token"` — requires valid bearer token from project's `uploadTokens` (or `GLOBAL_TOKEN`)
- `"jwt"` — requires valid JWT signed with the project or global secret (or `GLOBAL_TOKEN`)

---

### `HEAD /:projectId/path/to/file`

Same as GET but returns headers only (no body). Same access control applies.

---

## Plugin System

A plugin is a TypeScript module that default-exports a `PluginHandler` function:

```ts
export default async function (
	req: Request,
	ctx: PluginContext,
): Promise<Response | null> {
	// Return a Response to handle the request
	// Return null to fall through to the default handler
	return ctx.defaultHandler(req);
}
```

Plugin paths must resolve inside `configDir` (sandbox enforced at load time).

The `PluginContext` provides:

| Field            | Type                                  | Description                       |
| ---------------- | ------------------------------------- | --------------------------------- |
| `projectId`      | `string`                              | The project ID from the URL       |
| `config`         | `ProjectConfig`                       | The loaded project configuration  |
| `filePath`       | `string`                              | Remaining path after projectId    |
| `staticDir`      | `string`                              | Absolute path to static files dir |
| `defaultHandler` | `(req: Request) => Promise<Response>` | Delegate to the built-in handler  |

---

## CLI Entry Point

The default export (`"."`) is a CLI that reads configuration from environment variables:

```bash
PORT=8000 \
STATIC_DIR=./data \
CONFIG_DIR=./config \
deno run -A jsr:@marianmeres/deno-static-upload-server
```

Or with a `.env` file:

```bash
deno run --env=.env -A jsr:@marianmeres/deno-static-upload-server
```

**Environment variables:**

| Variable                     | Purpose                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `PORT`                       | Port to listen on                                              |
| `STATIC_DIR`                 | Root static file dir                                           |
| `CONFIG_DIR`                 | Project configs dir                                            |
| `ENABLE_UPLOAD_FORM`         | `false` disables upload form globally                          |
| `JWT_SECRET`                 | Shared JWT secret                                              |
| `GLOBAL_TOKEN`               | Cross-project superuser token                                  |
| `ROOT_FILES`                 | Comma-separated root filenames (e.g. `favicon.ico,robots.txt`) |
| `LOG`                        | `true` or `1` enables JSON-line logs to stderr                 |
| `TMP_SWEEP_MAX_AGE_MS`       | `.tmp_*` sweep max age in ms (`0` disables)                    |
| `CDN_PROVIDER`               | Provider name (e.g. `cloudflare`)                              |
| `CDN_CACHE_PURGE_URL_PREFIX` | Public URL prefix for purge URLs                               |
| `CDN_CACHE_MAX_AGE`          | Browser `max-age` in seconds                                   |
| `CDN_CACHE_S_MAXAGE`         | CDN `s-maxage` in seconds                                      |
| `CDN_STALE_WHILE_REVALIDATE` | Stale-while-revalidate window in seconds                       |
| `CF_ZONE_ID`                 | Cloudflare zone ID                                             |
| `CF_API_TOKEN`               | Cloudflare API token with Cache Purge permission               |

---

## CDN Adapter System

Optional, provider-agnostic CDN integration. When configured via the `cdn` option (or `CDN_*` env vars), the server adds cache headers to served files and purges the CDN cache on upload/delete (fire-and-forget — the HTTP response returns before the CDN round-trip completes).

### `CdnAdapter`

```ts
interface CdnAdapter {
	applyCacheHeaders(res: Response, immutable?: boolean): Response;
	/** Must never throw. */
	purgeCache(paths: string[]): Promise<void>;
}
```

The `immutable` flag is derived from the project's `cacheStrategy` config field. When the field is a map, the strategy is resolved per request path before the flag is passed in.

### `CdnOptions`

```ts
interface CdnOptions {
	provider: string; // e.g. "cloudflare"
	purgeUrlPrefix: string; // e.g. "https://cdn.example.com"
	cacheMaxAge?: number; // Default: 60 (1 minute, browser)
	cacheSMaxAge?: number; // Default: 604800 (7 days, CDN)
	staleWhileRevalidate?: number; // Default: 86400 (1 day)
	[key: string]: unknown; // Provider-specific options
}
```

### Cache strategies

Set per project via `"cacheStrategy"` in the project config.

**Scalar form** — one strategy for the whole project:

- **`"mutable"`** (default): `Cache-Control: public, max-age=60, s-maxage=604800, stale-while-revalidate=86400`. Browser TTL is short; CDN TTL is long (purged on upload/delete). Configurable via env vars.
- **`"immutable"`**: `Cache-Control: public, max-age=31536000, immutable`. For content-hashed filenames. Ignores configurable TTL values.

**Map form** — per-subpath strategy within a single project:

```json
{
	"cacheStrategy": {
		"/img/hashed/": "immutable",
		"/img/":        "mutable",
		"*":            "mutable"
	}
}
```

- Keys are path prefixes matched against the request path inside the project static dir (e.g. `/img/foo.jpg`).
- A trailing `*` is allowed and stripped (`/img/*` ≡ `/img/`).
- A bare `*`, `/`, `/*`, or empty string is the **fallback** entry for paths that don't match any other prefix.
- **Longest matching prefix wins** — order in the JSON doesn't matter.
- If no prefix matches and no fallback is given, behaviour falls back to `"mutable"`.
- Values must be `"mutable"` or `"immutable"`; any other value is rejected at config load time.

The resulting `Cache-Control` string is the same one the adapter would have applied for the scalar form — the map only picks *which* of the two pre-built strings each file gets.

### Behavior

- **Serve**: 2xx responses for static files get cache headers based on the project's `cacheStrategy`
- **Upload**: After successful upload, schedules a purge of uploaded paths (fire-and-forget)
- **Delete**: After successful deletion, schedules a purge of the deleted path (fire-and-forget)
- **Non-static responses**: Version endpoint (`GET /`) and upload form (`GET /:projectId`) get `Cache-Control: no-store`
- **Disabled**: When `CDN_PROVIDER` is not set, behavior is identical to a server without CDN support

---

## Security

- **Project isolation:** Each project requires a config file. Requests to unconfigured projects return 404.
- **Path traversal prevention:** `..` and `.` segments are stripped. Resolved paths are verified with `@std/path` `relative()` to remain within the static directory.
- **Filename sanitization:** Non-alphanumeric characters (except `.`, `-`, `_`) are replaced with `_`.
- **Upload auth:** Per-project `uploadTokens`. When non-empty, uploads and deletes require a valid bearer token.
- **Download auth:** Per-project `downloadTokens`. When non-empty, GET requests require a matching bearer token.
- **Global token:** `GLOBAL_TOKEN` env var provides a superuser token. Does not change per-project auth requirements.
- **JWT:** Optional HS256 JWT verification. `typ` is optional per RFC 7519. Expiration is enforced when present.
- **Constant-time comparison**: all token equality checks (upload, download, global) use a constant-time comparison.
- **Upload policies**: `maxFileSize` (streaming enforcement, aborts mid-stream), `allowedExtensions`, `allowedMimeTypes`.
- **XSS hardening**: `X-Content-Type-Options: nosniff` on every served file. `forceDownload: true` adds `Content-Disposition: attachment` to further prevent inline execution of user-uploaded HTML/SVG.
- **CORS isolation**: `Access-Control-Allow-Origin: *` is only sent for fully public GETs. Auth-protected content is same-origin by default.
- **Plugin sandbox**: plugin paths must resolve inside `configDir`.
- **Atomic writes**: uploads write to `.tmp_<uuid>` then atomically rename. Startup sweeps stale temp files.

---

## Breaking Changes (from 1.4.3)

- `GET /<name>` for names containing `.` no longer implicitly serves a root file. Add the filename to `rootFiles` (env `ROOT_FILES=favicon.ico,robots.txt`).
- Server-level `enableUploadForm: false` now actually disables the form (previously silently ignored).
- CORS is disabled for auth-protected GETs.
- CDN purge no longer awaited — upload/delete responses return before the CDN round-trip.
- Config cache is keyed by `configDir + projectId` (was projectId only). Same project ID in different configDirs is now isolated.
- JWT `typ` is optional per RFC 7519.
- Upload response may include a `rejected` array when some files are rejected.
- `X-Content-Type-Options: nosniff` is sent with every served file.
