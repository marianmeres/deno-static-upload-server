import type { CacheStrategy, CacheStrategyConfig } from "./config.ts";

/**
 * Resolve the cache strategy for a given path inside the project static dir.
 *
 * - If `cfg` is undefined → `"mutable"` (the package-wide default).
 * - If `cfg` is a string (`"mutable"` | `"immutable"`) → that value, always.
 * - If `cfg` is a map → longest matching path prefix wins; the empty-string
 *   key (created during config normalization from `*` / `/` / `/*`) is the
 *   fallback used when no specific prefix matches.
 *
 * `filePath` is the request path inside the project's static dir, starting
 * with `/` (e.g. `/img/abc.jpg`).
 */
export function resolveCacheStrategy(
	cfg: CacheStrategyConfig | undefined,
	filePath: string,
): CacheStrategy {
	if (cfg === undefined) return "mutable";
	if (typeof cfg === "string") return cfg;

	let best: { len: number; strategy: CacheStrategy } | undefined;
	let fallback: CacheStrategy | undefined;

	for (const [prefix, strategy] of Object.entries(cfg)) {
		if (prefix === "") {
			fallback = strategy;
			continue;
		}
		if (
			filePath.startsWith(prefix) &&
			prefix.length > (best?.len ?? -1)
		) {
			best = { len: prefix.length, strategy };
		}
	}

	return best?.strategy ?? fallback ?? "mutable";
}
