import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { clearConfigCache } from "../src/server.ts";
import { BASE, cleanup, createHandler, makeUploadRequest, setup } from "./_helpers.ts";

// ─── Static serving ─────────────────────────────────────────────────

Deno.test("static: GET uploaded file returns correct content", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });

		const uploadReq = makeUploadRequest("proj", [
			{ name: "hello.txt", content: "world" },
		]);
		await handler(uploadReq);

		const getReq = new Request(`${BASE}/proj/hello.txt`);
		const res = await handler(getReq);
		assertEquals(res.status, 200);
		const text = await res.text();
		assertEquals(text, "world");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("static: GET non-existent file returns 404", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/nope.txt`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Route matching ─────────────────────────────────────────────────

Deno.test("route: invalid projectId returns 404", async () => {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	clearConfigCache();
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/bad%20project!`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("route: HEAD request is handled", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });

		const uploadReq = makeUploadRequest("proj", [
			{ name: "test.txt", content: "data" },
		]);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/test.txt`, {
			method: "HEAD",
		});
		const res = await handler(req);
		assertEquals(res.status, 200);
		const body = await res.text();
		assertEquals(body, "");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Upload form ────────────────────────────────────────────────────

Deno.test("form: GET /:projectId returns HTML form", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		enableUploadForm: true,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/proj`);
		const res = await handler(req);
		assertEquals(res.status, 200);
		const ct = res.headers.get("content-type");
		assertEquals(ct, "text/html; charset=utf-8");
		const html = await res.text();
		assertEquals(html.includes("proj"), true);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("form: disabled upload form returns 404", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		enableUploadForm: false,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/proj`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Root-level files ───────────────────────────────────────────────

Deno.test(
	"root-level: GET /favicon.ico serves from staticDir root",
	async () => {
		const staticDir = await Deno.makeTempDir();
		const configDir = await Deno.makeTempDir();
		clearConfigCache();
		await Deno.writeTextFile(join(staticDir, "favicon.ico"), "icon-data");
		try {
			const handler = await createHandler({ staticDir, configDir });
			const req = new Request(`${BASE}/favicon.ico`);
			const res = await handler(req);
			assertEquals(res.status, 200);
			const text = await res.text();
			assertEquals(text, "icon-data");
		} finally {
			await cleanup(staticDir, configDir);
		}
	},
);

Deno.test("root-level: GET /robots.txt returns 404 if not exists", async () => {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	clearConfigCache();
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/robots.txt`);
		const res = await handler(req);
		assertEquals(res.status, 404);
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});
