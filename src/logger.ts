/**
 * Minimal structured logger interface.
 *
 * Kept deliberately tiny so consumers can plug in any logging library (pino,
 * winston, console, /dev/null, …) without adapters.
 */
export interface Logger {
	debug(event: string, data?: Record<string, unknown>): void;
	info(event: string, data?: Record<string, unknown>): void;
	warn(event: string, data?: Record<string, unknown>): void;
	error(event: string, data?: Record<string, unknown>): void;
}

/** Silent logger (no output). */
export const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/** Simple JSON-line logger writing to Deno stderr. */
export function defaultLogger(): Logger {
	function write(
		level: string,
		event: string,
		data?: Record<string, unknown>,
	) {
		const line = JSON.stringify({
			ts: new Date().toISOString(),
			level,
			event,
			...data,
		});
		console.error(line);
	}
	return {
		debug: (e, d) => write("debug", e, d),
		info: (e, d) => write("info", e, d),
		warn: (e, d) => write("warn", e, d),
		error: (e, d) => write("error", e, d),
	};
}
