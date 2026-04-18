import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { clearConfigCache, loadProjectConfig } from "../src/config.ts";

Deno.test("cache: same projectId in different configDirs isolates", async () => {
	const a = await Deno.makeTempDir();
	const b = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(
			join(a, "shared.json"),
			JSON.stringify({ uploadTokens: ["from-a"] }),
		);
		await Deno.writeTextFile(
			join(b, "shared.json"),
			JSON.stringify({ uploadTokens: ["from-b"] }),
		);
		clearConfigCache();

		const fromA = await loadProjectConfig(a, "shared");
		const fromB = await loadProjectConfig(b, "shared");

		assertEquals(fromA?.uploadTokens, ["from-a"]);
		assertEquals(fromB?.uploadTokens, ["from-b"]);
	} finally {
		await Deno.remove(a, { recursive: true });
		await Deno.remove(b, { recursive: true });
	}
});

Deno.test("cache: clearConfigCache(configDir) only clears that dir", async () => {
	const a = await Deno.makeTempDir();
	const b = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(
			join(a, "shared.json"),
			JSON.stringify({ uploadTokens: ["from-a"] }),
		);
		await Deno.writeTextFile(
			join(b, "shared.json"),
			JSON.stringify({ uploadTokens: ["from-b"] }),
		);
		clearConfigCache();

		await loadProjectConfig(a, "shared");
		await loadProjectConfig(b, "shared");

		// Update A only, clear A only
		await Deno.writeTextFile(
			join(a, "shared.json"),
			JSON.stringify({ uploadTokens: ["from-a-2"] }),
		);
		clearConfigCache(a);

		const fromA = await loadProjectConfig(a, "shared");
		const fromB = await loadProjectConfig(b, "shared");

		assertEquals(fromA?.uploadTokens, ["from-a-2"]);
		assertEquals(fromB?.uploadTokens, ["from-b"]); // still cached
	} finally {
		await Deno.remove(a, { recursive: true });
		await Deno.remove(b, { recursive: true });
	}
});
