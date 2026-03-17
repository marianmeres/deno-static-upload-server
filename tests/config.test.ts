import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { clearConfigCache } from "../src/server.ts";
import { BASE, cleanup, createHandler, setup } from "./_helpers.ts";

// ─── Version endpoint ───────────────────────────────────────────────

Deno.test("version: GET / returns version only", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/`);
		const res = await handler(req);
		assertEquals(res.status, 200);
		const body = await res.json();
		assertEquals(typeof body.version, "string");
		assertEquals(body.name, undefined);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Project config ─────────────────────────────────────────────────

Deno.test("config: missing project config returns 404", async () => {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	clearConfigCache();
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/nonexistent`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("config: invalid project config returns 500", async () => {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	clearConfigCache();
	await Deno.writeTextFile(join(configDir, "bad.json"), "not json");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/bad`);
		const res = await handler(req);
		assertEquals(res.status, 500);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("config: missing uploadTokens returns 500", async () => {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	clearConfigCache();
	await Deno.writeTextFile(
		join(configDir, "notoken.json"),
		JSON.stringify({ foo: "bar" }),
	);
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/notoken`);
		const res = await handler(req);
		assertEquals(res.status, 500);
	} finally {
		await cleanup(staticDir, configDir);
	}
});
