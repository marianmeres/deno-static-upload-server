import { serveDir } from "@std/http/file-server";
import type { ProjectConfig } from "../config.ts";
import { extractBearerToken, isAuthorized, timingSafeEqualStr } from "../auth.ts";
import { verifyJwt } from "../jwt.ts";
import type { CdnAdapter } from "../cdn.ts";
import type { Logger } from "../logger.ts";

interface ServeDeps {
	jwtSecret?: string;
	globalToken?: string;
	cdn?: CdnAdapter;
	logger: Logger;
}

function isProtected(config: ProjectConfig): boolean {
	return (
		(config.downloadTokens?.length ?? 0) > 0 ||
		config.getAccessControl === "token" ||
		config.getAccessControl === "jwt"
	);
}

function addHardeningHeaders(res: Response, forceDownload?: boolean): Response {
	const headers = new Headers(res.headers);
	// Prevent MIME sniffing — user-uploaded content must not be reinterpreted.
	headers.set("X-Content-Type-Options", "nosniff");
	if (forceDownload && !headers.has("Content-Disposition")) {
		headers.set("Content-Disposition", "attachment");
	}
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

/**
 * Handle GET/HEAD /:projectId/path/to/file — serve static files.
 */
export async function handleServe(
	req: Request,
	_projectId: string,
	config: ProjectConfig,
	staticDir: string,
	deps: ServeDeps,
): Promise<Response> {
	const { jwtSecret, globalToken, cdn, logger } = deps;

	// Download tokens check (takes precedence over getAccessControl)
	const downloadTokens = config.downloadTokens ?? [];
	if (downloadTokens.length > 0) {
		if (!isAuthorized(req, downloadTokens, globalToken)) {
			logger.warn("serve.unauthorized", { reason: "downloadTokens" });
			return new Response("Unauthorized", { status: 401 });
		}
	} else if (config.getAccessControl === "token") {
		if (!isAuthorized(req, config.uploadTokens, globalToken)) {
			logger.warn("serve.unauthorized", { reason: "token" });
			return new Response("Unauthorized", { status: 401 });
		}
	} else if (config.getAccessControl === "jwt") {
		// Global token bypasses JWT check
		const bearer = extractBearerToken(req);
		if (globalToken && bearer && timingSafeEqualStr(bearer, globalToken)) {
			// authorized via global token
		} else {
			if (!bearer) {
				logger.warn("serve.unauthorized", { reason: "jwt_missing" });
				return new Response("Unauthorized", { status: 401 });
			}
			const secret = config.jwt?.secret ?? jwtSecret;
			if (!secret) {
				logger.error("serve.jwt_not_configured");
				return new Response("JWT not configured", { status: 500 });
			}
			const payload = await verifyJwt(bearer, secret);
			if (!payload) {
				logger.warn("serve.unauthorized", { reason: "jwt_invalid" });
				return new Response("Unauthorized", { status: 401 });
			}
		}
	}

	// serveDir only accepts GET, so convert HEAD→GET and strip body
	const effectiveReq = req.method === "HEAD"
		? new Request(req.url, {
			method: "GET",
			headers: req.headers,
		})
		: req;

	// CORS: only advertise on public content. Protected content should not be
	// fetchable cross-origin without an explicit server-side opt-in.
	const enableCors = !isProtected(config);

	let res = await serveDir(effectiveReq, {
		fsRoot: staticDir,
		urlRoot: "",
		enableCors,
	});

	// Apply hardening headers before anything else copies them.
	res = addHardeningHeaders(res, config.forceDownload);

	if (req.method === "HEAD") {
		res.body?.cancel();
		const headRes = new Response(null, {
			status: res.status,
			headers: res.headers,
		});
		const immutable = config.cacheStrategy === "immutable";
		return cdn ? cdn.applyCacheHeaders(headRes, immutable) : headRes;
	}

	const immutable = config.cacheStrategy === "immutable";
	return cdn ? cdn.applyCacheHeaders(res, immutable) : res;
}
