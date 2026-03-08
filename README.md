# @marianmeres/deno-static-upload-server

[![JSR](https://jsr.io/badges/@marianmeres/deno-static-upload-server)](https://jsr.io/@marianmeres/deno-static-upload-server)
[![License](https://img.shields.io/github/license/marianmeres/deno-static-upload-server)](LICENSE)

A lightweight, self-hosted static file server with a simple upload endpoint. Built for reliable home for static assets without the complexity of a full cloud storage setup.

## Motivation

When running a full-stack app on a cloud platform like Deno Deploy, there is no persistent filesystem available. Any file written during a request simply disappears. This is fine for most application logic, but it creates a problem for file uploads — images, documents, and other assets need to land _somewhere_ permanent.

This server solves that by acting as a dedicated home for static assets on a machine you control. Your cloud app handles all the business logic (resizing, validation, writing metadata to a database), then forwards the final file here for permanent storage. If you later decide to migrate to S3 or Cloudflare R2, you just swap out the upload target — your application logic stays untouched.

## Features

- **Upload endpoint** — accepts `multipart/form-data` file uploads
- **Static file serving** — serves uploaded files via `@std/http/file-server` (range requests, correct content types, caching headers all included)
- **Project scoping** — each app gets its own namespace, preventing collisions when sharing one server across multiple projects
- **Bearer token auth** — optionally restrict uploads to known sources
- **Subdirectory preservation** — file paths including subdirectories are preserved as-is
- **Browser upload form** — built-in HTML form at `GET /upload/:projectId` for quick manual uploads
- **Zero dependencies** — just Deno standard library

## Quick start

### Run directly from JSR (no install needed)

```bash
PORT=8000 \
STATIC_DIR=./static \
UPLOAD_TOKENS=my-secret-token \
deno run -A jsr:@marianmeres/deno-static-upload-server
```

This starts the server immediately using the built-in CLI entry point. No local files required.

### Programmatic usage

```ts
import { createServer } from "jsr:@marianmeres/deno-static-upload-server/server";

const server = createServer({
	port: 8000,
	staticDir: "./static",
	uploadTokens: ["your-secret-token"],
});

server.start();
```

## Configuration

All options can be set via environment variables (recommended for production) or passed programmatically.

| Option             | Env var              | Default    | Description                                               |
| ------------------ | -------------------- | ---------- | --------------------------------------------------------- |
| `port`             | `PORT`               | `8000`     | Port to listen on                                         |
| `staticDir`        | `STATIC_DIR`         | `./static` | Root directory for stored files                           |
| `uploadTokens`     | `UPLOAD_TOKENS`      | _(none)_   | Comma-separated bearer tokens. If empty, auth is disabled |
| `uploadPath`       | `UPLOAD_PATH`        | `/upload`  | Route prefix for the upload endpoint                      |
| `staticRoutePath`  | `STATIC_ROUTE_PATH`  | `/static`  | Route prefix for serving files                            |
| `enableUploadForm` | `ENABLE_UPLOAD_FORM` | `true`     | Serve the HTML upload form on `GET /upload/:projectId`    |

### Using a `.env` file

```bash
deno run --env=.env -A jsr:@marianmeres/deno-static-upload-server
```

## API

See [API.md](API.md) for complete API documentation.

### Upload a file

```
POST /upload/:projectId
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Response:**

```json
{
	"uploaded": ["/static/my-app/images/photo.webp"]
}
```

### Upload with subdirectory path

Subdirectory structure is set via the `filename` in the multipart form field:

```bash
curl -X POST http://localhost:8000/upload/my-app \
  -H "Authorization: Bearer my-secret-token" \
  -F "file=@photo.webp;filename=images/thumbs/photo.webp"
```

The file will be stored at `{staticDir}/my-app/images/thumbs/photo.webp`.

In JavaScript:

```ts
const form = new FormData();
form.append("file", blob, "images/thumbs/photo.webp");
//                         ^^^ third argument sets the path

await fetch("http://localhost:8000/upload/my-app", {
	method: "POST",
	headers: { Authorization: "Bearer my-secret-token" },
	body: form,
});
```

### Serve a file

```
GET /static/:projectId/path/to/file.webp
```

Standard HTTP file serving — supports range requests, ETags, and correct `Content-Type` headers out of the box.

### Browser upload form

Visit `GET /upload/:projectId` in a browser to use the built-in upload form. It provides a token input field and file picker. Disable with `ENABLE_UPLOAD_FORM=false` or `enableUploadForm: false`.

## Token rotation (zero downtime)

Pass multiple tokens as a comma-separated list:

```bash
UPLOAD_TOKENS=old-token,new-token
```

Update your app to use the new token, then remove the old one from the list and restart. No downtime required.

## Project layout on disk

Files are stored under `{staticDir}/{projectId}/`, so a server shared between multiple apps might look like:

```
static/
  my-blog/
    images/
      hero.webp
  my-shop/
    products/
      item-42.jpg
```

Each project is fully isolated — there is no way for one project's uploads to overwrite another's.

## License

[MIT](LICENSE)
