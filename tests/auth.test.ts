import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { clearConfigCache } from "../src/server.ts";
import {
	BASE,
	cleanup,
	createHandler,
	createTestJwt,
	makeUploadRequest,
	setup,
} from "./_helpers.ts";

// ─── Auth ────────────────────────────────────────────────────────────

Deno.test("auth: no tokens configured = open access", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("proj", [
			{ name: "a.txt", content: "hello" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("auth: missing header returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest("proj", [
			{ name: "a.txt", content: "hello" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("auth: wrong token returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"wrong",
		);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("auth: correct token returns 200", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"secret",
		);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("auth: per-project token isolation", async () => {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	clearConfigCache();
	await Deno.writeTextFile(
		join(configDir, "app1.json"),
		JSON.stringify({ uploadTokens: ["token-a"] }),
	);
	await Deno.writeTextFile(
		join(configDir, "app2.json"),
		JSON.stringify({ uploadTokens: ["token-b"] }),
	);
	try {
		const handler = await createHandler({ staticDir, configDir });

		// app1's token should not work for app2
		const req1 = makeUploadRequest(
			"app2",
			[{ name: "a.txt", content: "x" }],
			"token-a",
		);
		const res1 = await handler(req1);
		assertEquals(res1.status, 401);

		// app2's token works for app2
		const req2 = makeUploadRequest(
			"app2",
			[{ name: "a.txt", content: "x" }],
			"token-b",
		);
		const res2 = await handler(req2);
		assertEquals(res2.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── JWT ────────────────────────────────────────────────────────────

Deno.test("jwt: valid JWT grants access to protected GET", async () => {
	const secret = "test-jwt-secret";
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
		getAccessControl: "jwt",
		jwt: { secret },
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		// Upload a file first
		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "data.txt", content: "jwt-protected" }],
			"secret",
		);
		await handler(uploadReq);

		const jwt = await createTestJwt(secret);

		// GET with valid JWT
		const getReq = new Request(`${BASE}/proj/data.txt`, {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const res = await handler(getReq);
		assertEquals(res.status, 200);
		const text = await res.text();
		assertEquals(text, "jwt-protected");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("jwt: missing JWT on protected GET returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		getAccessControl: "jwt",
		jwt: { secret: "test" },
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/data.txt`);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("jwt: token access control on GET", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
		getAccessControl: "token",
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		// Upload a file
		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "data.txt", content: "token-protected" }],
			"secret",
		);
		await handler(uploadReq);

		// GET without token
		const noAuth = new Request(`${BASE}/proj/data.txt`);
		const res1 = await handler(noAuth);
		assertEquals(res1.status, 401);

		// GET with valid token
		const withAuth = new Request(`${BASE}/proj/data.txt`, {
			headers: { Authorization: "Bearer secret" },
		});
		const res2 = await handler(withAuth);
		assertEquals(res2.status, 200);
		await res2.text();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Global token ───────────────────────────────────────────────────

Deno.test("global token: works for upload", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["local"],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"master-key",
		);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("global token: works for delete", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["local"],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});

		// Upload a file first
		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "del.txt", content: "data" }],
			"local",
		);
		await handler(uploadReq);

		// Delete with global token
		const deleteReq = new Request(`${BASE}/proj/del.txt`, {
			method: "DELETE",
			headers: { Authorization: "Bearer master-key" },
		});
		const res = await handler(deleteReq);
		assertEquals(res.status, 200);
		const body = await res.json();
		assertEquals(body.deleted, "/proj/del.txt");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("global token: does not enable delete on open project", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});

		// Upload (open access since uploadTokens is empty)
		const uploadReq = makeUploadRequest("proj", [
			{ name: "del.txt", content: "data" },
		]);
		await handler(uploadReq);

		// Delete should still return 404 — open project has no delete endpoint
		const deleteReq = new Request(`${BASE}/proj/del.txt`, {
			method: "DELETE",
			headers: { Authorization: "Bearer master-key" },
		});
		const res = await handler(deleteReq);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("global token: wrong token returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["local"],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"wrong-key",
		);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("global token: per-project token still works", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["local"],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"local",
		);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Download tokens ────────────────────────────────────────────────

Deno.test("download tokens: protects GET", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		downloadTokens: ["dl-secret"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		const uploadReq = makeUploadRequest("proj", [
			{ name: "data.txt", content: "protected" },
		]);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/data.txt`);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("download tokens: correct token grants access", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		downloadTokens: ["dl-secret"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		const uploadReq = makeUploadRequest("proj", [
			{ name: "data.txt", content: "protected" },
		]);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/data.txt`, {
			headers: { Authorization: "Bearer dl-secret" },
		});
		const res = await handler(req);
		assertEquals(res.status, 200);
		const text = await res.text();
		assertEquals(text, "protected");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("download tokens: wrong token returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		downloadTokens: ["dl-secret"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		const uploadReq = makeUploadRequest("proj", [
			{ name: "data.txt", content: "protected" },
		]);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/data.txt`, {
			headers: { Authorization: "Bearer wrong" },
		});
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("download tokens: no downloadTokens = public access", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		const uploadReq = makeUploadRequest("proj", [
			{ name: "data.txt", content: "public" },
		]);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/data.txt`);
		const res = await handler(req);
		assertEquals(res.status, 200);
		const text = await res.text();
		assertEquals(text, "public");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("download tokens: global token bypasses downloadTokens", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		downloadTokens: ["dl-secret"],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});

		const uploadReq = makeUploadRequest("proj", [
			{ name: "data.txt", content: "protected" },
		]);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/data.txt`, {
			headers: { Authorization: "Bearer master-key" },
		});
		const res = await handler(req);
		assertEquals(res.status, 200);
		const text = await res.text();
		assertEquals(text, "protected");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("download tokens: global token bypasses getAccessControl token", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
		getAccessControl: "token",
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "master-key",
		});

		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "data.txt", content: "token-protected" }],
			"secret",
		);
		await handler(uploadReq);

		const req = new Request(`${BASE}/proj/data.txt`, {
			headers: { Authorization: "Bearer master-key" },
		});
		const res = await handler(req);
		assertEquals(res.status, 200);
		await res.text();
	} finally {
		await cleanup(staticDir, configDir);
	}
});
