import { assertEquals } from "@std/assert";
import { verifyJwt } from "../src/jwt.ts";

const SECRET = "s3cret";

function b64url(s: string): string {
	return btoa(s)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

async function sign(headerJson: string, payloadJson: string): Promise<string> {
	const enc = new TextEncoder();
	const headerB64 = b64url(headerJson);
	const payloadB64 = b64url(payloadJson);
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		enc.encode(`${headerB64}.${payloadB64}`),
	);
	const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return `${headerB64}.${payloadB64}.${sigB64}`;
}

Deno.test("jwt: typ=JWT is accepted", async () => {
	const t = await sign(
		JSON.stringify({ alg: "HS256", typ: "JWT" }),
		JSON.stringify({ sub: "x" }),
	);
	const p = await verifyJwt(t, SECRET);
	assertEquals(p?.sub, "x");
});

Deno.test("jwt: typ omitted is accepted per RFC 7519", async () => {
	const t = await sign(
		JSON.stringify({ alg: "HS256" }),
		JSON.stringify({ sub: "x" }),
	);
	const p = await verifyJwt(t, SECRET);
	assertEquals(p?.sub, "x");
});

Deno.test("jwt: typ wrong value is rejected", async () => {
	const t = await sign(
		JSON.stringify({ alg: "HS256", typ: "something-else" }),
		JSON.stringify({ sub: "x" }),
	);
	const p = await verifyJwt(t, SECRET);
	assertEquals(p, null);
});

Deno.test("jwt: alg !== HS256 is rejected", async () => {
	// sign with HS256 but claim alg=RS256 — must be rejected by alg check
	const bad = JSON.stringify({ alg: "RS256", typ: "JWT" });
	const payload = JSON.stringify({ sub: "x" });
	const enc = new TextEncoder();
	const headerB64 = b64url(bad);
	const payloadB64 = b64url(payload);
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		enc.encode(`${headerB64}.${payloadB64}`),
	);
	const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	const p = await verifyJwt(`${headerB64}.${payloadB64}.${sigB64}`, SECRET);
	assertEquals(p, null);
});

Deno.test("jwt: expired token is rejected", async () => {
	const t = await sign(
		JSON.stringify({ alg: "HS256", typ: "JWT" }),
		JSON.stringify({ sub: "x", exp: 1 }),
	);
	const p = await verifyJwt(t, SECRET);
	assertEquals(p, null);
});
