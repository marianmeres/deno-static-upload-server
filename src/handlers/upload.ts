import { resolve } from "@std/path";
import type { ProjectConfig } from "../config.ts";
import { isAuthorized } from "../auth.ts";
import type { CdnAdapter } from "../cdn.ts";
import { resolveUnderStaticDir, sanitizePath } from "../paths.ts";
import { checkUploadPolicy } from "../content-type.ts";
import type { Logger } from "../logger.ts";
import { saveStreamAtomic, SizeLimitError } from "../storage.ts";

/** Dependencies shared by the upload handlers (POST multipart, PUT raw body). */
export interface UploadDeps {
	globalToken?: string;
	cdn?: CdnAdapter;
	logger: Logger;
	/** Server-level fallback byte cap, applied when the project sets no `maxFileSize`. */
	maxUploadSize?: number;
	/** Abort a stalled upload when no body chunk arrives within this many ms. */
	uploadIdleTimeoutMs?: number;
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
	const { globalToken, cdn, logger, maxUploadSize, uploadIdleTimeoutMs } = deps;

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
	// Project maxFileSize wins; server maxUploadSize is the fallback cap.
	const maxBytes = config.maxFileSize ?? maxUploadSize;
	let anySizeExceeded = false;
	let anyPolicyReject = false;
	let anyWriteFailed = false;

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
			{ ...config, maxFileSize: maxBytes },
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

		try {
			await saveStreamAtomic(destPath, value.stream(), {
				maxBytes,
				idleTimeoutMs: uploadIdleTimeoutMs,
			});
		} catch (e) {
			if (e instanceof SizeLimitError) {
				rejected.push({ name: filename, reason: e.message });
				anySizeExceeded = true;
				continue;
			}
			const msg = e instanceof Error ? e.message : String(e);
			logger.error("upload.write_failed", {
				projectId,
				name: filename,
				error: msg,
			});
			rejected.push({ name: filename, reason: "write failed" });
			anyWriteFailed = true;
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
		// Write failures are server faults — 5xx so clients (and their retry
		// logic) don't misread disk-full/permissions as a bad request.
		if (anyWriteFailed && !anyPolicyReject && !anySizeExceeded) {
			return Response.json({ uploaded, rejected }, { status: 500 });
		}
		return Response.json({ uploaded, rejected }, { status: 400 });
	}

	return Response.json(
		rejected.length > 0 ? { uploaded, rejected } : { uploaded },
	);
}
