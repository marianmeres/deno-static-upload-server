/** Extract bearer token from Authorization header. Returns null if not present. */
export function extractBearerToken(req: Request): string | null {
	const header = req.headers.get("Authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Constant-time string equality. Always compares against the full length of
 * `expected` so early-exit timing does not leak how many leading bytes matched.
 * Length is not hidden (differs between the lengths themselves), but content is.
 */
export function timingSafeEqualStr(a: string, expected: string): boolean {
	const ae = new TextEncoder().encode(a);
	const be = new TextEncoder().encode(expected);
	const len = be.length;
	let diff = ae.length ^ be.length;
	for (let i = 0; i < len; i++) {
		// If `a` is shorter, index past-end reads 0; the length XOR above already
		// marked them different, so `diff` will stay non-zero.
		diff |= (ae[i] ?? 0) ^ be[i];
	}
	return diff === 0;
}

/** Check if a candidate token matches any token in the list (constant time per entry). */
function matchesAny(token: string, tokens: string[]): boolean {
	let matched = false;
	for (const t of tokens) {
		if (timingSafeEqualStr(token, t)) matched = true;
	}
	return matched;
}

/** Check if request has a valid bearer token from the given list OR matches the global token. */
export function isAuthorized(
	req: Request,
	tokens: string[],
	globalToken?: string,
): boolean {
	if (tokens.length === 0) return true; // no auth configured for this project
	const token = extractBearerToken(req);
	if (!token) return false;
	if (globalToken && timingSafeEqualStr(token, globalToken)) return true;
	return matchesAny(token, tokens);
}
