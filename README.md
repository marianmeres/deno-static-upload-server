# @marianmeres/deno-static-upload-server

[![JSR](https://jsr.io/badges/@marianmeres/deno-static-upload-server)](https://jsr.io/@marianmeres/deno-static-upload-server)
[![License](https://img.shields.io/github/license/marianmeres/deno-static-upload-server)](LICENSE)

A lightweight, self-hosted static file server with upload endpoint and per-project configuration. Built for reliable home for static assets without the complexity of a full cloud storage setup.

## Features

- **Per-project configuration** — each project gets its own JSON config with independent auth tokens
- **Upload endpoint** — accepts `multipart/form-data` file uploads
- **Static file serving** — via `@std/http/file-server` (range requests, content types, caching headers)
- **Delete endpoint** — remove uploaded files (requires auth)
- **Plugin architecture** — custom handlers per project for full customization
- **JWT support** — HS256 token verification for time-scoped access
- **GET access control** — optional token/JWT requirement for static file serving
- **Download tokens** — per-project bearer tokens for download protection
- **Global token** — superuser token for cross-project upload, delete, and download access
- **Browser upload form** — built-in HTML form at `GET /:projectId`
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

const server = createServer({
	port: 8000,
	staticDir: "./static",
	configDir: "./config",
});

server.start();
```

## Configuration

### Server options (env vars)

| Option             | Env var              | Default    | Description                              |
| ------------------ | -------------------- | ---------- | ---------------------------------------- |
| `port`             | `PORT`               | `8000`     | Port to listen on                        |
| `staticDir`        | `STATIC_DIR`         | `./static` | Root directory for stored files          |
| `configDir`        | `CONFIG_DIR`         | `./config` | Directory for per-project JSON configs   |
| `enableUploadForm` | `ENABLE_UPLOAD_FORM` | `true`     | Global default for upload form           |
| `jwtSecret`        | `JWT_SECRET`         | —          | Shared JWT secret (per-project override) |
| `globalToken`      | `GLOBAL_TOKEN`       | —          | Superuser token for all projects         |

### Per-project config (`config/{projectId}.json`)

```json
{
	"uploadTokens": ["token-a", "token-b"],
	"downloadTokens": ["dl-token"],
	"enableUploadForm": true,
	"enableDelete": true,
	"plugin": "./plugins/my-project.ts",
	"jwt": { "secret": "per-project-secret" },
	"getAccessControl": "public"
}
```

- `uploadTokens` (required) — empty array disables auth for uploads
- `downloadTokens` (optional) — if non-empty, GET requests require a matching bearer token
- `getAccessControl` — `"public"` (default), `"token"`, or `"jwt"` for GET requests

### Global token

Set `GLOBAL_TOKEN` in your `.env` to define a superuser token that is accepted for uploads, deletes, and downloads across all projects. It does not change per-project auth requirements — open projects (with empty `uploadTokens`) remain open.

### Using a `.env` file

```bash
deno run --env=.env -A jsr:@marianmeres/deno-static-upload-server
```

## API

See [API.md](API.md) for complete API documentation.

### Routes

| Method | Path            | Description              |
| ------ | --------------- | ------------------------ |
| GET    | `/`             | Version signature        |
| GET    | `/:projectId`   | Upload form              |
| POST   | `/:projectId`   | Upload files             |
| GET    | `/:projectId/*` | Serve static file        |
| HEAD   | `/:projectId/*` | File info (headers only) |
| DELETE | `/:projectId/*` | Delete file              |

### Upload a file

```bash
curl -X POST http://localhost:8000/my-app \
  -H "Authorization: Bearer my-secret-token" \
  -F "file=@photo.webp;filename=images/thumbs/photo.webp"
```

**Response:**

```json
{ "uploaded": ["/my-app/images/thumbs/photo.webp"] }
```

### Delete a file

```
DELETE /:projectId/path/to/file.webp
Authorization: Bearer <token>
```

**Response:**

```json
{ "deleted": "/my-app/path/to/file.webp" }
```

## Plugin system

Create a TypeScript module that default-exports a handler function:

```ts
// config/plugins/my-project.ts
export default async function (req, ctx) {
	// Custom logic here
	// Return Response to handle, or null to use default handler
	return ctx.defaultHandler(req);
}
```

Reference it in your project config: `"plugin": "./plugins/my-project.ts"`

## Token rotation (zero downtime)

Put multiple tokens in the project config:

```json
{ "uploadTokens": ["old-token", "new-token"] }
```

Update your app to use the new token, then remove the old one and restart.

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
