// The first file inside a tar (what Docker sends for a file copied out of a container). Pure, small, and strict: it reads ustar headers and refuses anything it does not understand by returning null.
const BLOCK = 512;

/** The bytes of the first regular file in a tar, or null when there is none or the tar is cut short. */
export function untarFirst(tar: Uint8Array): Uint8Array | null {
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const head = tar.subarray(at, at + BLOCK);
    if (head.every((b) => b === 0)) return null;
    const type = String.fromCharCode(head[156] ?? 0);
    const size = octal(head.subarray(124, 136));
    if (size === null) return null;
    const start = at + BLOCK;
    if (type === "0" || type === "\0") {
      if (start + size > tar.length) return null;
      return tar.slice(start, start + size);
    }
    at = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return null;
}

function octal(b: Uint8Array): number | null {
  const text = Array.from(b)
    .map((c) => (c === 0 ? " " : String.fromCharCode(c)))
    .join("")
    .trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}
