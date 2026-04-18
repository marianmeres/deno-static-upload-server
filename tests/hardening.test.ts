import { assertEquals } from "@std/assert";
import { BASE, cleanup, createHandler, makeUploadRequest, setup } from "./_helpers.ts";

// ─── X-Content-Type-Options: nosniff ────────────────────────────────

Deno.test("hardening: serving sets X-Content-Type-Options: nosniff", async () => {
	const { staticDir, configDir } = await setup("p");
	try {
		const handler = await createHandler({ staticDir, configDir });
		await handler(
			makeUploadRequest("p", [{ name: "x.txt", content: "hi" }]),
		);
		const res = await handler(new Request(`${BASE}/p/x.txt`));
		assertEquals(res.status, 200);
		assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── forceDownload ──────────────────────────────────────────────────

Deno.test("hardening: forceDownload adds Content-Disposition: attachment", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		forceDownload: true,
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		await handler(
			makeUploadRequest("p", [{ name: "page.html", content: "<b>hi</b>" }]),
		);
		const res = await handler(new Request(`${BASE}/p/page.html`));
		assertEquals(res.status, 200);
		assertEquals(res.headers.get("Content-Disposition"), "attachment");
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

// ─── CORS: off for protected content, on for public ─────────────────

Deno.test("hardening: CORS enabled for public content", async () => {
	const { staticDir, configDir } = await setup("p");
	try {
		const handler = await createHandler({ staticDir, configDir });
		await handler(
			makeUploadRequest("p", [{ name: "x.txt", content: "hi" }]),
		);
		const res = await handler(new Request(`${BASE}/p/x.txt`));
		assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test("hardening: CORS disabled when downloadTokens set", async () => {
	const { staticDir, configDir } = await setup("p", {
		uploadTokens: [],
		downloadTokens: ["d"],
	});
	try {
		const handler = await createHandler({ staticDir, configDir });
		await handler(
			makeUploadRequest("p", [{ name: "x.txt", content: "hi" }]),
		);
		const res = await handler(
			new Request(`${BASE}/p/x.txt`, {
				headers: { Authorization: "Bearer d" },
			}),
		);
		assertEquals(res.status, 200);
		assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
		await res.body?.cancel();
	} finally {
		await cleanup(staticDir, configDir);
	}
});

Deno.test(
	"hardening: CORS disabled when getAccessControl is token",
	async () => {
		const { staticDir, configDir } = await setup("p", {
			uploadTokens: ["t"],
			getAccessControl: "token",
		});
		try {
			const handler = await createHandler({ staticDir, configDir });
			await handler(
				makeUploadRequest("p", [{ name: "x.txt", content: "hi" }], "t"),
			);
			const res = await handler(
				new Request(`${BASE}/p/x.txt`, {
					headers: { Authorization: "Bearer t" },
				}),
			);
			assertEquals(res.status, 200);
			assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
			await res.body?.cancel();
		} finally {
			await cleanup(staticDir, configDir);
		}
	},
);

// ─── BC: enableUploadForm global option actually works now ──────────

Deno.test(
	"bc-fix: global enableUploadForm=false disables form for projects that don't set it",
	async () => {
		const { staticDir, configDir } = await setup("p", { uploadTokens: [] });
		try {
			const handler = await createHandler({
				staticDir,
				configDir,
				enableUploadForm: false,
			});
			const res = await handler(new Request(`${BASE}/p`));
			assertEquals(res.status, 404);
		} finally {
			await cleanup(staticDir, configDir);
		}
	},
);

Deno.test(
	"bc-fix: project-level enableUploadForm=true overrides global false",
	async () => {
		const { staticDir, configDir } = await setup("p", {
			uploadTokens: [],
			enableUploadForm: true,
		});
		try {
			const handler = await createHandler({
				staticDir,
				configDir,
				enableUploadForm: false,
			});
			const res = await handler(new Request(`${BASE}/p`));
			assertEquals(res.status, 200);
		} finally {
			await cleanup(staticDir, configDir);
		}
	},
);
