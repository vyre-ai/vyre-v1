// The tar the sites runner speaks: a build context going to Docker, a file put into a container, an uploaded .tar.gz read back. ustar with the prefix field for paths up to 255
// characters and GNU long names past that, so a deep Next.js or monorepo path fits. Regular files and folders only.
export interface TarEntry { path: string; data: Uint8Array; mode?: number; mtime?: number }

const enc = new TextEncoder();
const dec = new TextDecoder();
const pad = (n: number): number => (512 - (n % 512)) % 512;

function octal(n: number, width: number): string { return `${n.toString(8).padStart(width - 1, "0")}\0`; }

function header(name: string, size: number, mode: number, mtime: number, type: string, prefix = ""): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number, len: number): void => { h.set(enc.encode(s).subarray(0, len), at); };
  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

function named(path: string, size: number, mode: number, mtime: number, type: string): Uint8Array[] {
  const bytes = enc.encode(path);
  if (bytes.length <= 100) return [header(path, size, mode, mtime, type)];
  const cut = path.lastIndexOf("/", 155);
  if (cut > 0 && enc.encode(path.slice(cut + 1)).length <= 100 && enc.encode(path.slice(0, cut)).length <= 155) return [header(path.slice(cut + 1), size, mode, mtime, type, path.slice(0, cut))];
  // GNU long name: a pseudo entry holding the name, then the entry
  return [header("././@LongLink", bytes.length + 1, 0o644, 0, "L"), bytes, new Uint8Array(1 + pad(bytes.length + 1)), header(path.slice(0, 100), size, mode, mtime, type)];
}

export function tarFiles(files: readonly TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const dirs = new Set<string>();
  const now = Math.floor(Date.now() / 1000);
  for (const f of files) {
    const segs = f.path.split("/");
    if (f.path === "" || f.path.startsWith("/") || segs.some((s) => s === "" || s === "." || s === "..")) throw new Error(`not a relative path: ${f.path.slice(0, 80)}`);
    for (let i = 1; i < segs.length; i++) {
      const d = segs.slice(0, i).join("/");
      if (!dirs.has(d)) { dirs.add(d); parts.push(...named(`${d}/`, 0, 0o755, f.mtime ?? now, "5")); }
    }
    parts.push(...named(f.path, f.data.length, f.mode ?? 0o644, f.mtime ?? now, "0"), f.data, new Uint8Array(pad(f.data.length)));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const field = (h: Uint8Array, at: number, len: number): string => dec.decode(h.subarray(at, at + len)).replace(/\0.*$/s, "");

/** Files and folders of a tar, with ustar prefixes and GNU long names joined. */
export function untar(tar: Uint8Array): Array<{ path: string; type: "file" | "dir"; data: Uint8Array }> {
  const out: Array<{ path: string; type: "file" | "dir"; data: Uint8Array }> = [];
  let long: string | null = null;
  for (let at = 0; at + 512 <= tar.length;) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(field(h, 124, 12).trim() || "0", 8);
    const type = field(h, 156, 1) || "0";
    const data = tar.subarray(at + 512, at + 512 + size);
    at += 512 + size + pad(size);
    if (type === "L") { long = dec.decode(data).replace(/\0.*$/s, ""); continue; }
    const prefix = field(h, 345, 155);
    const path = (long ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100))).replace(/^\.\//, "");
    long = null;
    if (type === "5") out.push({ path: path.replace(/\/$/, ""), type: "dir", data: new Uint8Array() });
    else if (type === "0" || type === "\0" || type === "7") out.push({ path, type: "file", data: new Uint8Array(data) });
  }
  return out;
}
