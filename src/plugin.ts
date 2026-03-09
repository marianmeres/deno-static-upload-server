import { resolve } from "@std/path";
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
 * The module must default-export a PluginHandler function.
 * Plugins are cached after first load.
 */
export async function loadPlugin(
	configDir: string,
	pluginPath: string,
): Promise<PluginHandler> {
	const absPath = resolve(configDir, pluginPath);

	const cached = pluginCache.get(absPath);
	if (cached) return cached;

	const mod = await import(absPath);

	if (typeof mod.default !== "function") {
		throw new Error(
			`Plugin must default-export a handler function: ${absPath}`,
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
