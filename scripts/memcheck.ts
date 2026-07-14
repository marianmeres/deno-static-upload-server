/**
 * Measures server-side RSS while a large upload is processed, comparing the
 * multipart POST route (which buffers the parsed form in RAM via
 * `req.formData()`) with the raw-body PUT route (which streams to disk).
 *
 * The server runs as a subprocess and its RSS is sampled via `ps`, so client
 * buffers don't pollute the measurement.
 *
 * Usage:
 *   deno run -A scripts/memcheck.ts post [sizeMB]   # expect peak ≈ 3-3.5x size
 *   deno run -A scripts/memcheck.ts put  [sizeMB]   # expect no per-upload multiplier
 */

const MB = 1024 * 1024;
const mb = (n: number) => `${(n / MB).toFixed(1)} MB`;

// ─── child role: run the real server ────────────────────────────────

if (Deno.args[0] === "--serve") {
	const { createServer } = await import(
		new URL("../src/server.ts", import.meta.url).href
	);
	const { handler } = await createServer({
		staticDir: Deno.env.get("MEMCHECK_STATIC_DIR")!,
		configDir: Deno.env.get("MEMCHECK_CONFIG_DIR")!,
		maxUploadSize: 0, // unlimited — this script measures, it doesn't police
	});
	Deno.serve(
		{ port: 0, onListen: (a) => console.log(`PORT=${a.port}`) },
		handler,
	);
} else {
	// ─── parent role: measure ───────────────────────────────────────

	const mode = (Deno.args[0] ?? "put").toLowerCase();
	if (mode !== "post" && mode !== "put") {
		console.error(`Usage: deno run -A scripts/memcheck.ts [post|put] [sizeMB]`);
		Deno.exit(1);
	}
	const SIZE = Number(Deno.args[1] ?? 150) * MB;

	const staticDir = await Deno.makeTempDir();
	const configDir = await Deno.makeTempDir();
	await Deno.writeTextFile(
		`${configDir}/proj.json`,
		JSON.stringify({ uploadTokens: [] }),
	);

	const child = new Deno.Command(Deno.execPath(), {
		args: ["run", "-A", new URL(import.meta.url).pathname, "--serve"],
		env: { MEMCHECK_STATIC_DIR: staticDir, MEMCHECK_CONFIG_DIR: configDir },
		stdout: "piped",
		stderr: "inherit",
	}).spawn();

	// wait for the child to announce its port
	let port = 0;
	const reader = child.stdout.getReader();
	let buf = "";
	while (!port) {
		const { value, done } = await reader.read();
		if (done) throw new Error("server subprocess exited early");
		buf += new TextDecoder().decode(value);
		const m = buf.match(/PORT=(\d+)/);
		if (m) port = Number(m[1]);
	}

	const rss = async () => {
		const out = await new Deno.Command("ps", {
			args: ["-o", "rss=", "-p", String(child.pid)],
		}).output();
		return Number(new TextDecoder().decode(out.stdout).trim()) * 1024;
	};

	const baseline = await rss();
	let peak = baseline;
	const poll = setInterval(async () => {
		peak = Math.max(peak, await rss().catch(() => 0));
	}, 50);

	// source file streamed from disk in 1 MB chunks — no client-side buffering
	const tmp = await Deno.makeTempFile();
	const fh = await Deno.open(tmp, { write: true });
	const chunk = new Uint8Array(MB);
	for (let i = 0; i < SIZE / MB; i++) await fh.write(chunk);
	fh.close();

	const src = await Deno.open(tmp, { read: true });
	let body: ReadableStream<Uint8Array>;
	const headers: Record<string, string> = {};
	let url: string;

	if (mode === "put") {
		body = src.readable;
		url = `http://localhost:${port}/proj/big.bin`;
	} else {
		const boundary = "----memcheck";
		const head = new TextEncoder().encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n` +
				`Content-Type: application/octet-stream\r\n\r\n`,
		);
		const foot = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
		const fileReader = src.readable.getReader();
		body = new ReadableStream<Uint8Array>({
			start: (c) => c.enqueue(head),
			async pull(c) {
				const { done, value } = await fileReader.read();
				if (done) {
					c.enqueue(foot);
					c.close();
					return;
				}
				c.enqueue(value);
			},
		});
		headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
		url = `http://localhost:${port}/proj`;
	}

	console.log(`\nUploading ${mb(SIZE)} via ${mode.toUpperCase()} ...`);
	const started = performance.now();
	const res = await fetch(url, {
		method: mode.toUpperCase(),
		headers,
		body,
		// deno-lint-ignore no-explicit-any
		...({ duplex: "half" } as any),
	});
	const text = await res.text();
	const elapsed = performance.now() - started;
	const afterResponse = await rss();
	await new Promise((r) => setTimeout(r, 2000));
	const settled = await rss();
	clearInterval(poll);

	console.log(`\n  response:            ${res.status} ${text.slice(0, 120)}`);
	console.log(`  elapsed:             ${(elapsed / 1000).toFixed(1)} s`);
	console.log(`  baseline RSS:        ${mb(baseline)}`);
	console.log(`  peak RSS:            ${mb(peak)}`);
	console.log(`  RSS after response:  ${mb(afterResponse)}`);
	console.log(`  RSS after 2s:        ${mb(settled)}`);
	console.log(`  file size uploaded:  ${mb(SIZE)}`);
	console.log(
		`  peak delta / size:   ${((peak - baseline) / SIZE).toFixed(2)}x\n`,
	);

	child.kill();
	await child.status;
	await Deno.remove(tmp);
	await Deno.remove(staticDir, { recursive: true });
	await Deno.remove(configDir, { recursive: true });
	Deno.exit(0);
}
