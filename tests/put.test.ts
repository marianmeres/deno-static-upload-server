import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BASE, cleanup, createHandler, makePutRequest, setup } from "./_helpers.ts";

/** A body stream that emits the given chunks and closes. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
	const enc = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(c) {
			for (const chunk of chunks) c.enqueue(enc.encode(chunk));
			c.close();
		},
	});
}

/** A body stream that emits one chunk and then stalls forever. */
function stalledStream(first: string): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(new TextEncoder().encode(first));
			// never close, never enqueue again
		},
	});
}

/** List all files (recursively) under dir. Returns [] if dir is missing. */
async function listFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	try {
		for await (const entry of Deno.readDir(dir)) {
			const full = join(dir, entry.name);
			if (entry.isDirectory) out.push(...await listFiles(full));
			else out.push(full);
		}
	} catch {
		// missing dir
	}
	return out;
}

// ─── Happy path ─────────────────────────────────────────────────────

Deno.test("put: raw body is stored, envelope reports path and size", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(
			makePutRequest("proj", "daily/backup.bin", "backup-data"),
		);
		assertEquals(res.status, 200);

		const body = await res.json();
		assertEquals(body.uploaded, ["/proj/daily/backup.bin"]);
		assertEquals(body.size, 11);

		const stored = await Deno.readTextFile(
			join(staticDir, "proj", "daily", "backup.bin"),
		);
		assertEquals(stored, "backup-data");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: overwrites an existing file", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		assertEquals((await handler(makePutRequest("proj", "f.txt", "one"))).status, 200);
		assertEquals((await handler(makePutRequest("proj", "f.txt", "two"))).status, 200);
		assertEquals(await Deno.readTextFile(join(staticDir, "proj", "f.txt")), "two");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: zero-byte body creates an empty file", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(makePutRequest("proj", "empty.bin", streamOf()));
		assertEquals(res.status, 200);
		assertEquals((await res.json()).size, 0);
		const stat = await Deno.stat(join(staticDir, "proj", "empty.bin"));
		assertEquals(stat.size, 0);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: missing body returns 400", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(makePutRequest("proj", "x.bin", null));
		assertEquals(res.status, 400);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: project-level path (no file path) is not routed", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(
			new Request(`${BASE}/proj`, { method: "PUT", body: "x" }),
		);
		assertEquals(res.status, 404);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Auth ───────────────────────────────────────────────────────────

Deno.test("put: requires token when uploadTokens configured", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: ["secret"],
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			globalToken: "gt",
		});

		assertEquals((await handler(makePutRequest("proj", "a.bin", "x"))).status, 401);
		assertEquals(
			(await handler(makePutRequest("proj", "a.bin", "x", { token: "nope" })))
				.status,
			401,
		);
		assertEquals(
			(await handler(makePutRequest("proj", "a.bin", "x", { token: "secret" })))
				.status,
			200,
		);
		assertEquals(
			(await handler(makePutRequest("proj", "b.bin", "x", { token: "gt" })))
				.status,
			200,
		);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Path handling ──────────────────────────────────────────────────

Deno.test("put: percent-encoded path decodes before sanitizing (POST parity)", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(makePutRequest("proj", "my%20file.txt", "hi"));
		assertEquals(res.status, 200);
		// "my file.txt" sanitizes to my_file.txt — same stored name as a
		// multipart POST of a file named "my file.txt"
		assertEquals((await res.json()).uploaded, ["/proj/my_file.txt"]);
		assertEquals(
			await Deno.readTextFile(join(staticDir, "proj", "my_file.txt")),
			"hi",
		);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: malformed percent-encoding returns 400 (not 500)", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(makePutRequest("proj", "bad%zzname.txt", "x"));
		assertEquals(res.status, 400);
		assertEquals(await res.text(), "Invalid path");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: path that sanitizes to empty returns 400", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		// %2F decodes to "/" which sanitizes to ""
		const res = await handler(makePutRequest("proj", "%2F", "x"));
		assertEquals(res.status, 400);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: double-encoded traversal stays inside the project dir", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		// single decode → "%2e%2e/pwn.txt"; sanitize mangles "%" to "_"
		const res = await handler(makePutRequest("proj", "%252e%252e/pwn.txt", "x"));
		assertEquals(res.status, 200);
		assertEquals((await res.json()).uploaded, ["/proj/_2e_2e/pwn.txt"]);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Size limits ────────────────────────────────────────────────────

Deno.test("put: maxFileSize enforced mid-stream without Content-Length, tmp cleaned", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		maxFileSize: 10,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(
			makePutRequest("proj", "big.bin", streamOf("0123456789", "overflow")),
		);
		assertEquals(res.status, 413);
		const body = await res.json();
		assertEquals(body.uploaded, []);
		assertEquals(body.rejected[0].reason, "size limit exceeded (10 bytes)");
		// neither the destination nor any .tmp_* file may exist
		assertEquals(await listFiles(join(staticDir, "proj")), []);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: declared Content-Length above the cap rejects early with 413", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		maxFileSize: 10,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(
			makePutRequest("proj", "big.bin", "tiny", {
				headers: { "content-length": "1000" },
			}),
		);
		assertEquals(res.status, 413);
		assertStringIncludes(
			(await res.json()).rejected[0].reason,
			"File exceeds maxFileSize (10)",
		);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: server-level maxUploadSize applies when project sets no maxFileSize", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			maxUploadSize: 10,
		});
		const res = await handler(
			makePutRequest("proj", "big.bin", streamOf("more-than-ten-bytes")),
		);
		assertEquals(res.status, 413);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: project maxFileSize overrides server maxUploadSize", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		maxFileSize: 50,
	});
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			maxUploadSize: 10,
		});
		const res = await handler(
			makePutRequest("proj", "ok.bin", streamOf("more-than-ten-bytes")),
		);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: maxUploadSize 0 disables the server-level cap", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			maxUploadSize: 0,
		});
		const res = await handler(
			makePutRequest("proj", "ok.bin", streamOf("any-size-goes-here")),
		);
		assertEquals(res.status, 200);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Integrity ──────────────────────────────────────────────────────

Deno.test("put: body shorter than declared Content-Length is rejected, nothing published", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		const res = await handler(
			makePutRequest("proj", "trunc.bin", streamOf("0123456789"), {
				headers: { "content-length": "100" },
			}),
		);
		assertEquals(res.status, 400);
		assertEquals(
			(await res.json()).rejected[0].reason,
			"incomplete body (received 10 of 100 bytes)",
		);
		assertEquals(await listFiles(join(staticDir, "proj")), []);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: stalled body hits the idle timeout, tmp cleaned", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({
			staticDir,
			configDir,
			uploadIdleTimeoutMs: 50,
		});
		const res = await handler(
			makePutRequest("proj", "stalled.bin", stalledStream("first-chunk")),
		);
		assertEquals(res.status, 408);
		assertStringIncludes(
			(await res.json()).rejected[0].reason,
			"body read idle timeout",
		);
		assertEquals(await listFiles(join(staticDir, "proj")), []);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Policy ─────────────────────────────────────────────────────────

Deno.test("put: MIME policy derives from extension, ignores request Content-Type", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		allowedMimeTypes: ["application/gzip"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });

		// .gz passes even though the request header says octet-stream
		const ok = await handler(
			makePutRequest("proj", "backup.gz", "x", {
				headers: { "content-type": "application/octet-stream" },
			}),
		);
		assertEquals(ok.status, 200);

		// .txt fails even if the header claims an allowed type
		const bad = await handler(
			makePutRequest("proj", "notes.txt", "x", {
				headers: { "content-type": "application/gzip" },
			}),
		);
		assertEquals(bad.status, 400);
		assertEquals((await bad.json()).rejected[0].reason, "MIME type not allowed");
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("put: allowedExtensions policy applies", async () => {
	const { staticDir, configDir } = await setup("proj", {
		uploadTokens: [],
		allowedExtensions: ["bin"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		assertEquals((await handler(makePutRequest("proj", "x.bin", "x"))).status, 200);
		const bad = await handler(makePutRequest("proj", "x.exe", "x"));
		assertEquals(bad.status, 400);
		assertEquals(
			(await bad.json()).rejected[0].reason,
			"File extension not allowed",
		);
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── Write failures ─────────────────────────────────────────────────

Deno.test("put: file shadowing a directory segment returns structured 500", async () => {
	const { staticDir, configDir } = await setup("proj");
	try {
		const handler = await createHandler({ staticDir, configDir });
		assertEquals((await handler(makePutRequest("proj", "a", "file"))).status, 200);
		// "a" is a file, so mkdir for "a/b" fails — must be a structured
		// envelope, not an uncaught throw
		const res = await handler(makePutRequest("proj", "a/b", "x"));
		assertEquals(res.status, 500);
		assertEquals((await res.json()).rejected[0].reason, "write failed");
	} finally {
		await cleanup(staticDir, configDir);
	}
});
