import { createServer } from "./server.ts";

const tokens = Deno.env
	.get("UPLOAD_TOKENS")
	?.split(",")
	.map((t) => t.trim())
	.filter(Boolean) ?? [];

const server = createServer({
	port: Number(Deno.env.get("PORT")) || undefined,
	staticDir: Deno.env.get("STATIC_DIR") || undefined,
	uploadTokens: tokens.length > 0 ? tokens : undefined,
	uploadPath: Deno.env.get("UPLOAD_PATH") || undefined,
	staticRoutePath: Deno.env.get("STATIC_ROUTE_PATH") || undefined,
	enableUploadForm: Deno.env.get("ENABLE_UPLOAD_FORM") !== "false",
});

server.start();
