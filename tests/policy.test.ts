import { assertEquals } from "@std/assert";
import { BASE, cleanup, createHandler, makeUploadRequest, setup } from "./_helpers.ts";

// ─── maxFileSize ────────────────────────────────────────────────────

Deno.test("policy: maxFileSize rejects oversized file with 413", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		maxFileSize: 5,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("p", [
			{ name: "big.txt", content: "abcdefghij" }, // 10 bytes > 5
		]);
		const res = await handler(req);
		assertEquals(res.status, 413);
		const body = await res.json();
		assertEquals(body.uploaded, []);
		assertEquals(body.rejected.length, 1);
		assertEquals(body.rejected[0].name, "big.txt");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("policy: maxFileSize permits files at or under limit", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		maxFileSize: 10,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("p", [
			{ name: "ok.txt", content: "exactly10!" }, // 10 bytes
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);
		const body = await res.json();
		assertEquals(body.uploaded, ["/p/ok.txt"]);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── allowedExtensions ─────────────────────────────────────────────

Deno.test("policy: allowedExtensions rejects disallowed extension", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		allowedExtensions: ["png", "jpg"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("p", [
			{ name: "evil.html", content: "<script>alert(1)</script>" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 400);
		const body = await res.json();
		assertEquals(body.uploaded, []);
		assertEquals(body.rejected[0].reason.includes("extension"), true);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("policy: allowedExtensions accepts case-insensitive match", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		allowedExtensions: ["png"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("p", [
			{ name: "photo.PNG", content: "data" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── allowedMimeTypes ───────────────────────────────────────────────

Deno.test("policy: allowedMimeTypes wildcard accepts type/*", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		allowedMimeTypes: ["image/*"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const formData = new FormData();
		formData.append(
			"file",
			new File(["bytes"], "a.png", { type: "image/png" }),
		);
		const req = new Request(`${BASE}/p`, { method: "POST", body: formData });
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("policy: allowedMimeTypes rejects mismatch", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		allowedMimeTypes: ["image/*"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const formData = new FormData();
		formData.append(
			"file",
			new File(["bytes"], "a.txt", { type: "text/plain" }),
		);
		const req = new Request(`${BASE}/p`, { method: "POST", body: formData });
		const res = await handler(req);
		assertEquals(res.status, 400);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Partial failure reporting ──────────────────────────────────────

Deno.test("upload: partial success includes rejected items", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		maxFileSize: 5,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("p", [
			{ name: "ok.txt", content: "ok" }, // 2 bytes
			{ name: "too-big.txt", content: "too-big-content" }, // >5
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);
		const body = await res.json();
		assertEquals(body.uploaded, ["/p/ok.txt"]);
		assertEquals(body.rejected.length, 1);
		assertEquals(body.rejected[0].name, "too-big.txt");
	} finally {
		await cleanup(staticDir, configDir);
	}
});
