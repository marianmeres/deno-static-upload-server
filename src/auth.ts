/** Extract bearer token from Authorization header. Returns null if not present. */
export function extractBearerToken(req: Request): string | null {
	const header = req.headers.get("Authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7) : null;
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
	if (globalToken && token === globalToken) return true;
	return tokens.includes(token);
}
