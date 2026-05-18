import { join } from "@std/path";

/** Access control mode for GET requests. */
export type GetAccessControl = "public" | "token" | "jwt";

/** CDN cache strategy for a project's files. */
export type CacheStrategy = "mutable" | "immutable";

/**
 * Per-project cache strategy: a single value applied to every file, or a map
 * of path prefix → strategy. In the map form, keys are matched against the
 * request path inside the project static dir (e.g. `/img/abc.jpg`); a bare
 * `*` or `/` is the fallback for unmatched paths. Longest matching prefix wins.
 */
export type CacheStrategyConfig =
	| CacheStrategy
	| Record<string, CacheStrategy>;

/** JWT configuration for a project. */
export interface JwtConfig {
	/** Per-project JWT secret. Falls back to global JWT_SECRET if not set. */
	secret?: string;
}

/** Configuration for a single project, loaded from CONFIG_DIR/{projectId}.json */
export interface ProjectConfig {
	/** Bearer tokens for upload/delete authorization. Empty array disables auth. */
	uploadTokens: string[];
	/** Whether to serve the HTML upload form on GET /:projectId. @default true */
	enableUploadForm?: boolean;
	/** Whether DELETE is enabled. Only works when uploadTokens is non-empty. @default true */
	enableDelete?: boolean;
	/** Path to a custom plugin module, relative to configDir. */
	plugin?: string;
	/** JWT configuration. */
	jwt?: JwtConfig;
	/** Bearer tokens for download authorization. Non-empty array enables download auth. */
	downloadTokens?: string[];
	/** Access control for GET file requests. @default "public" */
	getAccessControl?: GetAccessControl;
	/**
	 * CDN cache strategy. `"immutable"` for content-hashed filenames; otherwise
	 * `"mutable"` (the default). May also be a map of path prefix → strategy
	 * for per-subpath control within one project — see {@linkcode CacheStrategyConfig}.
	 * @default "mutable"
	 */
	cacheStrategy?: CacheStrategyConfig;
	/** Maximum per-file size in bytes. Rejects larger uploads with 413. No limit if undefined. */
	maxFileSize?: number;
	/** Allowed file extensions (lowercase, no dot). Rejects others with 400. No restriction if undefined. */
	allowedExtensions?: string[];
	/** Allowed MIME types (exact match, or `type/*` wildcard). No restriction if undefined. */
	allowedMimeTypes?: string[];
	/** Force `Content-Disposition: attachment` for served files to prevent inline XSS. @default false */
	forceDownload?: boolean;
}

const configCache = new Map<string, ProjectConfig>();

const PROJECT_ID_RE = /^[a-zA-Z0-9\-_]+$/;

/** Validate a project ID string. */
export function isValidProjectId(id: string): boolean {
	return PROJECT_ID_RE.test(id);
}

function cacheKey(configDir: string, projectId: string): string {
	return `${configDir}\0${projectId}`;
}

function isCacheStrategyValue(v: unknown): v is CacheStrategy {
	return v === "mutable" || v === "immutable";
}

/**
 * Validate and normalize the raw `cacheStrategy` value loaded from JSON.
 * Accepts a string scalar, a `prefix → strategy` map, or `undefined`.
 * For the map form, keys are normalized: a leading `/` is ensured, a trailing
 * `*` is stripped, and the fallback (`*` / `/` / `""` / `/*`) is stored as `""`.
 */
function normalizeCacheStrategy(
	raw: unknown,
	projectId: string,
): CacheStrategyConfig | undefined {
	if (raw === undefined) return undefined;

	if (typeof raw === "string") {
		if (!isCacheStrategyValue(raw)) {
			throw new Error(
				`Invalid "cacheStrategy" (must be "mutable" or "immutable", projectId="${projectId}")`,
			);
		}
		return raw;
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(
			`Invalid "cacheStrategy" (must be "mutable" | "immutable" or an object of prefix → strategy, projectId="${projectId}")`,
		);
	}

	const out: Record<string, CacheStrategy> = {};
	for (const [rawKey, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!isCacheStrategyValue(value)) {
			throw new Error(
				`Invalid "cacheStrategy[${JSON.stringify(rawKey)}]" (must be "mutable" or "immutable", projectId="${projectId}")`,
			);
		}
		// Strip trailing `*` (so `/img/*` and `/img/` are equivalent).
		let key = rawKey.endsWith("*") ? rawKey.slice(0, -1) : rawKey;
		// `*`, `/`, or `""` → fallback bucket
		if (key === "" || key === "/") {
			key = "";
		} else if (!key.startsWith("/")) {
			key = "/" + key;
		}
		out[key] = value;
	}
	return out;
}

/**
 * Load and cache a project config from CONFIG_DIR/{projectId}.json.
 * Returns null if the config file does not exist.
 * Throws on invalid JSON or missing required fields.
 */
export async function loadProjectConfig(
	configDir: string,
	projectId: string,
): Promise<ProjectConfig | null> {
	const key = cacheKey(configDir, projectId);
	const cached = configCache.get(key);
	if (cached) return cached;

	const configPath = join(configDir, `${projectId}.json`);

	let raw: string;
	try {
		raw = await Deno.readTextFile(configPath);
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return null;
		throw e;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(
			`Invalid JSON in project config (projectId="${projectId}")`,
		);
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new Error(
			`Project config must be a JSON object (projectId="${projectId}")`,
		);
	}

	const config = parsed as Record<string, unknown>;

	// uploadTokens is required
	if (!Array.isArray(config.uploadTokens)) {
		throw new Error(
			`Missing or invalid "uploadTokens" (must be an array, projectId="${projectId}")`,
		);
	}

	for (const t of config.uploadTokens) {
		if (typeof t !== "string") {
			throw new Error(
				`All uploadTokens must be strings (projectId="${projectId}")`,
			);
		}
	}

	// Validate downloadTokens if present
	if (config.downloadTokens !== undefined) {
		if (!Array.isArray(config.downloadTokens)) {
			throw new Error(
				`Invalid "downloadTokens" (must be an array, projectId="${projectId}")`,
			);
		}
		for (const t of config.downloadTokens) {
			if (typeof t !== "string") {
				throw new Error(
					`All downloadTokens must be strings (projectId="${projectId}")`,
				);
			}
		}
	}

	// Validate allowedExtensions if present
	if (config.allowedExtensions !== undefined) {
		if (!Array.isArray(config.allowedExtensions)) {
			throw new Error(
				`Invalid "allowedExtensions" (must be an array, projectId="${projectId}")`,
			);
		}
		for (const t of config.allowedExtensions) {
			if (typeof t !== "string") {
				throw new Error(
					`All allowedExtensions must be strings (projectId="${projectId}")`,
				);
			}
		}
	}

	// Validate allowedMimeTypes if present
	if (config.allowedMimeTypes !== undefined) {
		if (!Array.isArray(config.allowedMimeTypes)) {
			throw new Error(
				`Invalid "allowedMimeTypes" (must be an array, projectId="${projectId}")`,
			);
		}
		for (const t of config.allowedMimeTypes) {
			if (typeof t !== "string") {
				throw new Error(
					`All allowedMimeTypes must be strings (projectId="${projectId}")`,
				);
			}
		}
	}

	if (
		config.maxFileSize !== undefined &&
		(typeof config.maxFileSize !== "number" ||
			config.maxFileSize < 0 ||
			!Number.isFinite(config.maxFileSize))
	) {
		throw new Error(
			`Invalid "maxFileSize" (must be a non-negative number, projectId="${projectId}")`,
		);
	}

	const cacheStrategy = normalizeCacheStrategy(config.cacheStrategy, projectId);

	const result: ProjectConfig = {
		uploadTokens: config.uploadTokens as string[],
		downloadTokens: Array.isArray(config.downloadTokens)
			? (config.downloadTokens as string[])
			: undefined,
		// Only set when explicitly provided in the JSON. Leaving it undefined
		// lets the server-level default apply without being silently overridden.
		enableUploadForm: typeof config.enableUploadForm === "boolean"
			? config.enableUploadForm
			: undefined,
		enableDelete: typeof config.enableDelete === "boolean"
			? config.enableDelete
			: undefined,
		plugin: typeof config.plugin === "string" ? config.plugin : undefined,
		getAccessControl: config.getAccessControl === "token" ||
				config.getAccessControl === "jwt"
			? config.getAccessControl
			: "public",
		cacheStrategy,
		maxFileSize: typeof config.maxFileSize === "number"
			? config.maxFileSize
			: undefined,
		allowedExtensions: Array.isArray(config.allowedExtensions)
			? (config.allowedExtensions as string[]).map((e) =>
				e.toLowerCase().replace(/^\./, "")
			)
			: undefined,
		allowedMimeTypes: Array.isArray(config.allowedMimeTypes)
			? (config.allowedMimeTypes as string[]).map((m) => m.toLowerCase())
			: undefined,
		forceDownload: typeof config.forceDownload === "boolean"
			? config.forceDownload
			: undefined,
	};

	// JWT config
	if (
		typeof config.jwt === "object" &&
		config.jwt !== null &&
		!Array.isArray(config.jwt)
	) {
		const jwt = config.jwt as Record<string, unknown>;
		result.jwt = {
			secret: typeof jwt.secret === "string" ? jwt.secret : undefined,
		};
	}

	configCache.set(key, result);
	return result;
}

/**
 * Clear the config cache.
 * When `configDir` is given, clears only entries for that directory.
 * Otherwise clears the whole cache.
 */
export function clearConfigCache(configDir?: string): void {
	if (configDir === undefined) {
		configCache.clear();
		return;
	}
	const prefix = `${configDir}\0`;
	for (const key of configCache.keys()) {
		if (key.startsWith(prefix)) configCache.delete(key);
	}
}
