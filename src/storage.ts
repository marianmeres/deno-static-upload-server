/**
 * Atomic streaming writes shared by the upload handlers (POST multipart, PUT raw body).
 *
 * The core contract: bytes stream from the source to a `.tmp_<uuid>` sibling of
 * the destination (never buffered in memory), the byte cap is enforced
 * mid-stream, and the tmp file is renamed over the destination only on full
 * success. Any failure removes the tmp file and rethrows a typed error.
 *
 * @module
 */

import { dirname } from "@std/path";

/** Thrown when the source stream exceeds the configured byte cap. */
export class SizeLimitError extends Error {
	constructor(maxBytes: number) {
		super(`size limit exceeded (${maxBytes} bytes)`);
		this.name = "SizeLimitError";
	}
}

/**
 * Thrown when the stream ends cleanly but delivered a different number of
 * bytes than the request declared (`Content-Length`) — e.g. a connection that
 * dropped at a chunk boundary. Prevents publishing a truncated file as success.
 */
export class IncompleteBodyError extends Error {
	constructor(received: number, expected: number) {
		super(`incomplete body (received ${received} of ${expected} bytes)`);
		this.name = "IncompleteBodyError";
	}
}

/**
 * Thrown when no chunk arrives within the configured idle window. Guards
 * against slow-drip connections pinning file descriptors and tmp files
 * indefinitely (streaming uploads no longer have RAM cost as a natural limit).
 */
export class IdleTimeoutError extends Error {
	constructor(idleTimeoutMs: number) {
		super(`body read idle timeout (${idleTimeoutMs} ms)`);
		this.name = "IdleTimeoutError";
	}
}

/** Options for {@linkcode writeWithLimit} / {@linkcode saveStreamAtomic}. */
export interface SaveStreamOptions {
	/** Byte cap enforced mid-stream; overflow throws {@linkcode SizeLimitError}. Unlimited if undefined. */
	maxBytes?: number;
	/** Expected total bytes (from `Content-Length`); mismatch throws {@linkcode IncompleteBodyError}. */
	expectedBytes?: number;
	/** Max ms to wait between chunks; expiry throws {@linkcode IdleTimeoutError}. Disabled if undefined/0. */
	idleTimeoutMs?: number;
}

function readWithIdleTimeout(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	idleTimeoutMs: number | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
	if (!idleTimeoutMs) return reader.read();
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		reader.read(),
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new IdleTimeoutError(idleTimeoutMs)),
				idleTimeoutMs,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * Lazily stream `source` to `tmpPath` while enforcing the byte cap.
 * Returns the number of bytes written. On failure the source is cancelled
 * (so the runtime stops draining a body that will never be stored) and the
 * typed error rethrown; the caller owns tmp-file cleanup.
 */
export async function writeWithLimit(
	tmpPath: string,
	source: ReadableStream<Uint8Array>,
	opts: SaveStreamOptions = {},
): Promise<number> {
	const { maxBytes, expectedBytes, idleTimeoutMs } = opts;
	const file = await Deno.open(tmpPath, {
		create: true,
		write: true,
		truncate: true,
	});
	let written = 0;
	const reader = source.getReader();
	try {
		while (true) {
			const { value, done } = await readWithIdleTimeout(reader, idleTimeoutMs);
			if (done) break;
			if (!value) continue;
			written += value.byteLength;
			if (maxBytes !== undefined && written > maxBytes) {
				throw new SizeLimitError(maxBytes);
			}
			let off = 0;
			while (off < value.byteLength) {
				off += await file.write(value.subarray(off));
			}
		}
		if (expectedBytes !== undefined && written !== expectedBytes) {
			throw new IncompleteBodyError(written, expectedBytes);
		}
		return written;
	} catch (e) {
		try {
			await reader.cancel();
		} catch {
			// source may already be errored/closed
		}
		throw e;
	} finally {
		try {
			file.close();
		} catch {
			// already closed
		}
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}
}

/**
 * Stream `source` into `destPath` atomically: parent dirs are created, bytes
 * land in a `.tmp_<uuid>` sibling, and the tmp file is renamed over
 * `destPath` only on full success. On any failure the tmp file is removed and
 * the error rethrown. Returns the number of bytes written.
 */
export async function saveStreamAtomic(
	destPath: string,
	source: ReadableStream<Uint8Array>,
	opts: SaveStreamOptions = {},
): Promise<number> {
	await Deno.mkdir(dirname(destPath), { recursive: true });
	const tmpPath = destPath + `.tmp_${crypto.randomUUID()}`;
	try {
		const written = await writeWithLimit(tmpPath, source, opts);
		await Deno.rename(tmpPath, destPath);
		return written;
	} catch (e) {
		try {
			await Deno.remove(tmpPath);
		} catch {
			// ignore cleanup errors
		}
		throw e;
	}
}
