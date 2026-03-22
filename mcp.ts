import { z } from "npm:zod";
import type { McpToolDefinition } from "jsr:@marianmeres/mcp-server/types";

export const tools: McpToolDefinition[] = [
	{
		name: "validate-project-config",
		description:
			"Validate a deno-static-upload-server project config JSON and return diagnostics",
		params: {
			config: z
				.string()
				.describe(
					"JSON string of the project config to validate",
				),
		},
		handler: async ({ config }) => {
			const errors: string[] = [];

			let parsed: unknown;
			try {
				parsed = JSON.parse(config as string);
			} catch {
				return JSON.stringify({
					valid: false,
					errors: ["Invalid JSON"],
				});
			}

			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				return JSON.stringify({
					valid: false,
					errors: ["Config must be a JSON object"],
				});
			}

			const c = parsed as Record<string, unknown>;

			// uploadTokens is required
			if (!Array.isArray(c.uploadTokens)) {
				errors.push(
					'Missing or invalid "uploadTokens" (must be an array)',
				);
			} else {
				for (const t of c.uploadTokens) {
					if (typeof t !== "string") {
						errors.push(
							"All uploadTokens must be strings",
						);
						break;
					}
				}
			}

			// downloadTokens if present
			if (c.downloadTokens !== undefined) {
				if (!Array.isArray(c.downloadTokens)) {
					errors.push(
						'"downloadTokens" must be an array',
					);
				} else {
					for (const t of c.downloadTokens) {
						if (typeof t !== "string") {
							errors.push(
								"All downloadTokens must be strings",
							);
							break;
						}
					}
				}
			}

			// getAccessControl
			if (
				c.getAccessControl !== undefined &&
				!["public", "token", "jwt"].includes(
					c.getAccessControl as string,
				)
			) {
				errors.push(
					'"getAccessControl" must be "public", "token", or "jwt"',
				);
			}

			// cacheStrategy
			if (
				c.cacheStrategy !== undefined &&
				!["mutable", "immutable"].includes(
					c.cacheStrategy as string,
				)
			) {
				errors.push(
					'"cacheStrategy" must be "mutable" or "immutable"',
				);
			}

			// booleans
			for (const key of ["enableUploadForm", "enableDelete"]) {
				if (
					c[key] !== undefined &&
					typeof c[key] !== "boolean"
				) {
					errors.push(`"${key}" must be a boolean`);
				}
			}

			// plugin
			if (
				c.plugin !== undefined &&
				typeof c.plugin !== "string"
			) {
				errors.push('"plugin" must be a string');
			}

			// jwt
			if (c.jwt !== undefined) {
				if (
					typeof c.jwt !== "object" ||
					c.jwt === null ||
					Array.isArray(c.jwt)
				) {
					errors.push('"jwt" must be an object');
				} else {
					const jwt = c.jwt as Record<string, unknown>;
					if (
						jwt.secret !== undefined &&
						typeof jwt.secret !== "string"
					) {
						errors.push('"jwt.secret" must be a string');
					}
				}
			}

			return JSON.stringify({
				valid: errors.length === 0,
				errors,
			});
		},
	},
	{
		name: "generate-project-config",
		description:
			"Generate a deno-static-upload-server project config JSON from parameters",
		params: {
			uploadTokens: z
				.array(z.string())
				.describe(
					"Bearer tokens for upload/delete auth. Empty array disables auth.",
				),
			downloadTokens: z
				.array(z.string())
				.optional()
				.describe("Bearer tokens for download auth"),
			getAccessControl: z
				.enum(["public", "token", "jwt"])
				.optional()
				.describe(
					'Access control for GET requests. Default: "public"',
				),
			enableUploadForm: z
				.boolean()
				.optional()
				.describe(
					"Whether to serve the HTML upload form. Default: true",
				),
			enableDelete: z
				.boolean()
				.optional()
				.describe(
					"Whether DELETE is enabled. Default: true",
				),
			cacheStrategy: z
				.enum(["mutable", "immutable"])
				.optional()
				.describe(
					'CDN cache strategy. "immutable" for content-hashed filenames. Default: "mutable"',
				),
			jwtSecret: z
				.string()
				.optional()
				.describe("Per-project JWT secret"),
			plugin: z
				.string()
				.optional()
				.describe(
					"Path to a custom plugin module, relative to configDir",
				),
		},
		handler: async ({
			uploadTokens,
			downloadTokens,
			getAccessControl,
			enableUploadForm,
			enableDelete,
			cacheStrategy,
			jwtSecret,
			plugin,
		}) => {
			const config: Record<string, unknown> = { uploadTokens };

			if ((downloadTokens as string[] | undefined)?.length) {
				config.downloadTokens = downloadTokens;
			}
			if (getAccessControl && getAccessControl !== "public") {
				config.getAccessControl = getAccessControl;
			}
			if (enableUploadForm === false) {
				config.enableUploadForm = false;
			}
			if (enableDelete === false) config.enableDelete = false;
			if (cacheStrategy === "immutable") {
				config.cacheStrategy = "immutable";
			}
			if (jwtSecret) config.jwt = { secret: jwtSecret };
			if (plugin) config.plugin = plugin;

			return JSON.stringify(config, null, "\t");
		},
	},
];
