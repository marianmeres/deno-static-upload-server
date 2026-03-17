/**
 * CLI entry point for the static upload server.
 *
 * Reads configuration from environment variables and starts the server.
 * Run directly with `deno run` or as the default package export.
 *
 * @module
 */

import { createServer } from "./server.ts";

const options: Record<string, unknown> = {};

const port = Number(Deno.env.get("PORT"));
if (port) options.port = port;

const staticDir = Deno.env.get("STATIC_DIR");
if (staticDir) options.staticDir = staticDir;

const configDir = Deno.env.get("CONFIG_DIR");
if (configDir) options.configDir = configDir;

if (Deno.env.get("ENABLE_UPLOAD_FORM") === "false") {
	options.enableUploadForm = false;
}

const jwtSecret = Deno.env.get("JWT_SECRET");
if (jwtSecret) options.jwtSecret = jwtSecret;

const globalToken = Deno.env.get("GLOBAL_TOKEN");
if (globalToken) options.globalToken = globalToken;

// CDN integration (optional)
const cdnProvider = Deno.env.get("CDN_PROVIDER");
if (cdnProvider) {
	const cdn: Record<string, unknown> = { provider: cdnProvider };

	const purgeUrlPrefix = Deno.env.get("CDN_CACHE_PURGE_URL_PREFIX");
	if (purgeUrlPrefix) cdn.purgeUrlPrefix = purgeUrlPrefix;

	const cacheMaxAge = Number(Deno.env.get("CDN_CACHE_MAX_AGE"));
	if (cacheMaxAge > 0) cdn.cacheMaxAge = cacheMaxAge;

	const cacheSMaxAge = Number(Deno.env.get("CDN_CACHE_S_MAXAGE"));
	if (cacheSMaxAge > 0) cdn.cacheSMaxAge = cacheSMaxAge;

	const staleWhileRevalidate = Number(
		Deno.env.get("CDN_STALE_WHILE_REVALIDATE"),
	);
	if (staleWhileRevalidate > 0) cdn.staleWhileRevalidate = staleWhileRevalidate;

	// Provider-specific env vars
	const cfZoneId = Deno.env.get("CF_ZONE_ID");
	if (cfZoneId) cdn.zoneId = cfZoneId;

	const cfApiToken = Deno.env.get("CF_API_TOKEN");
	if (cfApiToken) cdn.apiToken = cfApiToken;

	options.cdn = cdn;
}

const server = await createServer(options);

server.start();
