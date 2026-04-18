import { join, relative, resolve } from "@std/path";

/**
 * Sanitize a user-supplied relative path into `segment/segment/...`:
 * - split on `/`, replace unsafe chars with `_` per segment
 * - drop empty, `.`, and `..` segments
 *
 * Returns "" if the sanitized path is empty.
 */
export function sanitizePath(filePath: string): string {
	return filePath
		.split("/")
		.map((seg) => seg.replace(/[^a-zA-Z0-9.\-_]/g, "_"))
		.filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
		.join("/");
}

/**
 * Resolve a project-scoped file path to an absolute path anchored inside
 * absStaticDir. Returns null if the resolved path escapes absStaticDir.
 *
 * Uses @std/path `relative()` for a robust, platform-safe boundary check.
 */
export function resolveUnderStaticDir(
	absStaticDir: string,
	projectId: string,
	safePath: string,
): string | null {
	const destPath = resolve(join(absStaticDir, projectId, safePath));
	const rel = relative(absStaticDir, destPath);
	if (rel === "" || rel.startsWith("..") || /^(\/|[a-zA-Z]:[\\/])/.test(rel)) {
		return null;
	}
	return destPath;
}
