import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BASE, cleanup, createHandler, makeUploadRequest, setup } from "./_helpers.ts";

// ─── Delete ─────────────────────────────────────────────────────────

Deno.test("delete: no tokens configured returns 404", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
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
		const handler = await createHandler({ staticDir, configDir });
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
		const handler = await createHandler({ staticDir, configDir });
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
		const handler = await createHandler({ staticDir, configDir });

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
		const handler = await createHandler({ staticDir, configDir });
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
		const handler = await createHandler({ staticDir, configDir });

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
		const handler = await createHandler({ staticDir, configDir });
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
