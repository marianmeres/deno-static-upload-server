/** Extract bearer token from Authorization header. Returns null if not present. */
export function extractBearerToken(req: Request): string | null {
	const header = req.headers.get("Authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Check if request has a valid bearer token from the given token list. */
export function isAuthorized(req: Request, tokens: string[]): boolean {
	if (tokens.length === 0) return true; // auth disabled
	const token = extractBearerToken(req);
	return token !== null && tokens.includes(token);
}
