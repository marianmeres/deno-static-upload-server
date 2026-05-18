import { assertEquals } from "@std/assert";
import { resolveCacheStrategy } from "../src/cache-strategy.ts";

Deno.test("resolveCacheStrategy: undefined → mutable", () => {
	assertEquals(resolveCacheStrategy(undefined, "/anything"), "mutable");
});

Deno.test("resolveCacheStrategy: scalar form passes through", () => {
	assertEquals(resolveCacheStrategy("immutable", "/x.jpg"), "immutable");
	assertEquals(resolveCacheStrategy("mutable", "/x.jpg"), "mutable");
});

Deno.test("resolveCacheStrategy: map form, longest matching prefix wins", () => {
	const cfg = {
		"/img/": "mutable" as const,
		"/img/hashed/": "immutable" as const,
	};
	assertEquals(resolveCacheStrategy(cfg, "/img/foo.jpg"), "mutable");
	assertEquals(
		resolveCacheStrategy(cfg, "/img/hashed/abc-DJ21.jpg"),
		"immutable",
	);
});

Deno.test("resolveCacheStrategy: map with fallback ('' key) when no prefix matches", () => {
	const cfg = { "/img/": "immutable" as const, "": "mutable" as const };
	assertEquals(resolveCacheStrategy(cfg, "/img/foo.jpg"), "immutable");
	assertEquals(resolveCacheStrategy(cfg, "/avatars/u.png"), "mutable");
});

Deno.test("resolveCacheStrategy: map without fallback, no match → mutable", () => {
	const cfg = { "/img/": "immutable" as const };
	assertEquals(resolveCacheStrategy(cfg, "/avatars/u.png"), "mutable");
});

Deno.test("resolveCacheStrategy: empty map → mutable", () => {
	assertEquals(resolveCacheStrategy({}, "/x"), "mutable");
});
