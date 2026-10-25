// @ts-check
// Chrome's native messaging framing: each message is a 32-bit length in the machine's byte order, then that many bytes of UTF-8 JSON.
// Chrome caps a message from the host at 1 MiB and one to the host at 64 MiB; we keep both far below. Used by the host program
// (native/host.js) and by the tests, which stand in for Chrome.

export const MAX_MESSAGE = 1024 * 1024;

/** @param {unknown} message @returns {Buffer} */
export function encode(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_MESSAGE) throw new RangeError(`message of ${body.length} bytes is over the ${MAX_MESSAGE} byte limit`);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/**
 * A decoder you feed chunks; it returns every whole message so far and keeps the rest for the next chunk.
 * A length over the limit or a body that is not JSON throws, and the caller closes the connection.
 */
export function createDecoder() {
  /** @type {Buffer} */
  let pending = Buffer.alloc(0);
  return {
    /** @param {Uint8Array} chunk @returns {unknown[]} */
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      /** @type {unknown[]} */
      const out = [];
      for (;;) {
        if (pending.length < 4) break;
        const n = pending.readUInt32LE(0);
        if (n > MAX_MESSAGE) throw new RangeError(`message length ${n} is over the limit`);
        if (pending.length < 4 + n) break;
        const text = pending.subarray(4, 4 + n).toString("utf8");
        pending = pending.subarray(4 + n);
        out.push(JSON.parse(text));
      }
      return out;
    },
    get buffered() { return pending.length; },
  };
}
