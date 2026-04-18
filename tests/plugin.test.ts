import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { clearConfigCache } from "../src/server.ts";
import { clearPluginCache, loadPlugin } from "../src/plugin.ts";
import { BASE, cleanup, createHandler } from "./_helpers.ts";

async function setupWithPlugin(
	projectId: string,
	pluginSource: string,
	extraConfig: Record<string, unknown> = {},
): Promise<{ staticDir: string; configDir: string; pluginPath: string }> {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	const pluginPath = join(configDir, `${projectId}.plugin.ts`);
	await Deno.writeTextFile(pluginPath, pluginSource);
	await Deno.writeTextFile(
		join(configDir, `${projectId}.json`),
		JSON.stringify({
			uploadTokens: [],
			plugin: `./${projectId}.plugin.ts`,
			...extraConfig,
		}),
	);
	clearConfigCache();
	clearPluginCache();
	return { staticDir, configDir, pluginPath };
}

// ─── Plugin handler basics ──────────────────────────────────────────

Deno.test("plugin: handles request when returning Response", async () => {
	const { staticDir, configDir } = await setupWithPlugin(
		"p",
		`export default async (_req, _ctx) => new Response("from-plugin", { status: 201 });`,
	);
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(new Request(`${BASE}/p`));
		assertEquals(res.status, 201);
		assertEquals(await res.text(), "from-plugin");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("plugin: returning null falls through to default handler", async () => {
	const { staticDir, configDir } = await setupWithPlugin(
		"p",
		`export default async (_req, _ctx) => null;`,
	);
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(new Request(`${BASE}/p`));
		// default form is enabled
		assertEquals(res.status, 200);
		assertEquals(
			res.headers.get("content-type"),
			"text/html; charset=utf-8",
		);
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("plugin: throwing plugin returns 500", async () => {
	const { staticDir, configDir } = await setupWithPlugin(
		"p",
		`export default async (_req, _ctx) => { throw new Error("boom"); };`,
	);
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(new Request(`${BASE}/p`));
		assertEquals(res.status, 500);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Plugin sandboxing ──────────────────────────────────────────────

Deno.test("plugin: path resolving outside configDir is rejected", async () => {
	const configDir = await Deno.makeTempDir();
	try {
		await assertRejects(
			() => loadPlugin(configDir, "../../etc/passwd.ts"),
			Error,
			"must resolve inside configDir",
		);
	} finally {
		await cleanup(configDir);
	}
});
