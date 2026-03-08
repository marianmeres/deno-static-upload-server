# @marianmeres/deno-static-upload-server

A lightweight, self-hosted static file server with a simple upload endpoint. Built for teams who need a reliable home for their static assets without the complexity of a full cloud storage setup.

## Motivation

When running a full-stack app on a cloud platform like Deno Deploy, there is no persistent filesystem available. Any file written during a request simply disappears. This is fine for most application logic, but it creates a problem for file uploads — images, documents, and other assets need to land *somewhere* permanent.

This server solves that by acting as a dedicated home for static assets on a machine you control. Your cloud app handles all the business logic (resizing, validation, writing metadata to a database), then forwards the final file here for permanent storage. If you later decide to migrate to S3 or Cloudflare R2, you just swap out the upload target — your application logic stays untouched.

## Features

- **Upload endpoint** — accepts `multipart/form-data` file uploads
- **Static file serving** — serves uploaded files via `@std/http/file-server` (range requests, correct content types, caching headers all included)
- **Project scoping** — each app gets its own namespace, preventing collisions when sharing one server across multiple projects
- **Bearer token auth** — optionally restrict uploads to known sources
- **Subdirectory preservation** — file paths including subdirectories are preserved as-is
- **Zero dependencies** — just Deno standard library

## Usage

### As a standalone server

```ts
// main.ts
import { createServer } from "./server.ts";

const server = createServer({
  port: 8000,
  staticDir: "./static",
  uploadTokens: ["your-secret-token"],
  uploadPath: "/upload",
  staticRoutePath: "/static",
});

server.start();
```

Run it:

```bash
deno run --allow-net --allow-read --allow-write --allow-env main.ts
```

### Configuration via environment variables

All options can be driven from environment variables, which is the recommended approach in production:

```bash
PORT=8000 \
STATIC_DIR=/var/data/static \
UPLOAD_TOKENS=token-one,token-two \
deno run --allow-net --allow-read --allow-write --allow-env main.ts
```

| Option | Env var | Default | Description |
|---|---|---|---|
| `port` | `PORT` | `8000` | Port to listen on |
| `staticDir` | `STATIC_DIR` | `./static` | Root directory for stored files |
| `uploadTokens` | `UPLOAD_TOKENS` | *(none)* | Comma-separated bearer tokens. If empty, auth is disabled |
| `uploadPath` | — | `/upload` | Route prefix for the upload endpoint |
| `staticRoutePath` | — | `/static` | Route prefix for serving files |

## API

### Upload a file

```
POST /upload/:projectId
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

- `:projectId` — a unique identifier for your app (alphanumeric, dashes and underscores allowed). The project directory is created automatically on first upload.
- The request body should be standard `multipart/form-data` with one or more file fields.
- Subdirectory structure in filenames is preserved. `images/thumbs/photo.webp` will be stored at `{staticDir}/{projectId}/images/thumbs/photo.webp`.

**Response**

```json
{
  "uploaded": [
    "/static/my-app/images/thumbs/photo.webp"
  ]
}
```

### Serve a file

```
GET /static/:projectId/path/to/file.webp
```

Standard HTTP file serving — supports range requests, ETags, and correct `Content-Type` headers out of the box.

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
