import { join, resolve } from "@std/path";
import type { ProjectConfig } from "../config.ts";
import { isAuthorized } from "../auth.ts";

/**
 * Handle DELETE /:projectId/path/to/file — delete a single file.
 */
export async function handleDelete(
	req: Request,
	projectId: string,
	filePath: string,
	config: ProjectConfig,
	staticDir: string,
): Promise<Response> {
	// Delete only available when auth tokens are configured and delete is enabled
	if (config.uploadTokens.length === 0 || config.enableDelete === false) {
		return new Response("Not found", { status: 404 });
	}

	if (!isAuthorized(req, config.uploadTokens)) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (!filePath) {
		return new Response("File path is required", { status: 400 });
	}

	// Sanitize path segments
	const safePath = filePath
		.split("/")
		.map((s) => s.replace(/[^a-zA-Z0-9.\-_]/g, "_"))
		.filter((s) => s.length > 0 && s !== "." && s !== "..")
		.join("/");

	if (!safePath) {
		return new Response("Invalid file path", { status: 400 });
	}

	const absStaticDir = resolve(staticDir);
	const destPath = join(absStaticDir, projectId, safePath);

	if (!destPath.startsWith(absStaticDir + "/")) {
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

	return Response.json({
		deleted: `/${projectId}/${safePath}`,
	});
}
