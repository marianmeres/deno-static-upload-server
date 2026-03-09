import type { ProjectConfig } from "../config.ts";

const UPLOAD_HTML = await fetch(
	new URL("../upload.html", import.meta.url),
).then((r) => r.text());

/**
 * Handle GET /:projectId — serve the HTML upload form.
 * Returns null if the upload form is disabled for this project.
 */
export function handleForm(
	_req: Request,
	projectId: string,
	config: ProjectConfig,
	version: string,
): Response | null {
	if (config.enableUploadForm === false) return null;

	const html = UPLOAD_HTML
		.replaceAll("{{PROJECT_ID}}", projectId)
		.replaceAll("{{VERSION}}", version);

	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
