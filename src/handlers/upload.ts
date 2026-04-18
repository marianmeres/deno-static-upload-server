import { dirname, resolve } from "@std/path";
import type { ProjectConfig } from "../config.ts";
import { isAuthorized } from "../auth.ts";
import type { CdnAdapter } from "../cdn.ts";
import { resolveUnderStaticDir, sanitizePath } from "../paths.ts";
import { checkUploadPolicy } from "../content-type.ts";
import type { Logger } from "../logger.ts";

interface UploadDeps {
	globalToken?: string;
	cdn?: CdnAdapter;
	logger: Logger;
}

/** Lazily stream a file to disk while enforcing a byte cap. Throws on overflow. */
async function writeWithLimit(
	tmpPath: string,
	source: ReadableStream<Uint8Array>,
	maxBytes: number | undefined,
): Promise<void> {
	const file = await Deno.open(tmpPath, {
		create: true,
		write: true,
		truncate: true,
	});
	let written = 0;
	const reader = source.getReader();
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			if (!value) continue;
			written += value.byteLength;
			if (maxBytes !== undefined && written > maxBytes) {
				throw new Error(`size limit exceeded (${maxBytes} bytes)`);
			}
			let off = 0;
			while (off < value.byteLength) {
				off += await file.write(value.subarray(off));
			}
		}
	} finally {
		try {
			file.close();
		} catch {
			// already closed
		}
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}
}

/**
 * Handle POST /:projectId — upload file(s).
 */
export async function handleUpload(
	req: Request,
	projectId: string,
	config: ProjectConfig,
	staticDir: string,
	deps: UploadDeps,
): Promise<Response> {
	const { globalToken, cdn, logger } = deps;

	if (!isAuthorized(req, config.uploadTokens, globalToken)) {
		logger.warn("upload.unauthorized", { projectId });
		return new Response("Unauthorized", { status: 401 });
	}

	let formData: FormData;
	try {
		formData = await req.formData();
	} catch {
		return new Response("Invalid form data", { status: 400 });
	}

	const uploaded: string[] = [];
	const rejected: { name: string; reason: string }[] = [];
	const absStaticDir = resolve(staticDir);
	let anySizeExceeded = false;
	let anyPolicyReject = false;

	for (const [_field, value] of formData.entries()) {
		if (!(value instanceof File)) continue;

		const filename = value.name;
		if (!filename) {
			rejected.push({ name: filename || "(unnamed)", reason: "empty filename" });
			continue;
		}

		const safePath = sanitizePath(filename);
		if (!safePath) {
			rejected.push({ name: filename, reason: "filename sanitizes to empty" });
			continue;
		}

		const policyError = checkUploadPolicy(
			config,
			safePath,
			value.type ?? "",
			value.size,
		);
		if (policyError) {
			rejected.push({ name: filename, reason: policyError });
			if (policyError.startsWith("File exceeds maxFileSize")) {
				anySizeExceeded = true;
			} else {
				anyPolicyReject = true;
			}
			continue;
		}

		const destPath = resolveUnderStaticDir(absStaticDir, projectId, safePath);
		if (!destPath) {
			rejected.push({ name: filename, reason: "path escape blocked" });
			continue;
		}

		await Deno.mkdir(dirname(destPath), { recursive: true });
		const tmpPath = destPath + `.tmp_${crypto.randomUUID()}`;
		try {
			await writeWithLimit(tmpPath, value.stream(), config.maxFileSize);
			await Deno.rename(tmpPath, destPath);
		} catch (e) {
			try {
				await Deno.remove(tmpPath);
			} catch { /* ignore cleanup errors */ }
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.startsWith("size limit exceeded")) {
				rejected.push({ name: filename, reason: msg });
				anySizeExceeded = true;
				continue;
			}
			logger.error("upload.write_failed", {
				projectId,
				name: filename,
				error: msg,
			});
			rejected.push({ name: filename, reason: "write failed" });
			continue;
		}

		uploaded.push(`/${projectId}/${safePath}`);
	}

	if (uploaded.length === 0 && rejected.length === 0) {
		return new Response("No files received", { status: 400 });
	}

	// Fire-and-forget: don't block the response on CDN round-trip.
	// The adapter contract says purgeCache must never throw.
	if (cdn && uploaded.length > 0) {
		queueMicrotask(() => {
			cdn.purgeCache(uploaded).catch((e) => {
				logger.error("cdn.purge_failed", { error: String(e) });
			});
		});
	}

	logger.info("upload.done", {
		projectId,
		uploaded: uploaded.length,
		rejected: rejected.length,
	});

	// If all files were rejected and something was attempted, surface the right status.
	if (uploaded.length === 0) {
		if (anySizeExceeded && !anyPolicyReject) {
			return Response.json({ uploaded, rejected }, { status: 413 });
		}
		return Response.json({ uploaded, rejected }, { status: 400 });
	}

	return Response.json(
		rejected.length > 0 ? { uploaded, rejected } : { uploaded },
	);
}
