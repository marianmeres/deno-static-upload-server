import { resolve } from "@std/path";
import { contentType } from "@std/media-types";
import type { ProjectConfig } from "../config.ts";
import { isAuthorized } from "../auth.ts";
import { resolveUnderStaticDir, sanitizePath } from "../paths.ts";
import { checkUploadPolicy, extOf } from "../content-type.ts";
import type { UploadDeps } from "./upload.ts";
import {
	IdleTimeoutError,
	IncompleteBodyError,
	saveStreamAtomic,
	SizeLimitError,
} from "../storage.ts";

/** Same partial-failure envelope as the POST handler, for a single file. */
function rejectedJson(name: string, reason: string, status: number): Response {
	return Response.json({ uploaded: [], rejected: [{ name, reason }] }, { status });
}

/** Fire-and-forget discard of a body we won't store, so the runtime stops draining it. */
function discardBody(req: Request): void {
	req.body?.cancel().catch(() => {});
}

/**
 * Handle PUT /:projectId/path/to/file — streaming raw-body upload.
 *
 * The request body IS the file: bytes go straight from the socket to disk
 * (O(1) memory, unlike the multipart POST route which buffers the parsed
 * form in RAM). The destination path comes from the URL.
 */
export async function handlePut(
	req: Request,
	projectId: string,
	filePath: string,
	config: ProjectConfig,
	staticDir: string,
	deps: UploadDeps,
): Promise<Response> {
	const { globalToken, cdn, logger, maxUploadSize, uploadIdleTimeoutMs } = deps;

	if (!isAuthorized(req, config.uploadTokens, globalToken)) {
		logger.warn("upload.unauthorized", { projectId, via: "put" });
		discardBody(req);
		return new Response("Unauthorized", { status: 401 });
	}

	if (!req.body) {
		return new Response("Missing request body", { status: 400 });
	}

	// The URL path arrives percent-encoded; decode before sanitizing so
	// `PUT /proj/my%20file.txt` and a multipart filename "my file.txt" store
	// under the same name (GET decodes as well). Malformed sequences → 400.
	let decoded: string;
	try {
		decoded = decodeURIComponent(filePath);
	} catch {
		discardBody(req);
		return new Response("Invalid path", { status: 400 });
	}

	const safePath = sanitizePath(decoded);
	if (!safePath) {
		discardBody(req);
		return new Response("Invalid path", { status: 400 });
	}

	// Project maxFileSize wins; server maxUploadSize is the fallback cap.
	const maxBytes = config.maxFileSize ?? maxUploadSize;

	// Advisory pre-check on the declared length — rejects an oversized upload
	// before reading it. Client-supplied, so the mid-stream cap below stays
	// authoritative. (Deno's fetch sends streamed bodies chunked, without
	// Content-Length; curl-style clients declare it.)
	const declared = Number(req.headers.get("content-length") ?? NaN);
	const hasDeclared = Number.isFinite(declared) && declared >= 0;
	if (hasDeclared && maxBytes !== undefined && declared > maxBytes) {
		discardBody(req);
		return rejectedJson(safePath, `File exceeds maxFileSize (${maxBytes})`, 413);
	}

	// Extension/MIME policy. The MIME is derived from the extension — not the
	// request Content-Type header — so the check matches what GET will later
	// serve and cannot be satisfied by header spoofing. Size 0: the byte size
	// is unknown until the body is consumed; the stream cap enforces it.
	const derivedMime = contentType(extOf(safePath)) ?? "";
	const policyError = checkUploadPolicy(
		{ ...config, maxFileSize: maxBytes },
		safePath,
		derivedMime,
		0,
	);
	if (policyError) {
		discardBody(req);
		return rejectedJson(safePath, policyError, 400);
	}

	const destPath = resolveUnderStaticDir(resolve(staticDir), projectId, safePath);
	if (!destPath) {
		discardBody(req);
		return rejectedJson(safePath, "path escape blocked", 400);
	}

	let size: number;
	try {
		size = await saveStreamAtomic(destPath, req.body, {
			maxBytes,
			expectedBytes: hasDeclared ? declared : undefined,
			idleTimeoutMs: uploadIdleTimeoutMs,
		});
	} catch (e) {
		discardBody(req);
		if (e instanceof SizeLimitError) {
			return rejectedJson(safePath, e.message, 413);
		}
		if (e instanceof IncompleteBodyError) {
			return rejectedJson(safePath, e.message, 400);
		}
		if (e instanceof IdleTimeoutError) {
			logger.warn("upload.idle_timeout", { projectId, name: safePath });
			return rejectedJson(safePath, e.message, 408);
		}
		const msg = e instanceof Error ? e.message : String(e);
		logger.error("upload.write_failed", {
			projectId,
			name: safePath,
			error: msg,
			via: "put",
		});
		return rejectedJson(safePath, "write failed", 500);
	}

	const uploadedPath = `/${projectId}/${safePath}`;
	if (cdn) {
		queueMicrotask(() => {
			cdn.purgeCache([uploadedPath]).catch((e) => {
				logger.error("cdn.purge_failed", { error: String(e) });
			});
		});
	}

	logger.info("upload.done", {
		projectId,
		uploaded: 1,
		rejected: 0,
		via: "put",
		size,
	});

	// `size` (bytes written) lets chunked clients — which send no
	// Content-Length — verify the server stored what they sent.
	return Response.json({ uploaded: [uploadedPath], size });
}
