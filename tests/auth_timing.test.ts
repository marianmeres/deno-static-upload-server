import { assertEquals } from "@std/assert";
import { timingSafeEqualStr } from "../src/auth.ts";

Deno.test("timingSafeEqualStr: equal strings match", () => {
	assertEquals(timingSafeEqualStr("hello", "hello"), true);
});

Deno.test("timingSafeEqualStr: different strings do not match", () => {
	assertEquals(timingSafeEqualStr("hello", "world"), false);
});

Deno.test("timingSafeEqualStr: different lengths do not match", () => {
	assertEquals(timingSafeEqualStr("hello", "hello!"), false);
	assertEquals(timingSafeEqualStr("hello!", "hello"), false);
});

Deno.test("timingSafeEqualStr: empty strings match", () => {
	assertEquals(timingSafeEqualStr("", ""), true);
});

Deno.test("timingSafeEqualStr: one-char diff at start or end", () => {
	assertEquals(timingSafeEqualStr("Xbcdef", "abcdef"), false);
	assertEquals(timingSafeEqualStr("abcdeX", "abcdef"), false);
});
