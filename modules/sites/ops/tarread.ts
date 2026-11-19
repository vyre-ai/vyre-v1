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

/** Thrown when the file in the tar is bigger than the cap; nothing past the header has been kept. */
export class TooBig extends Error {
  size: number;
  constructor(size: number) {
    super("too large");
    this.name = "TooBig";
    this.size = size;
  }
}

/** The first file of a tar, read as it arrives: the header says how big the file is, so one over the cap is refused before a byte of it is kept, and no more than the cap is ever held. */
export class TarFirst {
  private max: number;
  private head: number[] = [];
  private size = -1;
  private skip = 0;
  private got = 0;
  private parts: Uint8Array[] = [];
  done = false;
  constructor(max: number) {
    this.max = max;
  }
  push(chunk: Uint8Array): void {
    let at = 0;
    while (at < chunk.length && !this.done) {
      if (this.size < 0) {
        const need = BLOCK - this.head.length;
        const take = Math.min(need, chunk.length - at);
        for (let i = 0; i < take; i++) this.head.push(chunk[at + i] as number);
        at += take;
        if (this.head.length < BLOCK) return;
        const h = Uint8Array.from(this.head);
        this.head = [];
        if (h.every((b) => b === 0)) {
          this.done = true;
          return;
        }
        const n = octal(h.subarray(124, 136));
        if (n === null) throw new Error("not a tar");
        const type = String.fromCharCode(h[156] ?? 0);
        if (type === "0" || type === "\0") {
          if (n > this.max) throw new TooBig(n);
          this.size = n;
          if (n === 0) this.done = true;
        } else this.skip = Math.ceil(n / BLOCK) * BLOCK;
        continue;
      }
      if (this.skip > 0) {
        const t = Math.min(this.skip, chunk.length - at);
        this.skip -= t;
        at += t;
        if (this.skip === 0 && this.size < 0) continue;
        continue;
      }
      const t = Math.min(this.size - this.got, chunk.length - at);
      this.parts.push(chunk.slice(at, at + t));
      this.got += t;
      at += t;
      if (this.got === this.size) this.done = true;
    }
  }
  /** The file, or null when the tar ended before it was whole. */
  result(): Uint8Array | null {
    if (this.size < 0 || this.got < this.size) return this.size === 0 ? new Uint8Array(0) : null;
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}
