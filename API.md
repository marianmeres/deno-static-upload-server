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
	uploadTokens: ["token-one", "token-two"],
});

// Option A: start the server
start();

// Option B: use the handler directly (e.g. in tests)
const res = await handler(new Request("http://localhost/static/proj/file.txt"));
```

---

## Types

### `StaticServerOptions`

```ts
interface StaticServerOptions {
	port?: number; // Default: 8000
	staticDir?: string; // Default: "./static"
	uploadTokens?: string[]; // Default: [] (auth disabled)
	uploadPath?: string; // Default: "/upload"
	staticRoutePath?: string; // Default: "/static"
	enableUploadForm?: boolean; // Default: true
}
```

| Field              | Type       | Default      | Description                                          |
| ------------------ | ---------- | ------------ | ---------------------------------------------------- |
| `port`             | `number`   | `8000`       | Port to listen on                                    |
| `staticDir`        | `string`   | `"./static"` | Root directory for stored files                      |
| `uploadTokens`     | `string[]` | `[]`         | Bearer tokens for upload auth. Empty = auth disabled |
| `uploadPath`       | `string`   | `"/upload"`  | Route prefix for upload endpoint                     |
| `staticRoutePath`  | `string`   | `"/static"`  | Route prefix for serving files                       |
| `enableUploadForm` | `boolean`  | `true`       | Serve HTML upload form on `GET /upload/:projectId`   |

---

## HTTP Endpoints

### `POST /upload/:projectId`

Upload one or more files via `multipart/form-data`.

**Headers:**

- `Authorization: Bearer <token>` — Required when `uploadTokens` is non-empty.

**Path parameters:**

- `:projectId` — Alphanumeric identifier (plus `-` and `_`). Created automatically on first upload.

**Request body:** Standard `multipart/form-data` with one or more file fields. Subdirectory paths in filenames are preserved (e.g., `images/thumbs/photo.webp`).

**Response (200):**

```json
{ "uploaded": ["/static/my-app/images/thumbs/photo.webp"] }
```

**Error responses:**

| Status | Body                            | Cause                           |
| ------ | ------------------------------- | ------------------------------- |
| 400    | `Invalid or missing project ID` | Missing or invalid `:projectId` |
| 400    | `Invalid form data`             | Malformed multipart body        |
| 400    | `No files received`             | No file fields in form data     |
| 401    | `Unauthorized`                  | Missing or invalid bearer token |

---

### `DELETE /static/:projectId/*`

Delete a single file. Only available when `uploadTokens` is non-empty — returns 404 otherwise.

**Headers:**

- `Authorization: Bearer <token>` — Required.

**Path parameters:**

- `:projectId` — Alphanumeric identifier (plus `-` and `_`).
- `*` — Path to the file to delete.

**Response (200):**

```json
{ "deleted": "/static/my-app/images/photo.webp" }
```

**Error responses:**

| Status | Body                            | Cause                               |
| ------ | ------------------------------- | ----------------------------------- |
| 400    | `Invalid or missing project ID` | Missing or invalid `:projectId`     |
| 400    | `File path is required`         | No file path after project ID       |
| 400    | `Not a file`                    | Path points to a directory          |
| 401    | `Unauthorized`                  | Missing or invalid bearer token     |
| 404    | `Not found`                     | File doesn't exist or auth disabled |

---

### `GET /upload/:projectId`

Serves the built-in HTML upload form (when `enableUploadForm` is `true`). The form includes a token input and file picker, and submits via `fetch` to the same URL.

---

### `GET /static/:projectId/*`

Serves static files. Powered by `@std/http/file-server` with CORS enabled.

Supports range requests, ETags, and correct `Content-Type` headers.

---

### `HEAD /static/:projectId/*`

Same as GET but returns headers only (no body).

---

## CLI Entry Point

The default export (`"."`) is a CLI that reads configuration from environment variables:

```bash
PORT=8000 \
STATIC_DIR=./data \
UPLOAD_TOKENS=secret \
deno run -A jsr:@marianmeres/deno-static-upload-server
```

Or with a `.env` file:

```bash
deno run --env=.env -A jsr:@marianmeres/deno-static-upload-server
```

**Environment variables:** `PORT`, `STATIC_DIR`, `UPLOAD_TOKENS`, `UPLOAD_PATH`, `STATIC_ROUTE_PATH`, `ENABLE_UPLOAD_FORM`.

Set `ENABLE_UPLOAD_FORM=false` to disable the upload form. All other unset variables use defaults.

---

## Security

- **Path traversal prevention:** `..` and `.` segments are stripped from uploaded filenames. Resolved paths are verified to remain within the static directory.
- **Filename sanitization:** Non-alphanumeric characters (except `.`, `-`, `_`) are replaced with `_`.
- **Auth:** When `uploadTokens` is non-empty, uploads and deletes require a valid `Authorization: Bearer <token>` header. The upload form is unauthenticated (it's a static HTML page; auth happens on POST). The delete endpoint is only available when tokens are configured.
