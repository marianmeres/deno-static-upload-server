import { createServer } from "../src/server.ts";

// Tokens can be loaded from env for security
const tokens =
	Deno.env
		.get("UPLOAD_TOKENS")
		?.split(",")
		.map((t) => t.trim()) ?? [];

const server = createServer({
	port: Number(Deno.env.get("PORT")) || 8000,
	staticDir: Deno.env.get("STATIC_DIR") || "./static",
	uploadTokens: tokens,
	uploadPath: "/upload",
	staticRoutePath: "/static",
});

server.start();
