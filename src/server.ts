import { clearConfigCache, isValidProjectId, loadProjectConfig } from "./config.ts";
import type { ProjectConfig } from "./config.ts";
import { handleForm } from "./handlers/form.ts";
import { handleUpload } from "./handlers/upload.ts";
import { handleServe } from "./handlers/serve.ts";
import { handleDelete } from "./handlers/delete.ts";
import { loadPlugin } from "./plugin.ts";
import type { PluginContext } from "./plugin.ts";
import { createCdnAdapter } from "./cdn.ts";
import type { CdnAdapter, CdnOptions } from "./cdn.ts";

const { version: VERSION } = await fetch(
	new URL("../deno.json", import.meta.url),
).then((r) => r.json());

/** Configuration options for the static upload server. */
export interface StaticServerOptions {
	/** Port to listen on. @default 8000 */
	port?: number;
	/** Directory to store and serve static files from. @default "./static" */
	staticDir?: string;
	/** Directory containing per-project JSON config files. @default "./config" */
	configDir?: string;
	/** Global default for whether to serve the HTML upload form. @default true */
	enableUploadForm?: boolean;
	/** Shared JWT secret (per-project secrets override this). */
	jwtSecret?: string;
	/** Global token that grants upload, delete, and download access across all projects. */
	globalToken?: string;
	/** CDN adapter options. Omit to disable CDN integration. */
	cdn?: Partial<CdnOptions>;
}

const DEFAULT_OPTIONS:
	& Required<
		Omit<StaticServerOptions, "jwtSecret" | "globalToken" | "cdn">
	>
	& {
		jwtSecret?: string;
		globalToken?: string;
	} = {
		port: 8000,
		staticDir: "./static",
		configDir: "./config",
		enableUploadForm: true,
		jwtSecret: undefined,
		globalToken: undefined,
	};

/** Static server instance returned by {@linkcode createServer}. */
export interface StaticServer {
	/** Request handler suitable for use with `Deno.serve` or as middleware. */
	handler: (req: Request) => Promise<Response>;
	/** Start listening on the configured port. */
	start: () => ReturnType<typeof Deno.serve>;
}

// Re-export for convenience
export type { CdnAdapter, CdnOptions, PluginContext, ProjectConfig };
export { clearConfigCache };

/**
 * Creates a static file server with per-project configuration and plugin support.
 *
 * @param opts Server configuration options.
 * @returns A server object with a `handler` function and a `start` method.
 */
export async function createServer(
	opts: StaticServerOptions = {},
): Promise<StaticServer> {
	const options = { ...DEFAULT_OPTIONS, ...opts };
	const cdnAdapter = await createCdnAdapter(options.cdn);

	async function handler(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const pathname = url.pathname;

		// GET|HEAD / — version signature only
		if (
			pathname === "/" &&
			(req.method === "GET" || req.method === "HEAD")
		) {
			const res = Response.json({ version: VERSION });
			if (req.method === "HEAD") {
				res.body?.cancel();
				return new Response(null, {
					status: res.status,
					headers: res.headers,
				});
			}
			return res;
		}

		// Parse /:projectId[/path/to/file]
		const segments = pathname.slice(1).split("/");
		const projectId = segments[0];
		const filePath = segments.slice(1).join("/");

		if (!projectId || !isValidProjectId(projectId)) {
			// Root-level files (favicon.ico, robots.txt, etc.)
			if (
				(req.method === "GET" || req.method === "HEAD") &&
				segments.length === 1 &&
				projectId.includes(".")
			) {
				return handleServe(
					req,
					"",
					{ uploadTokens: [] },
					options.staticDir,
					undefined,
					undefined,
					cdnAdapter,
				);
			}
			return new Response("Not found", { status: 404 });
		}

		// Load project config (404 if not found, 500 if invalid)
		let config: ProjectConfig;
		try {
			const loaded = await loadProjectConfig(
				options.configDir,
				projectId,
			);
			if (!loaded) {
				return new Response("Not found", { status: 404 });
			}
			config = loaded;
		} catch (e) {
			console.error(e);
			return new Response("Server configuration error", { status: 500 });
		}

		// Apply global enableUploadForm default
		if (
			config.enableUploadForm === undefined &&
			!options.enableUploadForm
		) {
			config = { ...config, enableUploadForm: false };
		}

		// Default handler for this request
		async function defaultHandler(r: Request): Promise<Response> {
			return await routeToHandler(
				r,
				projectId,
				filePath,
				config,
				options.staticDir,
				options.jwtSecret,
				options.globalToken,
				cdnAdapter,
			);
		}

		// Plugin support: if configured, let plugin handle first
		if (config.plugin) {
			try {
				const pluginHandler = await loadPlugin(
					options.configDir,
					config.plugin,
				);
				const ctx: PluginContext = {
					projectId,
					config,
					filePath,
					staticDir: options.staticDir,
					defaultHandler,
				};
				const pluginResponse = await pluginHandler(req, ctx);
				if (pluginResponse) return pluginResponse;
			} catch (e) {
				console.error(`Plugin error for project "${projectId}":`, e);
				return new Response("Plugin error", { status: 500 });
			}
		}

		return defaultHandler(req);
	}

	return {
		handler,
		start() {
			console.log(`Listening on :${options.port}`);
			console.log(`  Config : ${options.configDir}`);
			console.log(`  Static : ${options.staticDir}`);
			if (cdnAdapter) {
				console.log(`  CDN    : ${options.cdn?.provider}`);
			}
			console.log(`  Routes :`);
			console.log(`    GET    /            version`);
			console.log(`    GET    /:projectId   upload form`);
			console.log(`    POST   /:projectId   upload files`);
			console.log(`    GET    /:projectId/* serve files`);
			console.log(`    HEAD   /:projectId/* file info`);
			console.log(`    DELETE /:projectId/* delete file`);
			return Deno.serve({ port: options.port }, handler);
		},
	};
}

/** Route a request to the appropriate default handler based on method and path. */
async function routeToHandler(
	req: Request,
	projectId: string,
	filePath: string,
	config: ProjectConfig,
	staticDir: string,
	jwtSecret?: string,
	globalToken?: string,
	cdn?: CdnAdapter,
): Promise<Response> {
	const method = req.method;

	// No file path — project-level routes
	if (!filePath) {
		if (method === "GET" || method === "HEAD") {
			const res = handleForm(req, projectId, config, VERSION);
			if (res) {
				if (method === "HEAD") {
					res.body?.cancel();
					return new Response(null, {
						status: res.status,
						headers: res.headers,
					});
				}
				return res;
			}
			return new Response("Not found", { status: 404 });
		}
		if (method === "POST") {
			return handleUpload(req, projectId, config, staticDir, globalToken, cdn);
		}
		return new Response("Not found", { status: 404 });
	}

	// File path present — file-level routes
	if (method === "GET" || method === "HEAD") {
		return await handleServe(
			req,
			projectId,
			config,
			staticDir,
			jwtSecret,
			globalToken,
			cdn,
		);
	}
	if (method === "DELETE") {
		return handleDelete(
			req,
			projectId,
			filePath,
			config,
			staticDir,
			globalToken,
			cdn,
		);
	}

	return new Response("Not found", { status: 404 });
}
