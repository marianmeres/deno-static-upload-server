import { serveDir } from "@std/http/file-server";
import type { ProjectConfig } from "../config.ts";
import { extractBearerToken, isAuthorized } from "../auth.ts";
import { verifyJwt } from "../jwt.ts";
import type { CdnAdapter } from "../cdn.ts";

/**
 * Handle GET/HEAD /:projectId/path/to/file — serve static files.
 */
export async function handleServe(
	req: Request,
	_projectId: string,
	config: ProjectConfig,
	staticDir: string,
	jwtSecret?: string,
	globalToken?: string,
	cdn?: CdnAdapter,
): Promise<Response> {
	// Download tokens check (takes precedence over getAccessControl)
	const downloadTokens = config.downloadTokens ?? [];
	if (downloadTokens.length > 0) {
		if (!isAuthorized(req, downloadTokens, globalToken)) {
			return new Response("Unauthorized", { status: 401 });
		}
	} else if (config.getAccessControl === "token") {
		if (
			!isAuthorized(req, config.uploadTokens, globalToken)
		) {
			return new Response("Unauthorized", { status: 401 });
		}
	} else if (config.getAccessControl === "jwt") {
		// Global token bypasses JWT check
		const bearer = extractBearerToken(req);
		if (globalToken && bearer === globalToken) {
			// authorized via global token
		} else {
			if (!bearer) {
				return new Response("Unauthorized", { status: 401 });
			}
			const secret = config.jwt?.secret ?? jwtSecret;
			if (!secret) {
				return new Response("JWT not configured", { status: 500 });
			}
			const payload = await verifyJwt(bearer, secret);
			if (!payload) {
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

	const res = await serveDir(effectiveReq, {
		fsRoot: staticDir,
		urlRoot: "",
		enableCors: true,
	});

	if (req.method === "HEAD") {
		// Close the body stream to avoid resource leaks
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
