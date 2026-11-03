// Vyre installs the CLI engines a turn needs (Claude Code, Codex, Grok) by itself, into a folder of its own on each computer: on a Mac ~/Library/Application Support/ai.vyre.desktop/engines, elsewhere
// <data dir>/engines (Windows included). Each program lives at <root>/<program>/<version>/<program> (<program>.exe on Windows), at the version engine-pins.ts names. Nothing here uses sudo or a global npm, edits a shell profile, or touches a person's
// own install or their ~/.claude, ~/.codex and ~/.grok sign-ins: a person's own copy is found first (cli-programs.ts) and this folder is looked in last.
// A download goes only to the vendor's hosts, is checked against the pinned size and SHA-256 before it is unpacked, and the unpacked program is checked again before it is made executable. Everything is
// written into a hidden folder beside the final one and renamed into place in one step, so a failed, partial or cut-short install leaves nothing a lookup would pick up.
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { randomHex, sha256Stream } from "../../kernel/src/log/hash.ts";
import { ENGINE_PINS, pinOf } from "./engine-pins.ts";
import type { EngineBuild, EnginePin, EnginePlatform } from "./engine-pins.ts";

/** Why an install did not finish, in the few words the chat turns into a sentence: offline (the vendor could not be reached), checksum (the file was not the pinned one), unsupported (no build for this computer), disk (it could not be written), failed (anything else). */
export type EngineInstallReason = "offline" | "checksum" | "unsupported" | "disk" | "failed";

export class EngineInstallError extends Error {
  readonly reason: EngineInstallReason;
  constructor(reason: EngineInstallReason, message: string) { super(message); this.name = "EngineInstallError"; this.reason = reason; }
}

/** The Mac's engines folder, under the desktop app's own folder in Application Support. */
export const MAC_ENGINES_DIR = ["Library", "Application Support", "ai.vyre.desktop", "engines"] as const;

/** Where Vyre keeps the engines it installs on this computer, or null where it has nowhere to put them. VYRE_ENGINES_DIR (an absolute folder) overrides both. */
export function enginesRoot(o: { platform?: NodeJS.Platform; home?: string | undefined; dataDir?: string | undefined; env?: Readonly<Record<string, string | undefined>> } = {}): string | null {
  const env = o.env ?? process.env;
  const set = env["VYRE_ENGINES_DIR"];
  if (set !== undefined && set !== "" && path.isAbsolute(set)) return set;
  if ((o.platform ?? process.platform) === "darwin") {
    const home = o.home ?? env["HOME"];
    return home ? path.join(home, ...MAC_ENGINES_DIR) : null;
  }
  return o.dataDir ? path.join(o.dataDir, "engines") : null;
}

/** The pinned build's name for this computer. A Linux whose C library is musl (Alpine) gets the musl build. */
export function enginePlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch, musl: boolean = isMusl()): EnginePlatform | null {
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (cpu === null) return null;
  if (platform === "darwin") return `darwin-${cpu}`;
  if (platform === "linux") return musl ? `linux-${cpu}-musl` : `linux-${cpu}`;
  if (platform === "win32") return `win32-${cpu}`;
  return null;
}

/** The program's file name on a computer: Windows runs only a name that ends in .exe. */
export const programFile = (program: string, platform: EnginePlatform | NodeJS.Platform | null = process.platform): string => (platform !== null && platform.startsWith("win32") ? `${program}.exe` : program);

function isMusl(exists: (p: string) => boolean = fs.existsSync): boolean {
  if (process.platform !== "linux") return false;
  return ["/lib/ld-musl-x86_64.so.1", "/lib/ld-musl-aarch64.so.1", "/lib/libc.musl-x86_64.so.1", "/lib/libc.musl-aarch64.so.1"].some((p) => exists(p));
}

/** The pinned build of a program for a computer, or undefined where there is none. */
export function buildOf(program: string, platform: EnginePlatform | null): EngineBuild | undefined {
  return platform === null ? undefined : pinOf(program)?.builds[platform];
}

/** Where Vyre's own copy of a program is, whether or not it is there yet. */
export function ownedProgram(root: string, program: string, platform: NodeJS.Platform = process.platform): string | null {
  const pin = pinOf(program);
  return pin ? path.join(root, pin.program, pin.version, programFile(pin.program, platform)) : null;
}

/** The folders that hold Vyre's own copies at their pinned versions: what is put last on an engine's PATH. An older version's folder is never on it. */
export function ownedProgramDirs(root: string): string[] {
  return Object.values(ENGINE_PINS).map((p) => path.join(root, p.program, p.version));
}

const runnable = (p: string): boolean => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

export interface InstallOptions {
  /** The engines folder. */
  root: string;
  /** Which build to take. Default: this computer's. */
  platform?: EnginePlatform | null;
  /** The pins to install from. Default: engine-pins.ts (a test hands in its own). */
  pins?: Readonly<Record<string, EnginePin>>;
  fetch?: typeof fetch;
  /** Bytes downloaded so far, of the whole file. */
  onProgress?: (done: number, total: number) => void;
  /** A download that sends nothing for this long is given up as offline. Default 60 s. */
  stallMs?: number;
}

const STALE_PART_MS = 60 * 60_000;

/** Downloads, checks and puts one program into the engines folder; answers its path. A program already there is answered at once. Throws EngineInstallError, and then nothing new is left behind. */
export async function installEngine(program: string, o: InstallOptions): Promise<string> {
  const pin = o.pins ? (Object.hasOwn(o.pins, program) ? o.pins[program] : undefined) : pinOf(program);
  const platform = o.platform === undefined ? enginePlatform() : o.platform;
  const build = pin && platform !== null ? pin.builds[platform] : undefined;
  if (!pin || !build) throw new EngineInstallError("unsupported", `${program} has no build Vyre can install on this computer`);
  const home = path.join(o.root, pin.program);
  const final = path.join(home, pin.version);
  const file = programFile(pin.program, platform);
  const target = path.join(final, file);
  if (runnable(target)) return target;

  try { fs.mkdirSync(home, { recursive: true, mode: 0o755 }); } catch (e) { throw diskOr(e, "the engines folder could not be made"); }
  sweepParts(home);
  // A hidden folder beside the final one: on the same disk, so the rename below is one step, and never on any PATH.
  const part = path.join(home, `.part-${process.pid}-${randomHex(4)}`);
  try {
    fs.mkdirSync(part, { mode: 0o700 });
    const packed = path.join(part, `${file}.zst`);
    await download(build, pin.hosts, packed, o);
    const unpacked = path.join(part, file);
    await unpack(packed, unpacked, build);
    fs.rmSync(packed, { force: true });
    fs.chmodSync(unpacked, 0o755);
    fs.chmodSync(part, 0o755);
    try { fs.renameSync(part, final); }
    catch (e) {
      // another Vyre on this computer (the Mac runs up to three daemons) finished the same install first: theirs is the same checked file
      if (runnable(target)) return target;
      // a version folder without its program (someone deleted the file) is not an install: it makes way for this one
      if (!fs.existsSync(final)) throw e;
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(part, final);
    }
    pruneOlder(home, pin.version);
    return target;
  } catch (e) {
    if (e instanceof EngineInstallError) throw e;
    throw diskOr(e, e instanceof Error ? e.message : "the install did not finish");
  } finally {
    fs.rmSync(part, { recursive: true, force: true });
  }
}

/** Fetches the file, following redirects only to the pin's hosts, and writes it while counting and hashing; the size and SHA-256 must be the pinned ones. */
async function download(build: EngineBuild, hosts: readonly string[], to: string, o: InstallOptions): Promise<void> {
  const get = o.fetch ?? fetch;
  const stallMs = o.stallMs ?? 60_000;
  const abort = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const beat = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; abort.abort(); }, stallMs); timer.unref?.(); };
  try {
    beat();
    let url = new URL(build.url);
    let res: Response | null = null;
    for (let hop = 0; hop < 6 && res === null; hop++) {
      if (url.protocol !== "https:" || !hosts.includes(url.hostname)) throw new EngineInstallError("failed", `the download was sent to ${url.hostname}, which is not the vendor's`);
      let r: Response;
      try { r = await get(url, { redirect: "manual", signal: abort.signal }); }
      catch (e) { throw offline(e, stalled); }
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const where = r.headers.get("location");
        await r.body?.cancel().catch(() => undefined);
        if (!where) throw new EngineInstallError("failed", "the download was redirected nowhere");
        url = new URL(where, url);
        continue;
      }
      if (!r.ok || !r.body) { await r.body?.cancel().catch(() => undefined); throw new EngineInstallError("failed", `the download answered ${r.status}`); }
      res = r;
    }
    if (res === null || res.body === null) throw new EngineInstallError("failed", "the download was redirected too many times");
    const hash = sha256Stream();
    let done = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        done += chunk.length;
        if (done > build.size) { cb(new EngineInstallError("checksum", "the download is larger than the pinned file")); return; }
        hash.update(chunk);
        beat();
        o.onProgress?.(done, build.size);
        cb(null, chunk);
      },
    });
    try { await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), meter, fs.createWriteStream(to, { flags: "wx", mode: 0o600 }), { signal: abort.signal }); }
    catch (e) { if (e instanceof EngineInstallError) throw e; if (isDisk(e)) throw diskOr(e, "the download could not be written"); throw offline(e, stalled); }
    if (done !== build.size || hash.hex() !== build.sha256) throw new EngineInstallError("checksum", "the download is not the pinned file, so it was not used");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Unpacks the checked file with zstd (Node's own), stopping at the pinned size; the program must hash to the pinned SHA-256. */
async function unpack(from: string, to: string, build: EngineBuild): Promise<void> {
  const hash = sha256Stream();
  let n = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > build.binarySize) { cb(new EngineInstallError("checksum", "the program is larger than the pinned one")); return; }
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const unzstd = (zlib as unknown as { createZstdDecompress?: () => Transform }).createZstdDecompress;
  if (!unzstd) throw new EngineInstallError("failed", "this Node cannot unpack zstd");
  try { await pipeline(fs.createReadStream(from), unzstd(), cap, fs.createWriteStream(to, { flags: "wx", mode: 0o600 })); }
  catch (e) { if (e instanceof EngineInstallError) throw e; if (isDisk(e)) throw diskOr(e, "the program could not be written"); throw new EngineInstallError("checksum", "the download could not be unpacked, so it was not used"); }
  if (n !== build.binarySize || hash.hex() !== build.binarySha256) throw new EngineInstallError("checksum", "the unpacked program is not the pinned one, so it was not used");
}

/** Hidden folders an install that was cut short left (the process ended mid-download). One younger than an hour may be another Vyre's install in progress and is left alone. */
function sweepParts(home: string, now: number = Date.now()): void {
  let names: string[] = [];
  try { names = fs.readdirSync(home); } catch { return; }
  for (const n of names) {
    if (!n.startsWith(".part-")) continue;
    const p = path.join(home, n);
    try { if (now - fs.statSync(p).mtimeMs > STALE_PART_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone already */ }
  }
}

/** Versions the pins moved on from: they are never looked in, so their disk space comes back. An engine still running from one keeps its open file. */
function pruneOlder(home: string, keep: string): void {
  let names: string[] = [];
  try { names = fs.readdirSync(home); } catch { return; }
  for (const n of names) if (n !== keep && !n.startsWith(".part-")) fs.rmSync(path.join(home, n), { recursive: true, force: true });
}

const DISK = new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS"]);
const isDisk = (e: unknown): boolean => DISK.has(String((e as { code?: unknown } | null)?.code ?? ""));
const diskOr = (e: unknown, words: string): EngineInstallError => (isDisk(e) ? new EngineInstallError("disk", `${words}: ${String((e as { code?: unknown }).code)}`) : e instanceof EngineInstallError ? e : new EngineInstallError("failed", words));
const offline = (e: unknown, stalled: boolean): EngineInstallError =>
  e instanceof EngineInstallError ? e : new EngineInstallError("offline", stalled ? "the download stopped sending" : `the vendor could not be reached${(e as { cause?: { code?: string } } | null)?.cause?.code ? ` (${(e as { cause: { code: string } }).cause.code})` : ""}`);

/** What the installer last did for a program, for the chat and the logs. */
export interface EngineSetupState { phase: "idle" | "installing" | "ready" | "failed"; done?: number; total?: number; reason?: EngineInstallReason; at?: number }

export interface EngineInstaller {
  readonly root: string;
  /** Is there a build of this program for this computer? */
  supported(program: string): boolean;
  /** Vyre's own copy of the program, when it is there. */
  installed(program: string): string | null;
  /** Installs the program when it is not there; one install per program at a time, whoever asks. */
  ensure(program: string): Promise<string>;
  /** Did the last try fail a short while ago? Then a turn does not wait for another try: another account answers when there is one. */
  failedRecently(program: string): boolean;
  state(program: string): EngineSetupState;
  /** Forget earlier failures (a person pressed Install). */
  forget(): void;
}

export interface InstallerOptions extends Omit<InstallOptions, "onProgress"> {
  /** How long a failure is remembered. Default 10 minutes. */
  failureMs?: number;
  now?: () => number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** Replaces the install itself (tests). */
  install?: (program: string, o: InstallOptions) => Promise<string>;
}

export const FAILURE_MEMORY_MS = 10 * 60_000;

export function createEngineInstaller(o: InstallerOptions): EngineInstaller {
  const now = o.now ?? Date.now;
  const platform = o.platform === undefined ? enginePlatform() : o.platform;
  const all = o.pins ?? (ENGINE_PINS as Readonly<Record<string, EnginePin>>);
  const pinFor = (program: string): EnginePin | undefined => (Object.hasOwn(all, program) ? all[program] : undefined);
  const states = new Map<string, EngineSetupState>();
  const inflight = new Map<string, Promise<string>>();
  const install = o.install ?? installEngine;
  const where = (program: string): string | null => { const pin = pinFor(program); return pin ? path.join(o.root, pin.program, pin.version, programFile(pin.program, platform)) : null; };
  return {
    root: o.root,
    supported: (program) => platform !== null && pinFor(program)?.builds[platform] !== undefined,
    installed: (program) => { const p = where(program); return p !== null && runnable(p) ? p : null; },
    ensure(program) {
      const running = inflight.get(program);
      if (running) return running;
      const here = where(program);
      if (here !== null && runnable(here)) { states.set(program, { phase: "ready" }); return Promise.resolve(here); }
      states.set(program, { phase: "installing", done: 0, total: (platform !== null ? pinFor(program)?.builds[platform]?.size : undefined) ?? 0 });
      o.log?.("setting up an engine", { program, version: pinFor(program)?.version ?? null });
      const p = install(program, { ...o, platform, pins: all, onProgress: (done, total) => states.set(program, { phase: "installing", done, total }) })
        .then((at) => { states.set(program, { phase: "ready" }); o.log?.("an engine is set up", { program }); return at; },
          (e: unknown) => {
            const err = e instanceof EngineInstallError ? e : new EngineInstallError("failed", e instanceof Error ? e.message : "the install did not finish");
            states.set(program, { phase: "failed", reason: err.reason, at: now() });
            o.log?.("an engine could not be set up", { program, reason: err.reason, error: err.message });
            throw err;
          })
        .finally(() => inflight.delete(program));
      inflight.set(program, p);
      return p;
    },
    failedRecently(program) {
      const s = states.get(program);
      return s?.phase === "failed" && s.at !== undefined && now() - s.at < (o.failureMs ?? FAILURE_MEMORY_MS);
    },
    state: (program) => states.get(program) ?? { phase: "idle" },
    forget() { for (const [k, s] of states) if (s.phase === "failed") states.delete(k); },
  };
}

// The installer of this process: one per computer's engines folder, set when the daemon wires the engine (runtime.ts) or a joined computer starts its launcher (node-cli.ts). Off by default, so a test
// daemon never downloads anything.
let current: EngineInstaller | null = null;

/** Turn the installer on for an engines folder (null turns it off). Answers the installer. */
export function configureEngines(o: InstallerOptions | null): EngineInstaller | null {
  current = o === null ? null : current !== null && current.root === o.root && o.install === undefined && o.fetch === undefined ? current : createEngineInstaller(o);
  return current;
}

/** The installer, when this process has one. */
export const engines = (): EngineInstaller | null => current;
