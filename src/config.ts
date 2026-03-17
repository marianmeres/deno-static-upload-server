import { join } from "@std/path";

/** Access control mode for GET requests. */
export type GetAccessControl = "public" | "token" | "jwt";

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
}

const configCache = new Map<string, ProjectConfig>();

const PROJECT_ID_RE = /^[a-zA-Z0-9\-_]+$/;

/** Validate a project ID string. */
export function isValidProjectId(id: string): boolean {
	return PROJECT_ID_RE.test(id);
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
	const cached = configCache.get(projectId);
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
		throw new Error(`Invalid JSON in config file: ${configPath}`);
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new Error(`Config must be a JSON object: ${configPath}`);
	}

	const config = parsed as Record<string, unknown>;

	// uploadTokens is required
	if (!Array.isArray(config.uploadTokens)) {
		throw new Error(
			`Missing or invalid "uploadTokens" (must be an array) in: ${configPath}`,
		);
	}

	for (const t of config.uploadTokens) {
		if (typeof t !== "string") {
			throw new Error(
				`All uploadTokens must be strings in: ${configPath}`,
			);
		}
	}

	// Validate downloadTokens if present
	if (config.downloadTokens !== undefined) {
		if (!Array.isArray(config.downloadTokens)) {
			throw new Error(
				`Invalid "downloadTokens" (must be an array) in: ${configPath}`,
			);
		}
		for (const t of config.downloadTokens) {
			if (typeof t !== "string") {
				throw new Error(
					`All downloadTokens must be strings in: ${configPath}`,
				);
			}
		}
	}

	const result: ProjectConfig = {
		uploadTokens: config.uploadTokens as string[],
		downloadTokens: Array.isArray(config.downloadTokens)
			? (config.downloadTokens as string[])
			: undefined,
		enableUploadForm: config.enableUploadForm !== false,
		enableDelete: config.enableDelete !== false,
		plugin: typeof config.plugin === "string" ? config.plugin : undefined,
		getAccessControl: config.getAccessControl === "token" ||
				config.getAccessControl === "jwt"
			? config.getAccessControl
			: "public",
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

	configCache.set(projectId, result);
	return result;
}

/** Clear the config cache (useful for testing). */
export function clearConfigCache(): void {
	configCache.clear();
}
