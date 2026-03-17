import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { clearConfigCache, createServer } from "../src/server.ts";

const BASE = "http://localhost";

/** Create a temp dir pair (staticDir + configDir) and a project config file. */
async function setup(
	projectId: string,
	config: Record<string, unknown> = { uploadTokens: [] },
) {
	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	await Deno.writeTextFile(
		join(configDir, `${projectId}.json`),
		JSON.stringify(config),
	);
	clearConfigCache();
	return { staticDir, configDir };
}

async function cleanup(...dirs: string[]) {
	for (const dir of dirs) {
		await Deno.remove(dir, { recursive: true });
	}
}

function makeUploadRequest(
	projectId: string,
	files: { name: string; content: string }[],
	token?: string,
): Request {
	const formData = new FormData();
	for (const f of files) {
		formData.append(
			"file",
			new File([f.content], f.name, {
				type: "application/octet-stream",
			}),
		);
	}
	const headers: Record<string, string> = {};
	if (token) headers["Authorization"] = `Bearer ${token}`;
	return new Request(`${BASE}/${projectId}`, {
		method: "POST",
		body: formData,
		headers,
	});
}

// ─── Version endpoint ───────────────────────────────────────────────

Deno.test("version: GET / returns version only", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/notoken`);
		const res = await handler(req);
		assertEquals(res.status, 500);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Auth ────────────────────────────────────────────────────────────

Deno.test("auth: no tokens configured = open access", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });

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

// ─── Upload ──────────────────────────────────────────────────────────

Deno.test("upload: valid file is stored on disk", async () => {
	const { staticDir, configDir } = await setup("myapp");
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = makeUploadRequest("myapp", [
			{ name: "image.webp", content: "fake-image-data" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/myapp/image.webp"]);

		const stored = await Deno.readTextFile(
			join(staticDir, "myapp", "image.webp"),
		);
		assertEquals(stored, "fake-image-data");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("upload: preserves subdirectory structure", async () => {
	const { staticDir, configDir } = await setup("myapp");
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = makeUploadRequest("myapp", [
			{ name: "images/thumbs/photo.webp", content: "data" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/myapp/images/thumbs/photo.webp"]);

		const stored = await Deno.readTextFile(
			join(staticDir, "myapp", "images", "thumbs", "photo.webp"),
		);
		assertEquals(stored, "data");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("upload: no files in form data returns 400", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const { handler } = createServer({ staticDir, configDir });
		const formData = new FormData();
		formData.append("text-field", "not a file");
		const req = new Request(`${BASE}/proj`, {
			method: "POST",
			body: formData,
		});
		const res = await handler(req);
		assertEquals(res.status, 400);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Path traversal ─────────────────────────────────────────────────

Deno.test("path traversal: .. segments are stripped", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = makeUploadRequest("proj", [
			{ name: "../../etc/passwd", content: "pwned" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/proj/etc/passwd"]);

		const stored = await Deno.readTextFile(
			join(staticDir, "proj", "etc", "passwd"),
		);
		assertEquals(stored, "pwned");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("path traversal: dot segments are stripped", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = makeUploadRequest("proj", [
			{ name: "./foo/./bar.txt", content: "ok" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/proj/foo/bar.txt"]);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Static serving ─────────────────────────────────────────────────

Deno.test("static: GET uploaded file returns correct content", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const { handler } = createServer({ staticDir, configDir });

		// First upload
		const uploadReq = makeUploadRequest("proj", [
			{ name: "hello.txt", content: "world" },
		]);
		await handler(uploadReq);

		// Then fetch
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
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/nope.txt`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Delete ─────────────────────────────────────────────────────────

Deno.test("delete: no tokens configured returns 404", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/file.txt`, {
			method: "DELETE",
		});
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("delete: missing auth header returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/file.txt`, {
			method: "DELETE",
		});
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("delete: wrong token returns 401", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/file.txt`, {
			method: "DELETE",
			headers: { Authorization: "Bearer wrong" },
		});
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("delete: existing file is removed", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });

		// Upload a file first
		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "hello.txt", content: "world" }],
			"secret",
		);
		await handler(uploadReq);

		// Verify it exists
		const content = await Deno.readTextFile(
			join(staticDir, "proj", "hello.txt"),
		);
		assertEquals(content, "world");

		// Delete it
		const deleteReq = new Request(`${BASE}/proj/hello.txt`, {
			method: "DELETE",
			headers: { Authorization: "Bearer secret" },
		});
		const res = await handler(deleteReq);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.deleted, "/proj/hello.txt");

		// Verify it's gone
		let exists = true;
		try {
			await Deno.stat(join(staticDir, "proj", "hello.txt"));
		} catch {
			exists = false;
		}
		assertEquals(exists, false);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("delete: non-existent file returns 404", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/proj/nope.txt`, {
			method: "DELETE",
			headers: { Authorization: "Bearer secret" },
		});
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("delete: path traversal is prevented", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });

		// Upload a file first
		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "safe.txt", content: "data" }],
			"secret",
		);
		await handler(uploadReq);

		// Try to delete with traversal
		const req = new Request(`${BASE}/proj/../../etc/passwd`, {
			method: "DELETE",
			headers: { Authorization: "Bearer secret" },
		});
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("delete: missing file path returns 404", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const { handler } = createServer({ staticDir, configDir });
		// DELETE /proj — no file path, goes to project-level route
		const req = new Request(`${BASE}/proj`, {
			method: "DELETE",
			headers: { Authorization: "Bearer secret" },
		});
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });

		// Upload a file first
		const uploadReq = makeUploadRequest("proj", [
			{ name: "test.txt", content: "data" },
		]);
		await handler(uploadReq);

		// HEAD request
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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/proj`);
		const res = await handler(req);
		assertEquals(res.status, 404);
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
		const { handler } = createServer({ staticDir, configDir });

		// Upload a file first
		const uploadReq = makeUploadRequest(
			"proj",
			[{ name: "data.txt", content: "jwt-protected" }],
			"secret",
		);
		await handler(uploadReq);

		// Create a valid JWT (HS256)
		const encoder = new TextEncoder();
		const headerB64 = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const payloadB64 = btoa(
			JSON.stringify({
				sub: "test",
				exp: Math.floor(Date.now() / 1000) + 3600,
			}),
		)
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const data = encoder.encode(`${headerB64}.${payloadB64}`);
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign("HMAC", key, data);
		const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const jwt = `${headerB64}.${payloadB64}.${sigB64}`;

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
		const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });

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
		await res2.text(); // consume body to avoid resource leak
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
		const { handler } = createServer({
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
		const { handler } = createServer({
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
		const { handler } = createServer({
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
		const { handler } = createServer({
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
		const { handler } = createServer({
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
		const { handler } = createServer({ staticDir, configDir });

		// Upload a file (open access)
		const uploadReq = makeUploadRequest("proj", [
			{ name: "data.txt", content: "protected" },
		]);
		await handler(uploadReq);

		// GET without token
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
		const { handler } = createServer({ staticDir, configDir });

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
		const { handler } = createServer({ staticDir, configDir });

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
		const { handler } = createServer({ staticDir, configDir });

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
		const { handler } = createServer({
			staticDir,
			configDir,
			globalToken: "master-key",
		});

		// Upload (open access since uploadTokens is empty)
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
		const { handler } = createServer({
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

		// Global token should work even though getAccessControl is "token"
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

// ─── Root-level files ───────────────────────────────────────────────

Deno.test(
	"root-level: GET /favicon.ico serves from staticDir root",
	async () => {
		const staticDir = await Deno.makeTempDir();
		const configDir = await Deno.makeTempDir();
		clearConfigCache();
		await Deno.writeTextFile(join(staticDir, "favicon.ico"), "icon-data");
		try {
			const { handler } = createServer({ staticDir, configDir });
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
		const { handler } = createServer({ staticDir, configDir });
		const req = new Request(`${BASE}/robots.txt`);
		const res = await handler(req);
		assertEquals(res.status, 404);
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});
