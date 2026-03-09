/** Minimal HS256 JWT verification using Web Crypto API. Zero external deps. */

export interface JwtPayload {
	[key: string]: unknown;
	/** Expiration time (seconds since epoch). */
	exp?: number;
	/** Issued at (seconds since epoch). */
	iat?: number;
	/** Subject. */
	sub?: string;
}

function base64UrlDecode(s: string): Uint8Array {
	// Convert base64url to base64
	const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
	const pad = base64.length % 4;
	const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Verify and decode an HS256 JWT token.
 * Returns the payload if valid and not expired, null otherwise.
 */
export async function verifyJwt(
	token: string,
	secret: string,
): Promise<JwtPayload | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [headerB64, payloadB64, signatureB64] = parts;

	// Verify header is HS256
	try {
		const header = JSON.parse(
			new TextDecoder().decode(base64UrlDecode(headerB64)),
		);
		if (header.alg !== "HS256" || header.typ !== "JWT") {
			return null;
		}
	} catch {
		return null;
	}

	// Import the secret key
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);

	// Verify signature
	const data = encoder.encode(`${headerB64}.${payloadB64}`);
	const signature = base64UrlDecode(signatureB64);
	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signature.buffer as ArrayBuffer,
		data.buffer as ArrayBuffer,
	);
	if (!valid) return null;

	// Decode payload
	let payload: JwtPayload;
	try {
		payload = JSON.parse(
			new TextDecoder().decode(base64UrlDecode(payloadB64)),
		);
	} catch {
		return null;
	}

	// Check expiration
	if (
		typeof payload.exp === "number" &&
		payload.exp < Math.floor(Date.now() / 1000)
	) {
		return null;
	}

	return payload;
}

/** Check if a token string looks like a JWT (has 3 dot-separated parts). */
export function looksLikeJwt(token: string): boolean {
	return token.split(".").length === 3;
}
