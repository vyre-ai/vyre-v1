// Packaging of the release artifacts (P-L11_18): the server tarball the installer and the updater read, the app web export, the Chrome extension, the Kits and connectors, and the
// releases.json that scripts/release/cli.ts sign turns into signed channel entries. Nothing here signs or publishes.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Releases } from "./channels.ts";
import { releaseCounter } from "./version.ts";

export const SERVER_TARBALL = "vyre.tgz";
export const APP_TARBALL = "vyre-app-web.tgz";
export const EXTENSION_ZIP = "vyre-chrome.zip";
export const KITS_TARBALL = "vyre-kits.tgz";

/** The files the installer and `vyre-server update` insist on finding in a server release (scripts/install/linux/install.sh unpack_release). */
export const SERVER_FILES: readonly string[] = ["VERSION", "compose.server.yml", "Caddyfile", "images.lock", "bin/vyre-server", "units/vyre-server.service", "units/vyre-server-update.service", "units/vyre-server-update.timer"];

const DIGEST_REF = /^[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/;
const IMAGE_KEYS = ["VYRE_IMAGE", "VYRE_AGENT_IMAGE", "VYRE_SANDBOX_IMAGE"] as const;
export type ImageKey = (typeof IMAGE_KEYS)[number];

export const sha256File = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** images.lock: one line per image, each pinned by digest. The server image is required; a tag without a digest is refused because `vyre-server update` refuses it too. */
export function imagesLock(images: Partial<Record<ImageKey, string>>): string {
  if (images.VYRE_IMAGE === undefined) throw new Error("the release needs VYRE_IMAGE");
  const lines: string[] = [];
  for (const k of IMAGE_KEYS) {
    const ref = images[k];
    if (ref === undefined) continue;
    if (!DIGEST_REF.test(ref)) throw new Error(`${k} must be pinned by digest (name@sha256:<64 hex>)`);
    lines.push(`${k}=${ref}`);
  }
  return `${lines.join("\n")}\n`;
}

function tar(args: string[]): void { execFileSync("tar", args, { stdio: ["ignore", "ignore", "pipe"] }); }

/** Names inside a tarball, for checks. */
export function tarList(file: string): string[] {
  return execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).split("\n").filter((l) => l !== "");
}

/** `tar -czf out -C parent dirname`: one top folder, no owner, files sorted so the same input gives the same bytes where the platform's tar allows it. */
function tarDir(parent: string, dirname: string, out: string): void {
  const gnu = ["--sort=name", "--owner=0", "--group=0", "--numeric-owner"];
  try { tar([...gnu, "-czf", out, "-C", parent, dirname]); } catch { tar(["-czf", out, "-C", parent, dirname]); }
}

export interface PackServerOptions { root: string; outDir: string; version: string; images: Partial<Record<ImageKey, string>> }

/** vyre.tgz: vyre-<version>/{VERSION, compose.server.yml, Caddyfile, images.lock, bin/vyre-server, units/*}. */
export function packServer(o: PackServerOptions): { file: string; sha256: string; members: string[] } {
  releaseCounter(o.version);
  const stage = fs.mkdtempSync(path.join(o.outDir, "stage-"));
  try {
    const top = `vyre-${o.version}`;
    const dir = path.join(stage, top);
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.mkdirSync(path.join(dir, "units"), { recursive: true });
    const copy = (from: string, to: string, mode?: number): void => {
      const src = path.join(o.root, from);
      if (!fs.existsSync(src)) throw new Error(`the release needs ${from}, which is not in the repository`);
      fs.copyFileSync(src, path.join(dir, to));
      if (mode !== undefined) fs.chmodSync(path.join(dir, to), mode);
    };
    fs.writeFileSync(path.join(dir, "VERSION"), o.version);
    fs.writeFileSync(path.join(dir, "images.lock"), imagesLock(o.images));
    copy("images/vyred/compose.server.yml", "compose.server.yml");
    copy("images/vyred/Caddyfile", "Caddyfile");
    copy("scripts/install/linux/vyre-server", "bin/vyre-server", 0o755);
    for (const u of ["vyre-server.service", "vyre-server-update.service", "vyre-server-update.timer"]) copy(`scripts/install/linux/units/${u}`, `units/${u}`);
    const file = path.join(o.outDir, SERVER_TARBALL);
    tarDir(stage, top, file);
    const members = tarList(file);
    for (const f of SERVER_FILES) if (!members.includes(`${top}/${f}`)) throw new Error(`the server tarball is missing ${f}`);
    return { file, sha256: sha256File(file), members };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

/** A folder as <name>/... in a .tgz. */
export function packFolder(o: { dir: string; outFile: string; topName: string }): { file: string; sha256: string } {
  if (!fs.existsSync(o.dir)) throw new Error(`${o.dir} does not exist`);
  const stage = fs.mkdtempSync(path.join(path.dirname(o.outFile), "stage-"));
  try {
    fs.cpSync(o.dir, path.join(stage, o.topName), { recursive: true });
    tarDir(stage, o.topName, o.outFile);
    return { file: o.outFile, sha256: sha256File(o.outFile) };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

// ---- a zip writer (stored and deflated entries), for the Chrome extension: Chrome and the Web Store read a .zip and the runner needs no zip tool

const crc32 = (b: Uint8Array): number => zlib.crc32(b);

function le(n: number, bytes: number): Buffer { const b = Buffer.alloc(bytes); if (bytes === 2) b.writeUInt16LE(n); else b.writeUInt32LE(n >>> 0); return b; }

/** A fixed time (1980-01-01) keeps the archive byte-identical for the same files. */
export function zipFiles(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.data);
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const crc = crc32(raw);
    const method = useDeflate ? 8 : 0;
    const head = Buffer.concat([le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(method, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(body.length, 4), le(raw.length, 4), le(name.length, 2), le(0, 2), name]);
    parts.push(head, body);
    central.push(Buffer.concat([le(0x02014b50, 4), le(0x031e, 2), le(20, 2), le(0x0800, 2), le(method, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(body.length, 4), le(raw.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0o100644 << 16 >>> 0, 4), le(offset, 4), name]));
    offset += head.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.concat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(central.length, 2), le(central.length, 2), le(dir.length, 4), le(offset, 4), le(0, 2)]);
  return Buffer.concat([...parts, dir, end]);
}

/** The names in a zip, read from its central directory. */
export function zipNames(zip: Buffer): string[] {
  const eocd = zip.lastIndexOf(le(0x06054b50, 4));
  if (eocd < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = zip.readUInt16LE(at + 28), m = zip.readUInt16LE(at + 30), k = zip.readUInt16LE(at + 32);
    names.push(zip.subarray(at + 46, at + 46 + n).toString("utf8"));
    at += 46 + n + m + k;
  }
  return names;
}

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
}

/** vyre-chrome.zip: the extension as Chrome loads it (apps/chrome without its tests and its package.json). */
export function packExtension(o: { dir: string; outFile: string }): { file: string; sha256: string; version: string; names: string[] } {
  const manifest = JSON.parse(fs.readFileSync(path.join(o.dir, "manifest.json"), "utf8")) as { version?: unknown };
  const names = walk(o.dir).filter((n) => !n.split(path.sep).includes("tests") && !n.split(path.sep).includes("node_modules") && n !== "package.json").map((n) => n.split(path.sep).join("/"));
  const zip = zipFiles(names.map((name) => ({ name, data: fs.readFileSync(path.join(o.dir, name)) })));
  fs.writeFileSync(o.outFile, zip);
  return { file: o.outFile, sha256: sha256File(o.outFile), version: typeof manifest.version === "string" ? manifest.version : "", names };
}

// ---- releases.json

export interface ArtifactSet { version: string; dir: string; notes?: string; security?: boolean }

/** One entry per channel whose artifact is in `dir`. A channel without its file is left out (staggered releases are normal). */
export function releasesFrom(a: ArtifactSet): Releases {
  const out: Releases = {};
  const add = (kind: keyof Releases, file: string): void => {
    const p = path.join(a.dir, file);
    if (!fs.existsSync(p)) return;
    out[kind] = { version: a.version, tarball: file, sha256: sha256File(p), ...(a.notes === undefined ? {} : { notes: a.notes }), ...(a.security === true ? { security: true } : {}) };
  };
  add("server", SERVER_TARBALL);
  add("app", APP_TARBALL);
  add("extension", EXTENSION_ZIP);
  add("kits", KITS_TARBALL);
  return out;
}

/** One file out of a zip made by zipFiles (or any zip with sizes in the local header). */
export function zipRead(zip: Buffer, name: string): Buffer | null {
  const eocd = zip.lastIndexOf(le(0x06054b50, 4));
  if (eocd < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10), csize = zip.readUInt32LE(at + 20), usize = zip.readUInt32LE(at + 24), crc = zip.readUInt32LE(at + 16);
    const n = zip.readUInt16LE(at + 28), m = zip.readUInt16LE(at + 30), k = zip.readUInt16LE(at + 32), local = zip.readUInt32LE(at + 42);
    const entry = zip.subarray(at + 46, at + 46 + n).toString("utf8");
    at += 46 + n + m + k;
    if (entry !== name) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + csize);
    const out = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (out.length !== usize || crc32(out) !== crc) throw new Error(`${name} in the zip is damaged`);
    return out;
  }
  return null;
}
