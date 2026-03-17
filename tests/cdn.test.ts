import { assertEquals } from "@std/assert";
import { BASE, cleanup, createHandler, makeUploadRequest, setup } from "./_helpers.ts";

// ─── CDN adapter integration ────────────────────────────────────────

Deno.test("cdn: no cache headers when CDN not configured", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const uploadReq = makeUploadRequest("proj", [
			{ name: "file.txt", content: "data" },
		]);
		await (await handler(uploadReq)).body?.cancel();

		const res = await handler(new Request(`${BASE}/proj/file.txt`));
		assertEquals(res.status, 200);
		const cc = res.headers.get("Cache-Control");
		assertEquals(cc, null);
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("cdn: createCdnAdapter returns undefined when not configured", async () => {
	const { createCdnAdapter } = await import("../src/cdn.ts");

	assertEquals(await createCdnAdapter(), undefined);
	assertEquals(await createCdnAdapter({}), undefined);
	assertEquals(await createCdnAdapter({ provider: "cloudflare" }), undefined);
	assertEquals(
		await createCdnAdapter({ purgeUrlPrefix: "https://x.com" }),
		undefined,
	);
});

Deno.test("cdn: createCdnAdapter throws on unknown provider", async () => {
	const { createCdnAdapter } = await import("../src/cdn.ts");

	let threw = false;
	try {
		await createCdnAdapter({
			provider: "unknown",
			purgeUrlPrefix: "https://x.com",
		});
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("Unknown CDN provider"), true);
	}
	assertEquals(threw, true);
});

Deno.test("cdn: cloudflare adapter applyCacheHeaders", async () => {
	const { CloudflareCdnAdapter } = await import("../src/cdn/cloudflare.ts");

	const adapter = new CloudflareCdnAdapter({
		zoneId: "zone123",
		apiToken: "token456",
		purgeUrlPrefix: "https://cdn.example.com",
		cacheMaxAge: 60,
		cacheSMaxAge: 120,
	});

	// 200 response gets headers
	const res200 = new Response("ok", { status: 200 });
	const modified = adapter.applyCacheHeaders(res200);
	assertEquals(
		modified.headers.get("Cache-Control"),
		"public, max-age=60, s-maxage=120",
	);

	// 404 response is not modified
	const res404 = new Response("not found", { status: 404 });
	const unmodified = adapter.applyCacheHeaders(res404);
	assertEquals(unmodified.headers.get("Cache-Control"), null);
});

Deno.test("cdn: cloudflare adapter constructor validation", async () => {
	const { CloudflareCdnAdapter } = await import("../src/cdn/cloudflare.ts");

	let threw = false;
	try {
		new CloudflareCdnAdapter({
			zoneId: "",
			apiToken: "token",
			purgeUrlPrefix: "https://x.com",
			cacheMaxAge: 60,
			cacheSMaxAge: 120,
		});
	} catch {
		threw = true;
	}
	assertEquals(threw, true);
});
