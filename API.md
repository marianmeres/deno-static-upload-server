# API

## Functions

### `createServer(options?)`

Creates a static upload server instance.

**Parameters:**

- `options` (`StaticServerOptions`, optional) — Server configuration. All fields optional with sensible defaults.

**Returns:** `{ handler, start }`

- `handler(req: Request): Promise<Response>` — The raw request handler. Useful for testing or embedding in another server.
- `start(): Deno.HttpServer` — Starts listening and returns the `Deno.HttpServer` instance.

**Example:**

```ts
import { createServer } from "jsr:@marianmeres/deno-static-upload-server/server";

const { handler, start } = createServer({
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
}
```

| Field              | Type      | Default      | Description                                        |
| ------------------ | --------- | ------------ | -------------------------------------------------- |
| `port`             | `number`  | `8000`       | Port to listen on                                  |
| `staticDir`        | `string`  | `"./static"` | Root directory for stored files                    |
| `configDir`        | `string`  | `"./config"` | Directory containing per-project JSON config files |
| `enableUploadForm` | `boolean` | `true`       | Global default for upload form visibility          |
| `jwtSecret`        | `string`  | —            | Shared JWT secret (per-project secrets override)   |

### `ProjectConfig`

Each project requires a JSON config file at `{configDir}/{projectId}.json`:

```json
{
	"uploadTokens": ["token-a", "token-b"],
	"enableUploadForm": true,
	"enableDelete": true,
	"plugin": "./plugins/my-project.ts",
	"jwt": { "secret": "per-project-secret" },
	"getAccessControl": "public"
}
```

| Field              | Type       | Required | Default    | Description                                       |
| ------------------ | ---------- | -------- | ---------- | ------------------------------------------------- |
| `uploadTokens`     | `string[]` | **Yes**  | —          | Bearer tokens for upload/delete auth. `[]` = open |
| `enableUploadForm` | `boolean`  | No       | `true`     | Serve HTML upload form for this project           |
| `enableDelete`     | `boolean`  | No       | `true`     | Enable DELETE endpoint (requires tokens)          |
| `plugin`           | `string`   | No       | —          | Path to plugin module, relative to configDir      |
| `jwt.secret`       | `string`   | No       | —          | Per-project JWT secret (falls back to global)     |
| `getAccessControl` | `string`   | No       | `"public"` | `"public"`, `"token"`, or `"jwt"`                 |

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

- `Authorization: Bearer <token>` — Required when project's `uploadTokens` is non-empty.

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

Access can be restricted via the project's `getAccessControl` setting:

- `"public"` — no auth required (default)
- `"token"` — requires valid bearer token from project's `uploadTokens`
- `"jwt"` — requires valid JWT signed with the project or global secret

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

**Environment variables:** `PORT`, `STATIC_DIR`, `CONFIG_DIR`, `ENABLE_UPLOAD_FORM`, `JWT_SECRET`.

---

## Security

- **Project isolation:** Each project requires a config file to exist. Requests to unconfigured projects return 404.
- **Path traversal prevention:** `..` and `.` segments are stripped from uploaded filenames. Resolved paths are verified to remain within the static directory.
- **Filename sanitization:** Non-alphanumeric characters (except `.`, `-`, `_`) are replaced with `_`.
- **Auth:** Per-project `uploadTokens`. When non-empty, uploads and deletes require a valid `Authorization: Bearer <token>` header.
- **JWT:** Optional HS256 JWT verification for time-scoped tokens. Configurable per-project or globally.
- **GET access control:** Optional token or JWT requirement for static file serving.
