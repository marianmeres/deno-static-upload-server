# API

## Functions

### `createServer(options?)`

Creates a static upload server instance. This is an **async** function due to CDN adapter initialization.

**Parameters:**

- `options` (`StaticServerOptions`, optional) — Server configuration. All fields optional with sensible defaults.

**Returns:** `Promise<{ handler, start }>`

- `handler(req: Request): Promise<Response>` — The raw request handler. Useful for testing or embedding in another server.
- `start(): Deno.HttpServer` — Starts listening and returns the `Deno.HttpServer` instance.

**Example:**

```ts
import { createServer } from "jsr:@marianmeres/deno-static-upload-server/server";

const { handler, start } = await createServer({
	port: 8080,
	staticDir: "/var/data/uploads",
	configDir: "/var/data/config",
});

// Option A: start the server
start();

// Option B: use the handler directly (e.g. in tests)
const res = await handler(new Request("http://localhost/proj/file.txt"));
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
}
```

| Field              | Type                  | Default      | Description                                        |
| ------------------ | --------------------- | ------------ | -------------------------------------------------- |
| `port`             | `number`              | `8000`       | Port to listen on                                  |
| `staticDir`        | `string`              | `"./static"` | Root directory for stored files                    |
| `configDir`        | `string`              | `"./config"` | Directory containing per-project JSON config files |
| `enableUploadForm` | `boolean`             | `true`       | Global default for upload form visibility          |
| `jwtSecret`        | `string`              | —            | Shared JWT secret (per-project secrets override)   |
| `globalToken`      | `string`              | —            | Superuser token accepted across all projects       |
| `cdn`              | `Partial<CdnOptions>` | —            | CDN adapter options. Omit to disable               |

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
	"cacheStrategy": "mutable"
}
```

| Field              | Type       | Required | Default     | Description                                                      |
| ------------------ | ---------- | -------- | ----------- | ---------------------------------------------------------------- |
| `uploadTokens`     | `string[]` | **Yes**  | —           | Bearer tokens for upload/delete auth. `[]` = open                |
| `downloadTokens`   | `string[]` | No       | —           | Bearer tokens for download auth. If non-empty, GET requires auth |
| `enableUploadForm` | `boolean`  | No       | `true`      | Serve HTML upload form for this project                          |
| `enableDelete`     | `boolean`  | No       | `true`      | Enable DELETE endpoint (requires tokens)                         |
| `plugin`           | `string`   | No       | —           | Path to plugin module, relative to configDir                     |
| `jwt.secret`       | `string`   | No       | —           | Per-project JWT secret (falls back to global)                    |
| `getAccessControl` | `string`   | No       | `"public"`  | `"public"`, `"token"`, or `"jwt"`                                |
| `cacheStrategy`    | `string`   | No       | `"mutable"` | `"mutable"` or `"immutable"` (for content-hashed filenames)      |

---

## HTTP Endpoints

### `GET /`

Returns server version signature.

**Response (200):**

```json
{ "version": "2.0.0" }
```

---

### `POST /:projectId`

Upload one or more files via `multipart/form-data`.

**Headers:**

- `Authorization: Bearer <token>` — Required when project's `uploadTokens` is non-empty. The global token (`GLOBAL_TOKEN`) is also accepted.

**Path parameters:**

- `:projectId` — Must match an existing project config file.

**Request body:** Standard `multipart/form-data` with one or more file fields. Subdirectory paths in filenames are preserved (e.g., `images/thumbs/photo.webp`).

**Response (200):**

```json
{ "uploaded": ["/my-app/images/thumbs/photo.webp"] }
```

**Error responses:**

| Status | Body                | Cause                           |
| ------ | ------------------- | ------------------------------- |
| 400    | `Invalid form data` | Malformed multipart body        |
| 400    | `No files received` | No file fields in form data     |
| 401    | `Unauthorized`      | Missing or invalid bearer token |
| 404    | `Not found`         | Project config not found        |

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

Serves static files. Powered by `@std/http/file-server` with CORS enabled.

Supports range requests, ETags, and correct `Content-Type` headers.

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

**Environment variables:** `PORT`, `STATIC_DIR`, `CONFIG_DIR`, `ENABLE_UPLOAD_FORM`, `JWT_SECRET`, `GLOBAL_TOKEN`, `CDN_PROVIDER`, `CDN_CACHE_PURGE_URL_PREFIX`, `CDN_CACHE_MAX_AGE`, `CDN_CACHE_S_MAXAGE`, `CDN_STALE_WHILE_REVALIDATE`, `CF_ZONE_ID`, `CF_API_TOKEN`.

---

## CDN Adapter System

Optional, provider-agnostic CDN integration. When configured via the `cdn` option (or `CDN_*` env vars), the server adds cache headers to served files and purges the CDN cache on upload/delete.

### `CdnAdapter`

```ts
interface CdnAdapter {
	applyCacheHeaders(res: Response, immutable?: boolean): Response;
	purgeCache(paths: string[]): Promise<void>;
}
```

The `immutable` flag is derived from the project's `cacheStrategy` config field.

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

### CDN Environment Variables

| Variable                     | Required     | Default  | Description                              |
| ---------------------------- | ------------ | -------- | ---------------------------------------- |
| `CDN_PROVIDER`               | To enable    | —        | Provider name (e.g. `cloudflare`)        |
| `CDN_CACHE_PURGE_URL_PREFIX` | When enabled | —        | Public URL prefix for purge URLs         |
| `CDN_CACHE_MAX_AGE`          | No           | `60`     | Browser `max-age` in seconds             |
| `CDN_CACHE_S_MAXAGE`         | No           | `604800` | CDN `s-maxage` in seconds                |
| `CDN_STALE_WHILE_REVALIDATE` | No           | `86400`  | Stale-while-revalidate window in seconds |
| `CF_ZONE_ID`                 | Cloudflare   | —        | Cloudflare zone ID                       |
| `CF_API_TOKEN`               | Cloudflare   | —        | API token with Cache Purge permission    |

### Cache strategies

Set per project via `"cacheStrategy"` in the project config:

- **`"mutable"`** (default): `Cache-Control: public, max-age=60, s-maxage=604800, stale-while-revalidate=86400`. Browser TTL is short (can't purge browsers); CDN TTL is long (purged on upload/delete). The `max-age`, `s-maxage`, and `stale-while-revalidate` values are configurable via env vars.
- **`"immutable"`**: `Cache-Control: public, max-age=31536000, immutable`. For content-hashed filenames that never change at the same URL. Ignores the configurable TTL values.

### Behavior

- **Serve**: 2xx responses for static files get cache headers based on the project's `cacheStrategy`
- **Upload**: After successful upload, purges the uploaded paths from CDN cache (handles overwrites)
- **Delete**: After successful deletion, purges the deleted path from CDN cache (regardless of cache strategy)
- **Non-static responses**: Version endpoint (`GET /`) and upload form (`GET /:projectId`) get `Cache-Control: no-store`
- **Disabled**: When `CDN_PROVIDER` is not set, behavior is identical to a server without CDN support

---

## Security

- **Project isolation:** Each project requires a config file to exist. Requests to unconfigured projects return 404.
- **Path traversal prevention:** `..` and `.` segments are stripped from uploaded filenames. Resolved paths are verified to remain within the static directory.
- **Filename sanitization:** Non-alphanumeric characters (except `.`, `-`, `_`) are replaced with `_`.
- **Auth:** Per-project `uploadTokens`. When non-empty, uploads and deletes require a valid `Authorization: Bearer <token>` header.
- **Download auth:** Per-project `downloadTokens`. When non-empty, GET requests require a matching bearer token.
- **Global token:** `GLOBAL_TOKEN` env var provides a superuser token accepted for uploads, deletes, and downloads across all projects. Does not change per-project auth requirements.
- **JWT:** Optional HS256 JWT verification for time-scoped tokens. Configurable per-project or globally.
- **GET access control:** Optional token or JWT requirement for static file serving.
