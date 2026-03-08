import { createServer } from "./server.ts";

const tokens = Deno.env
	.get("UPLOAD_TOKENS")
	?.split(",")
	.map((t) => t.trim())
	.filter(Boolean) ?? [];

const options: Record<string, unknown> = {};

const port = Number(Deno.env.get("PORT"));
if (port) options.port = port;

const staticDir = Deno.env.get("STATIC_DIR");
if (staticDir) options.staticDir = staticDir;

if (tokens.length > 0) options.uploadTokens = tokens;

const uploadPath = Deno.env.get("UPLOAD_PATH");
if (uploadPath) options.uploadPath = uploadPath;

const staticRoutePath = Deno.env.get("STATIC_ROUTE_PATH");
if (staticRoutePath) options.staticRoutePath = staticRoutePath;

if (Deno.env.get("ENABLE_UPLOAD_FORM") === "false") options.enableUploadForm = false;

const server = createServer(options);

server.start();
