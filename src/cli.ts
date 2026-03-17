import { createServer } from "./server.ts";

const options: Record<string, unknown> = {};

const port = Number(Deno.env.get("PORT"));
if (port) options.port = port;

const staticDir = Deno.env.get("STATIC_DIR");
if (staticDir) options.staticDir = staticDir;

const configDir = Deno.env.get("CONFIG_DIR");
if (configDir) options.configDir = configDir;

if (Deno.env.get("ENABLE_UPLOAD_FORM") === "false") {
	options.enableUploadForm = false;
}

const jwtSecret = Deno.env.get("JWT_SECRET");
if (jwtSecret) options.jwtSecret = jwtSecret;

const globalToken = Deno.env.get("GLOBAL_TOKEN");
if (globalToken) options.globalToken = globalToken;

const server = createServer(options);

server.start();
