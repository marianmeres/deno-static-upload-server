/**
 * CDN adapter interface and factory.
 *
 * The server code is provider-agnostic — it only interacts with the CdnAdapter
 * interface. Provider-specific details live in adapter implementations under src/cdn/.
 */

/** CDN adapter that the server calls for cache headers and purge operations. */
export interface CdnAdapter {
	/** Apply CDN-appropriate cache headers to a served file response. */
	applyCacheHeaders(res: Response): Response;
	/** Purge the given file paths from CDN cache. Must never throw. */
	purgeCache(paths: string[]): Promise<void>;
}

/** Options for configuring a CDN adapter. */
export interface CdnOptions {
	provider: string;
	purgeUrlPrefix: string;
	cacheMaxAge?: number;
	cacheSMaxAge?: number;
	/** Provider-specific options are passed through. */
	[key: string]: unknown;
}

const DEFAULT_CACHE_MAX_AGE = 3600; // 1 hour (browser)
const DEFAULT_CACHE_S_MAXAGE = 604800; // 7 days (CDN)

/** Build a standard Cache-Control header value. */
export function buildCacheControlHeader(maxAge: number, sMaxAge: number): string {
	return `public, max-age=${maxAge}, s-maxage=${sMaxAge}`;
}

/**
 * Factory: creates a CDN adapter from options, or returns undefined if CDN is
 * not configured (provider or purgeUrlPrefix missing).
 */
export async function createCdnAdapter(
	opts?: Partial<CdnOptions>,
): Promise<CdnAdapter | undefined> {
	if (!opts?.provider || !opts?.purgeUrlPrefix) {
		return undefined;
	}

	const cacheMaxAge = opts.cacheMaxAge ?? DEFAULT_CACHE_MAX_AGE;
	const cacheSMaxAge = opts.cacheSMaxAge ?? DEFAULT_CACHE_S_MAXAGE;
	const purgeUrlPrefix = opts.purgeUrlPrefix.replace(/\/+$/, ""); // strip trailing slash

	switch (opts.provider) {
		case "cloudflare": {
			const { CloudflareCdnAdapter } = await import("./cdn/cloudflare.ts");
			return new CloudflareCdnAdapter({
				zoneId: opts.zoneId as string,
				apiToken: opts.apiToken as string,
				purgeUrlPrefix,
				cacheMaxAge,
				cacheSMaxAge,
			});
		}
		default:
			throw new Error(
				`Unknown CDN provider: "${opts.provider}". Supported: cloudflare`,
			);
	}
}
