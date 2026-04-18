import { resolve } from "@std/path";
import type { ProjectConfig } from "../config.ts";
import { isAuthorized } from "../auth.ts";
import type { CdnAdapter } from "../cdn.ts";
import { resolveUnderStaticDir, sanitizePath } from "../paths.ts";
import type { Logger } from "../logger.ts";

interface DeleteDeps {
	globalToken?: string;
	cdn?: CdnAdapter;
	logger: Logger;
}

/**
 * Handle DELETE /:projectId/path/to/file — delete a single file.
 */
export async function handleDelete(
	req: Request,
	projectId: string,
	filePath: string,
	config: ProjectConfig,
	staticDir: string,
	deps: DeleteDeps,
): Promise<Response> {
	const { globalToken, cdn, logger } = deps;

	// Delete only available when auth tokens are configured and delete is enabled
	if (config.uploadTokens.length === 0 || config.enableDelete === false) {
		return new Response("Not found", { status: 404 });
	}

	if (!isAuthorized(req, config.uploadTokens, globalToken)) {
		logger.warn("delete.unauthorized", { projectId, path: filePath });
		return new Response("Unauthorized", { status: 401 });
	}

	if (!filePath) {
		return new Response("File path is required", { status: 400 });
	}

	const safePath = sanitizePath(filePath);
	if (!safePath) {
		return new Response("Invalid file path", { status: 400 });
	}

	const absStaticDir = resolve(staticDir);
	const destPath = resolveUnderStaticDir(absStaticDir, projectId, safePath);
	if (!destPath) {
		return new Response("Invalid file path", { status: 400 });
	}

	try {
		const stat = await Deno.stat(destPath);
		if (!stat.isFile) {
			return new Response("Not a file", { status: 400 });
		}
	} catch {
		return new Response("Not found", { status: 404 });
	}

	await Deno.remove(destPath);

	const deletedPath = `/${projectId}/${safePath}`;
	if (cdn) {
		queueMicrotask(() => {
			cdn.purgeCache([deletedPath]).catch((e) => {
				logger.error("cdn.purge_failed", { error: String(e) });
			});
		});
	}

	logger.info("delete.done", { projectId, path: deletedPath });

	return Response.json({ deleted: deletedPath });
}
