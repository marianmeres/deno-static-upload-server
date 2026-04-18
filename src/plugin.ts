import { relative, resolve, toFileUrl } from "@std/path";
import type { ProjectConfig } from "./config.ts";

/** Context passed to plugin handlers. */
export interface PluginContext {
	/** The project ID from the URL. */
	projectId: string;
	/** The loaded project configuration. */
	config: ProjectConfig;
	/** The remaining file path after projectId (empty string if none). */
	filePath: string;
	/** Absolute path to the static files directory. */
	staticDir: string;
	/** Call this to delegate to the default (built-in) handler. */
	defaultHandler: (req: Request) => Promise<Response>;
}

/**
 * A plugin handler function.
 * Return a Response to handle the request, or null to fall through to the default handler.
 */
export type PluginHandler = (
	req: Request,
	ctx: PluginContext,
) => Promise<Response | null>;

const pluginCache = new Map<string, PluginHandler>();

/**
 * Load a plugin module from the given path (relative to configDir).
 *
 * The module must default-export a PluginHandler function.
 * Plugins are cached after first load (keyed by absolute path).
 *
 * For safety, pluginPath must resolve to a location inside configDir.
 */
export async function loadPlugin(
	configDir: string,
	pluginPath: string,
): Promise<PluginHandler> {
	const absConfigDir = resolve(configDir);
	const absPath = resolve(absConfigDir, pluginPath);

	// Sandbox: plugin must resolve inside configDir.
	const rel = relative(absConfigDir, absPath);
	if (rel.startsWith("..") || rel === "" || rel.startsWith("/")) {
		throw new Error(
			`Plugin path must resolve inside configDir: ${pluginPath}`,
		);
	}

	const cached = pluginCache.get(absPath);
	if (cached) return cached;

	// Convert to file:// URL so dynamic import works cross-platform.
	const mod = await import(toFileUrl(absPath).href);

	if (typeof mod.default !== "function") {
		throw new Error(
			`Plugin must default-export a handler function: ${pluginPath}`,
		);
	}

	const handler = mod.default as PluginHandler;
	pluginCache.set(absPath, handler);
	return handler;
}

/** Clear the plugin cache (useful for testing). */
export function clearPluginCache(): void {
	pluginCache.clear();
}
