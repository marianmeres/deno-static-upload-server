import type { ProjectConfig } from "./config.ts";

/** Lowercased extension without leading dot. "" if none. */
export function extOf(filename: string): string {
	const i = filename.lastIndexOf(".");
	if (i < 0 || i === filename.length - 1) return "";
	return filename.slice(i + 1).toLowerCase();
}

/** Match a MIME type against an allow-list supporting exact and `type/*` wildcards. */
export function mimeMatches(mime: string, patterns: string[]): boolean {
	const m = mime.toLowerCase().split(";")[0].trim();
	for (const p of patterns) {
		const pl = p.toLowerCase();
		if (pl === m) return true;
		if (pl.endsWith("/*")) {
			const prefix = pl.slice(0, -1); // keep trailing "/"
			if (m.startsWith(prefix)) return true;
		}
	}
	return false;
}

/**
 * Return an error string if the file is rejected by project policy, else null.
 */
export function checkUploadPolicy(
	config: ProjectConfig,
	filename: string,
	mime: string,
	size: number,
): string | null {
	if (
		config.maxFileSize !== undefined &&
		size > config.maxFileSize
	) {
		return `File exceeds maxFileSize (${config.maxFileSize})`;
	}
	if (config.allowedExtensions && config.allowedExtensions.length > 0) {
		const ext = extOf(filename);
		if (!ext || !config.allowedExtensions.includes(ext)) {
			return `File extension not allowed`;
		}
	}
	if (
		config.allowedMimeTypes &&
		config.allowedMimeTypes.length > 0 &&
		!mimeMatches(mime || "application/octet-stream", config.allowedMimeTypes)
	) {
		return `MIME type not allowed`;
	}
	return null;
}
