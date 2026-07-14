/**
 * Programmatic API for the static upload server.
 *
 * Provides {@linkcode createServer} to create and start a configured
 * static file server with per-project configuration, JWT auth, plugin
 * support, and optional CDN integration.
 *
 * @module
 */

import { resolve } from "@std/path";
import { clearConfigCache, isValidProjectId, loadProjectConfig } from "./config.ts";
import type { ProjectConfig } from "./config.ts";
import { handleForm } from "./handlers/form.ts";
import { handleUpload } from "./handlers/upload.ts";
import { handlePut } from "./handlers/put.ts";
import { handleServe } from "./handlers/serve.ts";
import { handleDelete } from "./handlers/delete.ts";
import { loadPlugin } from "./plugin.ts";
import type { PluginContext } from "./plugin.ts";
import { createCdnAdapter, noStoreHeaders } from "./cdn.ts";
import type { CdnAdapter, CdnOptions } from "./cdn.ts";
import { defaultLogger, silentLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";

let versionPromise: Promise<string> | null = null;

/** Read package version lazily so importing the module has no side effects. */
function getVersion(): Promise<string> {
	if (!versionPromise) {
		versionPromise = fetch(new URL("../deno.json", import.meta.url))
			.then((r) => r.json())
			.then((j) => j.version as string)
			.catch(() => "unknown");
	}
	return versionPromise;
}

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
	/**
	 * Root-level files to serve directly from `staticDir` (bypassing project config).
	 * Typical values: `["favicon.ico", "robots.txt"]`. Exact filenames, no globs.
	 * @default []
	 */
	rootFiles?: string[];
	/**
	 * Logger. Pass `true` for default JSON-line logging, `false`/omit for silent,
	 * or a custom {@linkcode Logger} implementation.
	 * @default false
	 */
	logger?: boolean | Logger;
	/**
	 * Sweep stale `.tmp_*` files in staticDir on startup. Files older than
	 * this many milliseconds are removed. Set `0` to disable. @default 3_600_000 (1h)
	 */
	tmpSweepMaxAgeMs?: number;
	/**
	 * Server-level fallback for the per-file upload byte cap, applied when a
	 * project config sets no `maxFileSize`. Guards against a single streaming
	 * upload filling the disk. Set `0` for unlimited. @default 2_147_483_648 (2 GiB)
	 */
	maxUploadSize?: number;
	/**
	 * Abort an upload when no body chunk arrives for this many milliseconds
	 * (guards slow-drip connections pinning fds and tmp files). Set `0` to
	 * disable. @default 60_000
	 */
	uploadIdleTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<
	Pick<
		StaticServerOptions,
		| "port"
		| "staticDir"
		| "configDir"
		| "enableUploadForm"
		| "rootFiles"
		| "tmpSweepMaxAgeMs"
		| "maxUploadSize"
		| "uploadIdleTimeoutMs"
	>
> = {
	port: 8000,
	staticDir: "./static",
	configDir: "./config",
	enableUploadForm: true,
	rootFiles: [],
	tmpSweepMaxAgeMs: 60 * 60 * 1000,
	maxUploadSize: 2 * 1024 * 1024 * 1024,
	uploadIdleTimeoutMs: 60_000,
};

/** Static server instance returned by {@linkcode createServer}. */
export interface StaticServer {
	/** Request handler suitable for use with `Deno.serve` or as middleware. */
	handler: (req: Request) => Promise<Response>;
	/** Start listening on the configured port. */
	start: () => ReturnType<typeof Deno.serve>;
	/** Resolved package version. */
	version: string;
}

// Re-export for convenience
export type { CdnAdapter, CdnOptions, Logger, PluginContext, ProjectConfig };
export { clearConfigCache };

function resolveLogger(opt: StaticServerOptions["logger"]): Logger {
	if (opt === true) return defaultLogger();
	if (opt && typeof opt === "object") return opt;
	return silentLogger;
}

/** Sweep orphaned `.tmp_*` files older than maxAgeMs. Never throws. */
async function sweepTmpFiles(
	rootDir: string,
	maxAgeMs: number,
	logger: Logger,
): Promise<void> {
	if (maxAgeMs <= 0) return;
	const cutoff = Date.now() - maxAgeMs;
	async function walk(dir: string) {
		try {
			for await (const entry of Deno.readDir(dir)) {
				const full = `${dir}/${entry.name}`;
				if (entry.isDirectory) {
					await walk(full);
				} else if (
					entry.isFile &&
					// Exact crypto.randomUUID() shape — a looser pattern would
					// also match stored user files like "backup.tmp_2026-07-14".
					/\.tmp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
						.test(entry.name)
				) {
					try {
						const stat = await Deno.stat(full);
						if (stat.mtime && stat.mtime.getTime() < cutoff) {
							await Deno.remove(full);
							logger.info("tmp.swept", { path: full });
						}
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// dir missing / unreadable — ignore
		}
	}
	await walk(rootDir);
}

/**
 * Creates a static file server with per-project configuration and plugin support.
 *
 * @param opts Server configuration options.
 * @returns A server object with a `handler` function, `start` method, and resolved version.
 */
export async function createServer(
	opts: StaticServerOptions = {},
): Promise<StaticServer> {
	const options = { ...DEFAULT_OPTIONS, ...opts };
	const logger = resolveLogger(opts.logger);
	const cdnAdapter = await createCdnAdapter(options.cdn);
	const VERSION = await getVersion();
	const absStaticDir = resolve(options.staticDir);
	// `0` (and negatives) mean "disabled" — normalize to undefined once here.
	const maxUploadSize = options.maxUploadSize > 0 ? options.maxUploadSize : undefined;
	const uploadIdleTimeoutMs = options.uploadIdleTimeoutMs > 0
		? options.uploadIdleTimeoutMs
		: undefined;

	// Startup tmp sweep (non-blocking for request handling).
	queueMicrotask(() => {
		sweepTmpFiles(absStaticDir, options.tmpSweepMaxAgeMs, logger);
	});

	const rootFileSet = new Set(options.rootFiles);

	async function handleRequest(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const pathname = url.pathname;

		// GET|HEAD / — version signature only
		if (
			pathname === "/" &&
			(req.method === "GET" || req.method === "HEAD")
		) {
			let res = Response.json({ version: VERSION });
			if (cdnAdapter) res = noStoreHeaders(res);
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
			// Whitelisted root-level files (favicon.ico, robots.txt, etc.)
			if (
				(req.method === "GET" || req.method === "HEAD") &&
				segments.length === 1 &&
				rootFileSet.has(projectId)
			) {
				return handleServe(
					req,
					projectId, // filePath = the requested filename
					{ uploadTokens: [] },
					options.staticDir,
					{ cdn: cdnAdapter, logger },
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
			logger.error("config.load_failed", {
				projectId,
				error: e instanceof Error ? e.message : String(e),
			});
			return new Response("Server configuration error", { status: 500 });
		}

		// Default handler for this request
		const defaultHandler = (r: Request) =>
			routeToHandler(
				r,
				projectId,
				filePath,
				config,
				options.staticDir,
				options.jwtSecret,
				options.globalToken,
				cdnAdapter,
				options.enableUploadForm,
				VERSION,
				logger,
				maxUploadSize,
				uploadIdleTimeoutMs,
			);

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
				logger.error("plugin.error", {
					projectId,
					error: e instanceof Error ? e.message : String(e),
				});
				return new Response("Plugin error", { status: 500 });
			}
		}

		return defaultHandler(req);
	}

	// Last-resort guard: an uncaught throw anywhere above must never become an
	// opaque, unlogged 500 (or crash an embedder that mounts `handler` without
	// its own error handling). The body is byte-identical to Deno.serve's
	// default so nothing downstream changes.
	async function handler(req: Request): Promise<Response> {
		try {
			return await handleRequest(req);
		} catch (err) {
			logger.error("request.unhandled", {
				method: req.method,
				path: new URL(req.url).pathname,
				error: err instanceof Error ? err.message : String(err),
				name: err instanceof Error ? err.name : undefined,
				stack: err instanceof Error ? err.stack : undefined,
			});
			return new Response("Internal Server Error", { status: 500 });
		}
	}

	return {
		handler,
		version: VERSION,
		start() {
			console.log(`Listening on :${options.port}`);
			console.log(`  Config : ${options.configDir}`);
			console.log(`  Static : ${options.staticDir}`);
			if (cdnAdapter) {
				console.log(`  CDN    : ${options.cdn?.provider}`);
			}
			if (rootFileSet.size > 0) {
				console.log(`  Root files: ${[...rootFileSet].join(", ")}`);
			}
			console.log(`  Routes :`);
			console.log(`    GET    /            version`);
			console.log(`    GET    /:projectId   upload form`);
			console.log(`    POST   /:projectId   upload files`);
			console.log(`    GET    /:projectId/* serve files`);
			console.log(`    HEAD   /:projectId/* file info`);
			console.log(`    PUT    /:projectId/* upload file (raw body)`);
			console.log(`    DELETE /:projectId/* delete file`);
			return Deno.serve({
				port: options.port,
				// Belt-and-braces: `handler` catches its own errors; this
				// catches anything outside it (e.g. response-stream failures)
				// that Deno would otherwise swallow into an unlogged 500.
				onError: (err) => {
					logger.error("request.unhandled", {
						error: err instanceof Error ? err.message : String(err),
						name: err instanceof Error ? err.name : undefined,
						stack: err instanceof Error ? err.stack : undefined,
					});
					return new Response("Internal Server Error", { status: 500 });
				},
			}, handler);
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
	jwtSecret: string | undefined,
	globalToken: string | undefined,
	cdn: CdnAdapter | undefined,
	defaultEnableForm: boolean,
	version: string,
	logger: Logger,
	maxUploadSize: number | undefined,
	uploadIdleTimeoutMs: number | undefined,
): Promise<Response> {
	const method = req.method;

	// No file path — project-level routes
	if (!filePath) {
		if (method === "GET" || method === "HEAD") {
			let res = await handleForm(
				req,
				projectId,
				config,
				version,
				defaultEnableForm,
			);
			if (res) {
				if (cdn) res = noStoreHeaders(res);
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
			return handleUpload(req, projectId, config, staticDir, {
				globalToken,
				cdn,
				logger,
				maxUploadSize,
				uploadIdleTimeoutMs,
			});
		}
		return new Response("Not found", { status: 404 });
	}

	// File path present — file-level routes
	if (method === "GET" || method === "HEAD") {
		return await handleServe(req, filePath, config, staticDir, {
			jwtSecret,
			globalToken,
			cdn,
			logger,
		});
	}
	if (method === "PUT") {
		return handlePut(req, projectId, filePath, config, staticDir, {
			globalToken,
			cdn,
			logger,
			maxUploadSize,
			uploadIdleTimeoutMs,
		});
	}
	if (method === "DELETE") {
		return handleDelete(req, projectId, filePath, config, staticDir, {
			globalToken,
			cdn,
			logger,
		});
	}

	return new Response("Not found", { status: 404 });
}
