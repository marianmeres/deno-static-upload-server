import { dirname, join, resolve } from "@std/path";
import type { ProjectConfig } from "../config.ts";
import { isAuthorized } from "../auth.ts";
import type { CdnAdapter } from "../cdn.ts";

/**
 * Handle POST /:projectId — upload file(s).
 */
export async function handleUpload(
	req: Request,
	projectId: string,
	config: ProjectConfig,
	staticDir: string,
	globalToken?: string,
	cdn?: CdnAdapter,
): Promise<Response> {
	if (!isAuthorized(req, config.uploadTokens, globalToken)) {
		return new Response("Unauthorized", { status: 401 });
	}

	let formData: FormData;
	try {
		formData = await req.formData();
	} catch {
		return new Response("Invalid form data", { status: 400 });
	}

	const uploaded: string[] = [];
	const absStaticDir = resolve(staticDir);

	for (const [_field, value] of formData.entries()) {
		if (!(value instanceof File)) continue;

		const filename = value.name;
		if (!filename) continue;

		// Sanitize each path segment individually, preserving subdir structure
		const safePath = filename
			.split("/")
			.map((segment) => segment.replace(/[^a-zA-Z0-9.\-_]/g, "_"))
			.filter(
				(segment) => segment.length > 0 && segment !== "." && segment !== "..",
			)
			.join("/");

		if (!safePath) continue;

		const destPath = join(absStaticDir, projectId, safePath);

		// Belt-and-suspenders: verify resolved path is within static dir
		if (!destPath.startsWith(absStaticDir + "/")) {
			continue;
		}

		await Deno.mkdir(dirname(destPath), { recursive: true });
		const tmpPath = destPath + `.tmp_${crypto.randomUUID()}`;
		try {
			await Deno.writeFile(tmpPath, value.stream());
			await Deno.rename(tmpPath, destPath);
		} catch (e) {
			try {
				await Deno.remove(tmpPath);
			} catch { /* ignore cleanup errors */ }
			throw e;
		}

		uploaded.push(`/${projectId}/${safePath}`);
	}

	if (uploaded.length === 0) {
		return new Response("No files received", { status: 400 });
	}

	if (cdn) await cdn.purgeCache(uploaded);

	return Response.json({ uploaded });
}
