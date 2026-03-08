import { assertEquals } from "@std/assert";
import { join } from "jsr:@std/path";
import { createServer } from "../src/server.ts";

const BASE = "http://localhost";

function makeUploadRequest(
	projectId: string,
	files: { name: string; content: string }[],
	token?: string,
): Request {
	const formData = new FormData();
	for (const f of files) {
		formData.append(
			"file",
			new File([f.content], f.name, { type: "application/octet-stream" }),
		);
	}
	const headers: Record<string, string> = {};
	if (token) headers["Authorization"] = `Bearer ${token}`;
	return new Request(`${BASE}/upload/${projectId}`, {
		method: "POST",
		body: formData,
		headers,
	});
}

// ─── Auth ────────────────────────────────────────────────────────────

Deno.test("auth: no tokens configured = open access", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir, uploadTokens: [] });
		const req = makeUploadRequest("proj", [
			{ name: "a.txt", content: "hello" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("auth: missing header returns 401", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({
			staticDir,
			uploadTokens: ["secret"],
		});
		const req = makeUploadRequest("proj", [
			{ name: "a.txt", content: "hello" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("auth: wrong token returns 401", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({
			staticDir,
			uploadTokens: ["secret"],
		});
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"wrong",
		);
		const res = await handler(req);
		assertEquals(res.status, 401);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("auth: correct token returns 200", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({
			staticDir,
			uploadTokens: ["secret"],
		});
		const req = makeUploadRequest(
			"proj",
			[{ name: "a.txt", content: "hello" }],
			"secret",
		);
		const res = await handler(req);
		assertEquals(res.status, 200);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

// ─── Upload ──────────────────────────────────────────────────────────

Deno.test("upload: valid file is stored on disk", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = makeUploadRequest("myapp", [
			{ name: "image.webp", content: "fake-image-data" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/static/myapp/image.webp"]);

		const stored = await Deno.readTextFile(
			join(staticDir, "myapp", "image.webp"),
		);
		assertEquals(stored, "fake-image-data");
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("upload: preserves subdirectory structure", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = makeUploadRequest("myapp", [
			{ name: "images/thumbs/photo.webp", content: "data" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, [
			"/static/myapp/images/thumbs/photo.webp",
		]);

		const stored = await Deno.readTextFile(
			join(staticDir, "myapp", "images", "thumbs", "photo.webp"),
		);
		assertEquals(stored, "data");
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("upload: missing projectId returns 400", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const formData = new FormData();
		formData.append(
			"file",
			new File(["x"], "a.txt", { type: "text/plain" }),
		);
		// POST to /upload/ without projectId
		const req = new Request(`${BASE}/upload/`, {
			method: "POST",
			body: formData,
		});
		const res = await handler(req);
		assertEquals(res.status, 400);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("upload: invalid projectId returns 400", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = makeUploadRequest("bad project!", [
			{ name: "a.txt", content: "x" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 400);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("upload: no files in form data returns 400", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const formData = new FormData();
		formData.append("text-field", "not a file");
		const req = new Request(`${BASE}/upload/proj`, {
			method: "POST",
			body: formData,
		});
		const res = await handler(req);
		assertEquals(res.status, 400);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

// ─── Path traversal ─────────────────────────────────────────────────

Deno.test("path traversal: .. segments are stripped", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = makeUploadRequest("proj", [
			{ name: "../../etc/passwd", content: "pwned" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		// ".." segments stripped, result is "etc/passwd" within static dir
		assertEquals(body.uploaded, ["/static/proj/etc/passwd"]);

		// Verify the file is safely inside the static dir
		const stored = await Deno.readTextFile(
			join(staticDir, "proj", "etc", "passwd"),
		);
		assertEquals(stored, "pwned");
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("path traversal: dot segments are stripped", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = makeUploadRequest("proj", [
			{ name: "./foo/./bar.txt", content: "ok" },
		]);
		const res = await handler(req);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/static/proj/foo/bar.txt"]);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

// ─── Static serving ─────────────────────────────────────────────────

Deno.test("static: GET uploaded file returns correct content", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });

		// First upload
		const uploadReq = makeUploadRequest("proj", [
			{ name: "hello.txt", content: "world" },
		]);
		await handler(uploadReq);

		// Then fetch
		const getReq = new Request(`${BASE}/static/proj/hello.txt`);
		const res = await handler(getReq);
		assertEquals(res.status, 200);
		const text = await res.text();
		assertEquals(text, "world");
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("static: GET non-existent file returns 404", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = new Request(`${BASE}/static/proj/nope.txt`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

// ─── Route matching ─────────────────────────────────────────────────

Deno.test("route: GET /staticfoo returns 404", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });
		const req = new Request(`${BASE}/staticfoo`);
		const res = await handler(req);
		assertEquals(res.status, 404);
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});

Deno.test("route: HEAD request is handled", async () => {
	const staticDir = await Deno.makeTempDir();
	try {
		const { handler } = createServer({ staticDir });

		// Upload a file first
		const uploadReq = makeUploadRequest("proj", [
			{ name: "test.txt", content: "data" },
		]);
		await handler(uploadReq);

		// HEAD request
		const req = new Request(`${BASE}/static/proj/test.txt`, {
			method: "HEAD",
		});
		const res = await handler(req);
		assertEquals(res.status, 200);
		const body = await res.text();
		assertEquals(body, "");
	} finally {
		await Deno.remove(staticDir, { recursive: true });
	}
});
