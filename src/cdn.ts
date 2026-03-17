/**
 * CDN adapter interface and factory.
 *
 * The server code is provider-agnostic — it only interacts with the CdnAdapter
 * interface. Provider-specific details live in adapter implementations under src/cdn/.
 */

/** CDN adapter that the server calls for cache headers and purge operations. */
export interface CdnAdapter {
	/**
	 * Apply CDN-appropriate cache headers to a served file response.
	 * When `immutable` is true, uses long-lived cache headers suitable for
	 * content-hashed filenames that never change at the same URL.
	 */
	applyCacheHeaders(res: Response, immutable?: boolean): Response;
	/** Purge the given file paths from CDN cache. Must never throw. */
	purgeCache(paths: string[]): Promise<void>;
}

/** Options for configuring a CDN adapter. */
export interface CdnOptions {
	provider: string;
	purgeUrlPrefix: string;
	cacheMaxAge?: number;
	cacheSMaxAge?: number;
	staleWhileRevalidate?: number;
	/** Provider-specific options are passed through. */
	[key: string]: unknown;
}

const DEFAULT_CACHE_MAX_AGE = 60; // 1 minute (browser — keep short, can't purge browsers)
const DEFAULT_CACHE_S_MAXAGE = 604800; // 7 days (CDN — purged on upload/delete)
const DEFAULT_STALE_WHILE_REVALIDATE = 86400; // 1 day

/** Build a standard Cache-Control header value. */
export function buildCacheControlHeader(
	maxAge: number,
	sMaxAge: number,
	staleWhileRevalidate: number,
): string {
	return `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

/** Set Cache-Control: no-store on a response to prevent CDN caching. */
export function noStoreHeaders(res: Response): Response {
	const headers = new Headers(res.headers);
	headers.set("Cache-Control", "no-store");
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
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
	const staleWhileRevalidate = opts.staleWhileRevalidate ??
		DEFAULT_STALE_WHILE_REVALIDATE;
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
				staleWhileRevalidate,
			});
		}
		default:
			throw new Error(
				`Unknown CDN provider: "${opts.provider}". Supported: cloudflare`,
			);
	}
}
