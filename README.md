# @marianmeres/deno-static-upload-server

[![JSR](https://jsr.io/badges/@marianmeres/deno-static-upload-server)](https://jsr.io/@marianmeres/deno-static-upload-server)
[![License](https://img.shields.io/github/license/marianmeres/deno-static-upload-server)](LICENSE)

A lightweight, self-hosted static file server with upload endpoint and per-project configuration. Built for a reliable home for static assets without the complexity of a full cloud storage setup.

## Features

- **Per-project configuration** — each project gets its own JSON config with independent auth tokens
- **Upload endpoints** — `multipart/form-data` POST for the browser form, and a raw-body streaming PUT for machine clients and large files (constant memory, any size)
- **Static file serving** — via `@std/http/file-server` (range requests, content types, caching headers)
- **Delete endpoint** — remove uploaded files (requires auth)
- **Plugin architecture** — custom handlers per project, sandboxed to configDir
- **JWT support** — HS256 token verification (Web Crypto, zero-dep)
- **GET access control** — optional token/JWT requirement for static file serving
- **Download tokens** — per-project bearer tokens for download protection
- **Global token** — superuser token for cross-project upload, delete, and download access
- **Browser upload form** — built-in HTML form at `GET /:projectId`
- **CDN integration** — optional, provider-agnostic (Cloudflare adapter included). Cache headers + fire-and-forget purge on upload/delete
- **Upload policies** — per-project `maxFileSize`, `allowedExtensions`, `allowedMimeTypes`, `forceDownload`
- **Hardened serving** — `X-Content-Type-Options: nosniff` always on; CORS off for auth-protected content
- **Structured logging** — pluggable `Logger` interface with a JSON-line default
- **Zero dependencies** — just Deno standard library

## Quick start

### 1. Create a project config

```bash
mkdir -p config
echo '{"uploadTokens": ["my-secret-token"]}' > config/my-app.json
```

### 2. Run the server

```bash
PORT=8000 \
STATIC_DIR=./static \
CONFIG_DIR=./config \
deno run -A jsr:@marianmeres/deno-static-upload-server
```

### Programmatic usage

```ts
import { createServer } from "jsr:@marianmeres/deno-static-upload-server/server";

const server = await createServer({
	port: 8000,
	staticDir: "./static",
	configDir: "./config",
	logger: true, // JSON-line logs to stderr
});

server.start();
```

## Configuration

### Server options (env vars)

| Option             | Env var                | Default    | Description                                                             |
| ------------------ | ---------------------- | ---------- | ----------------------------------------------------------------------- |
| `port`             | `PORT`                 | `8000`     | Port to listen on                                                       |
| `staticDir`        | `STATIC_DIR`           | `./static` | Root directory for stored files                                         |
| `configDir`        | `CONFIG_DIR`           | `./config` | Directory for per-project JSON configs                                  |
| `enableUploadForm` | `ENABLE_UPLOAD_FORM`   | `true`     | Server default for upload form                                          |
| `jwtSecret`        | `JWT_SECRET`           | —          | Shared JWT secret                                                       |
| `globalToken`      | `GLOBAL_TOKEN`         | —          | Superuser token for all projects                                        |
| `rootFiles`        | `ROOT_FILES`           | `[]`       | Comma-separated root filenames to serve (e.g. `favicon.ico,robots.txt`) |
| `logger`           | `LOG`                  | off        | Set `LOG=true` for JSON-line logs                                       |
| `tmpSweepMaxAgeMs` | `TMP_SWEEP_MAX_AGE_MS` | `3600000`  | Remove stale `.tmp_*` files older than this on startup                  |
| CDN options        | `CDN_*`, `CF_*`        | —          | See [API.md](API.md)                                                    |

### Per-project config (`config/{projectId}.json`)

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

- `uploadTokens` (required) — empty array disables auth for uploads
- `downloadTokens` — if non-empty, GET requires a matching bearer token
- `getAccessControl` — `"public"` (default), `"token"`, or `"jwt"` for GET requests
- `cacheStrategy` — `"mutable"` (default) or `"immutable"` (for content-hashed filenames). Also accepts a `prefix → strategy` map for per-subpath control within one project, e.g. `{ "/img/": "immutable", "*": "mutable" }`. Longest matching prefix wins; bare `*` or `/` is the fallback. See [API.md](./API.md#cache-headers) for details.
- `maxFileSize` — bytes; oversized uploads return `413` (streaming enforcement)
- `allowedExtensions` — lowercase, no dot. Non-matching extensions return `400`
- `allowedMimeTypes` — exact MIME type or `type/*` wildcard
- `forceDownload` — adds `Content-Disposition: attachment` to served files (mitigates inline XSS from user-uploaded HTML/SVG)

### Global token

Set `GLOBAL_TOKEN` to define a superuser token accepted for uploads, deletes, and downloads across all projects. It does not change per-project auth requirements — open projects (with empty `uploadTokens`) remain open.

### Using a `.env` file

```bash
deno run --env=.env -A jsr:@marianmeres/deno-static-upload-server
```

## API

See [API.md](API.md) for complete API documentation.

### Routes

| Method | Path            | Description                      |
| ------ | --------------- | -------------------------------- |
| GET    | `/`             | Version signature                |
| GET    | `/<rootFile>`   | Whitelisted root file            |
| GET    | `/:projectId`   | Upload form                      |
| POST   | `/:projectId`   | Upload files (multipart)         |
| GET    | `/:projectId/*` | Serve static file                |
| HEAD   | `/:projectId/*` | File info (headers only)         |
| PUT    | `/:projectId/*` | Upload file (raw body, streamed) |
| DELETE | `/:projectId/*` | Delete file                      |

### Upload a file (multipart POST)

```bash
curl -X POST http://localhost:8000/my-app \
  -H "Authorization: Bearer my-secret-token" \
  -F "file=@photo.webp;filename=images/thumbs/photo.webp"
```

**Response:**

```json
{ "uploaded": ["/my-app/images/thumbs/photo.webp"] }
```

If one or more files are rejected by policy (size/extension/MIME), the response also includes a `rejected` array:

```json
{
	"uploaded": ["/my-app/ok.png"],
	"rejected": [{ "name": "huge.mp4", "reason": "File exceeds maxFileSize (10485760)" }]
}
```

All-rejected responses return `413` when size was the only reason, `500` when all rejections were write failures, otherwise `400`.

> **Memory note:** parsing multipart buffers the whole request body in RAM
> (~3–3.5× the file size at peak, per concurrent upload). POST is meant for the
> browser form and small files — for large files or machine clients, use PUT.

### Upload a file (streaming PUT)

The request body **is** the file; the destination path comes from the URL. Bytes
stream from the socket straight to disk — constant memory, any file size — and
are atomically renamed into place when complete.

```bash
curl -T backup.sql.gz \
  -H "Authorization: Bearer my-secret-token" \
  http://localhost:8000/my-app/daily/backup.sql.gz
```

**Response:**

```json
{ "uploaded": ["/my-app/daily/backup.sql.gz"], "size": 100452466 }
```

`size` is the number of bytes stored — clients streaming without a
`Content-Length` (e.g. Deno/browser `fetch`) should verify it against the
source file size. See [API.md](API.md) for status codes and details.

### Delete a file

```
DELETE /:projectId/path/to/file.webp
Authorization: Bearer <token>
```

**Response:**

```json
{ "deleted": "/my-app/path/to/file.webp" }
```

## CDN integration

Optional, provider-agnostic CDN support. When configured, the server:

- Adds `Cache-Control` headers to served static files
- Purges CDN cache when files are uploaded or deleted (fire-and-forget — does not block the response)
- Sets `Cache-Control: no-store` on non-static responses (version endpoint, upload form)

### Cloudflare setup

```env
CDN_PROVIDER=cloudflare
CDN_CACHE_PURGE_URL_PREFIX=https://cdn.example.com
CF_ZONE_ID=your-zone-id
CF_API_TOKEN=your-api-token
```

The API token needs the **Cache Purge** permission for your zone. See [API.md](API.md) for all CDN options.

## Security hardening

- **`X-Content-Type-Options: nosniff`** is set on every served file. Mitigates MIME-sniffing attacks.
- **`forceDownload: true`** (per-project) forces `Content-Disposition: attachment` on served files — recommended when accepting untrusted uploads that include HTML/SVG.
- **CORS** is disabled automatically when GETs are protected (`downloadTokens` set, or `getAccessControl` is `"token"` / `"jwt"`). Public content still gets `Access-Control-Allow-Origin: *`.
- **Constant-time token comparison** for upload/download tokens and the global token.
- **Plugin sandbox**: plugin paths must resolve inside `configDir`.
- **`maxFileSize`** enforcement is streaming — oversized uploads are aborted mid-stream (the temp file is removed). Projects without `maxFileSize` fall back to the server-level `maxUploadSize` (default 2 GiB; `MAX_UPLOAD_SIZE=0` for unlimited) so a single streaming upload can't fill the disk.
- **Stalled uploads** are aborted after 60s without a body chunk (`UPLOAD_IDLE_TIMEOUT_MS`, `0` disables) so slow-drip connections can't pin file descriptors and temp files indefinitely.
- **Unhandled request errors** return a generic 500 and are logged as `request.unhandled` with the stack — enable `LOG=true` in production (docker-compose does this by default).
- **Recommendation for public upload endpoints**: serve uploaded files from a dedicated cookieless domain, and combine with `forceDownload` and `allowedExtensions`/`allowedMimeTypes` to constrain accepted content.
- **Rate limiting** is out of scope — put a reverse-proxy limiter in front of the server if exposed to the public internet.
- **Reverse proxy + large uploads**: if nginx fronts this server, keep `client_max_body_size` in sync with your server-side caps, and consider `proxy_request_buffering off` for the streaming PUT route so bodies aren't spooled to the proxy's disk first — see [nginx.example.conf](nginx.example.conf).

## Plugin system

Create a TypeScript module (inside `configDir`) that default-exports a handler function:

```ts
// config/plugins/my-project.ts
export default async function (req, ctx) {
	// Custom logic here
	// Return Response to handle, or null to use default handler
	return ctx.defaultHandler(req);
}
```

Reference it in your project config: `"plugin": "./plugins/my-project.ts"`.

Plugin paths must resolve inside `configDir` (enforced at load time).

## Token rotation (zero downtime)

Put multiple tokens in the project config:

```json
{ "uploadTokens": ["old-token", "new-token"] }
```

Update your app to use the new token, then remove the old one and restart (or call `clearConfigCache(configDir)` if embedding the handler).

## Docker

```bash
docker compose up
```

The compose file mounts `./data` for static files and `./config` for project configs.

The container runs as a non-root user. Set `PUID` and `PGID` in your `.env` file to
match your host user so that uploaded files have correct ownership:

```bash
# Find your UID/GID
id -u  # e.g. 1000
id -g  # e.g. 1000
```

```env
PUID=1000
PGID=1000
```

If not set, defaults to `1000:1000`.

## License

[MIT](LICENSE)
