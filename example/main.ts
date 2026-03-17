import { createServer } from "../src/server.ts";

const server = await createServer({
	port: Number(Deno.env.get("PORT")) || 8000,
	staticDir: Deno.env.get("STATIC_DIR") || "./static",
	configDir: Deno.env.get("CONFIG_DIR") || "./config",
});

server.start();
