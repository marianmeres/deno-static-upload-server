import type { CdnAdapter } from "../cdn.ts";
import { buildCacheControlHeader } from "../cdn.ts";

interface CloudflareAdapterOptions {
	zoneId: string;
	apiToken: string;
	purgeUrlPrefix: string;
	cacheMaxAge: number;
	cacheSMaxAge: number;
	staleWhileRevalidate: number;
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Cloudflare CDN adapter. Applies cache headers and purges via the CF API.
 */
export class CloudflareCdnAdapter implements CdnAdapter {
	#zoneId: string;
	#apiToken: string;
	#purgeUrlPrefix: string;
	#cacheControl: string;
	#immutableCacheControl: string;

	constructor(opts: CloudflareAdapterOptions) {
		if (!opts.zoneId || !opts.apiToken) {
			throw new Error(
				"Cloudflare CDN adapter requires CF_ZONE_ID and CF_API_TOKEN",
			);
		}
		this.#zoneId = opts.zoneId;
		this.#apiToken = opts.apiToken;
		this.#purgeUrlPrefix = opts.purgeUrlPrefix;
		this.#cacheControl = buildCacheControlHeader(
			opts.cacheMaxAge,
			opts.cacheSMaxAge,
			opts.staleWhileRevalidate,
		);
		this.#immutableCacheControl = "public, max-age=31536000, immutable";
	}

	applyCacheHeaders(res: Response, immutable?: boolean): Response {
		if (res.status < 200 || res.status >= 300) {
			return res;
		}
		const headers = new Headers(res.headers);
		headers.set(
			"Cache-Control",
			immutable ? this.#immutableCacheControl : this.#cacheControl,
		);
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers,
		});
	}

	async purgeCache(paths: string[]): Promise<void> {
		if (paths.length === 0) return;

		const files = paths.map((p) => this.#purgeUrlPrefix + p);

		try {
			const res = await fetch(
				`${CF_API_BASE}/zones/${this.#zoneId}/purge_cache`,
				{
					method: "POST",
					headers: {
						"Authorization": `Bearer ${this.#apiToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ files }),
				},
			);
			if (!res.ok) {
				const body = await res.text();
				console.error(
					`[cdn:cloudflare] purge failed (${res.status}): ${body}`,
				);
			}
		} catch (e) {
			console.error("[cdn:cloudflare] purge error:", e);
		}
	}
}
