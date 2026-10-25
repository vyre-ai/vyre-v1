// A minimal ustar writer, for putting credential files into a container's tmpfs through the Engine API (PUT /containers/{id}/archive) without ever writing them to the host's disk.
// Files get the owner and mode asked for; every parent folder gets its own entry (mode 0700, same owner), because an unpacked parent would otherwise be root's and open.
import { SandboxError } from "./types.ts";

export interface TarFile { path: string; data: Uint8Array; mode: number; uid: number; gid: number; mtime: number }

const enc = new TextEncoder();

function octal(n: number, width: number): string { return n.toString(8).padStart(width - 1, "0") + "\0"; }

function header(name: string, size: number, mode: number, uid: number, gid: number, mtime: number, type: "0" | "5"): Uint8Array {
  const h = new Uint8Array(512);
  const put = (text: string, at: number, max: number): void => { const b = enc.encode(text); if (b.length > max) throw new SandboxError("sandbox.tar", `a name in the archive is too long: ${name.slice(0, 40)}`); h.set(b, at); };
  // name (100), with the folders in prefix (155) when the whole does not fit. A folder entry keeps its trailing slash in the name, so the split is at the slash before it.
  let base = name;
  let prefix = "";
  if (enc.encode(name).length > 100) {
    const body = name.endsWith("/") ? name.slice(0, -1) : name;
    const cut = body.lastIndexOf("/", 155);
    if (cut <= 0) throw new SandboxError("sandbox.tar", `a path in the archive is too long: ${name.slice(0, 40)}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  put(base, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(uid, 8), 108, 8);
  put(octal(gid, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  h.fill(0x20, 148, 156);   // checksum field counts as spaces while summing
  h[156] = type.charCodeAt(0);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

const pad = (n: number): number => (512 - (n % 512)) % 512;

/** Relative paths only; no `..`, no empty segment, no absolute path. */
export function tarPath(p: string): string[] {
  if (p === "" || p.startsWith("/") || p.includes("\0")) throw new SandboxError("sandbox.tar", `not a relative path: ${JSON.stringify(p).slice(0, 60)}`);
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) throw new SandboxError("sandbox.tar", `a path may not climb or repeat: ${p.slice(0, 60)}`);
  return segs;
}

export function tarFiles(files: readonly TarFile[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const dirs = new Set<string>();
  for (const f of files) {
    const segs = tarPath(f.path);
    for (let i = 1; i < segs.length; i++) {
      const d = segs.slice(0, i).join("/");
      if (!dirs.has(d)) { dirs.add(d); parts.push(header(`${d}/`, 0, 0o700, f.uid, f.gid, f.mtime, "5")); }
    }
    parts.push(header(f.path, f.data.length, f.mode, f.uid, f.gid, f.mtime, "0"), f.data, new Uint8Array(pad(f.data.length)));
  }
  parts.push(new Uint8Array(1024));   // end of archive
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Read back what tarFiles wrote (for tests and for checking an archive before it is sent). */
export function untar(tar: Uint8Array): Array<{ path: string; type: "file" | "dir"; mode: number; uid: number; gid: number; data: Uint8Array }> {
  const dec = new TextDecoder();
  const out: Array<{ path: string; type: "file" | "dir"; mode: number; uid: number; gid: number; data: Uint8Array }> = [];
  const field = (h: Uint8Array, at: number, len: number): string => dec.decode(h.subarray(at, at + len)).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length;) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const name = field(h, 0, 100);
    const prefix = field(h, 345, 155);
    const size = parseInt(field(h, 124, 12), 8);
    const type = String.fromCharCode(h[156] ?? 48);
    const path = (prefix === "" ? name : `${prefix}/${name}`).replace(/\/$/, "");
    at += 512;
    const data = tar.subarray(at, at + size);
    out.push({ path, type: type === "5" ? "dir" : "file", mode: parseInt(field(h, 100, 8), 8), uid: parseInt(field(h, 108, 8), 8), gid: parseInt(field(h, 116, 8), 8), data: new Uint8Array(data) });
    at += size + pad(size);
  }
  return out;
}
