// A browser profile at rest: an agent computer's profile disk and an agent's Chrome folder in the Space browser (ARCH 6.6, V1-SPEC 2.7). While nothing runs on it, the profile is read out of the Docker volume
// as a tar, sealed (AES-256-GCM, 8 MB chunks, one key per profile made from the host's seal key), written to the Space's data folder, and the volume is emptied. When the browser is needed again the file is
// checked end to end, then opened and put back first. Both directions stream, so memory stays at a few chunks whatever the size of the profile.
//
// What this protects: a copy of the Docker volume or of Docker's own data folder. What it does not: a computer or browser that is awake (its profile is plain on the volume, plus up to 20 s of quiet and one
// 30 s sweep after a browser stops); anyone with the Space data folder or host root (seal.key sits beside the sealed files and also opens ctx.seal and blobs/); the daemon's memory, swap and core dumps;
// freed disk blocks (a delete frees blocks, it does not erase them, and snapshots of the volume's disk keep what they held); an older whole sealed file put back by someone who can write the data folder
// (a rollback is not detected); and a computer that joined, which holds no key. A profile over SEAL_CAP_BYTES is not sealed at all: it stays plain, is logged, and shows in the computers health.
//
// File format: line 1 is a header {"v":2,"fid":<random 16 bytes>}, then one JSON line per chunk, a Box {iv, ct, tag}. The additional data names the kind, the profile, the file id, the chunk number and whether
// it is the last chunk, so a cut, a swap, chunks moved to another profile or another file fail to open. A profile has a small state file beside it, because "the volume holds the truth" must survive a crash:
//   none     no sealed file, no state file: a profile that never slept, or one made before sealing existed.
//   sealed   a sealed file and no state file: the file is the profile and the volume holds nothing.
//   hot      the volume is the truth (a profile restored whole, or one that has never been sealed). A boot, and the periodic check, seal every hot profile that is not running.
//   wiping   the sealed file is the truth; the volume still has to be emptied (after a seal, or after a restore that did not finish). It is never read again, so half-emptied or half-restored data cannot
//            replace the file. A restore that fails leaves this state, so the good file is never lost to a broken restore.
//
// LOCK ORDER (one rule, followed everywhere; round 3 of the review found a deadlock where this was not true):
//   1. There is one lock per computer and one per browser profile, and each is module-wide (computersLock, browserLock), so a rebound host shares it with the one it replaces.
//   2. Code that holds a lock never waits for another lock, for a boot recovery, or for anything that takes a lock. Nothing is ever held in two locks at once.
//   3. Boot recovery and the periodic checks take one lock at a time, for one computer or profile, and give it back before the next. Nobody waits for recovery: a wake or a call simply takes its own lock and
//      finds the profile sealed, plain or being sealed, in order.
//   4. Waiting for a lock holder is the only waiting there is, and a holder only waits for Docker.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { aesUnwrap, aesWrap, hkdf32 } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";
import type { DockerHttp, DockerStream } from "../../../sandbox/src/docker.ts";

export const PROFILE_GUEST = "/home/agent/.profile-disk";
export const CHUNK = 8 * 1024 * 1024;
/**
 * The most a profile may hold (its tar) and still be sealed: 1 GiB, the same as the limit the Chrome migration already has. Sealing and opening stream, so memory is not the reason; time is: at the measured
 * speed (about 30 MB/s each way) 1 GiB is about 35 s to seal and the same to wake, and a larger profile would make a wake feel broken. A profile over it is left plain and reported.
 */
export const SEAL_CAP_BYTES = 1024 * 1024 * 1024;
const FILE_SUFFIX = ".profile";

export type SealKind = "computers" | "sbrowser";
export type SealState = "none" | "sealed" | "hot" | "wiping";

/** The ids that may name a sealed file: a computer id, or a browser profile id. Anything else is refused, never rewritten. */
const ID: Record<SealKind, RegExp> = { computers: /^cmt_[a-z0-9-]{8,64}$/, sbrowser: /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/ };
export function checkId(kind: SealKind, id: unknown): string {
  if (typeof id !== "string" || !ID[kind].test(id)) throw new Error("that is not the id of a computer or browser profile");
  return id;
}

/** The sealed file does not open: changed, cut short, or made under another key. Only a failed check maps to this; a disk error is reported as itself. */
export const UNOPENED = "the sealed profile did not open: it was changed, cut short or sealed under another key. Nothing was started and the sealed data was not touched.";
export class UnopenedError extends Error { constructor() { super(UNOPENED); this.name = "UnopenedError"; } }
/** The profile is over the cap: it stays plain. */
export class TooLargeError extends Error { bytes: number; constructor(bytes: number) { super(`the profile is over ${Math.round(SEAL_CAP_BYTES / 1024 ** 2)} MB and is not sealed`); this.name = "TooLargeError"; this.bytes = bytes; } }

const aadOf = (kind: SealKind, id: string, fid: string, i: number, last: boolean): string => `vyre:${kind}:profile:v2|${id}|${fid}|${i}|${last ? 1 : 0}`;
const keyOf = (key: Uint8Array, kind: SealKind, id: string): Buffer => hkdf32(key, `vyre:${kind}:profile:v1`, id);
/** The key as the daemon loaded it. A missing or short key is a refusal, never a new key. */
function loaded(key: () => Uint8Array): Uint8Array {
  let k: Uint8Array | undefined;
  try { k = key(); } catch (e) { throw new Error(`the seal key is not available, so saved browser profiles cannot be locked or opened (${e instanceof Error ? e.message : "no key"})`); }
  if (!(k instanceof Uint8Array) || k.length < 16) throw new Error("the seal key is not available, so saved browser profiles cannot be locked or opened");
  return k;
}

/** One thing at a time per name. */
export function keyedLock(): <T>(id: string, fn: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (tails.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn);
    const mine = run.catch(() => undefined);
    tails.set(id, mine);
    void mine.then(() => { if (tails.get(id) === mine) tails.delete(id); });
    return run;
  };
}

/** Seal a stream of tar bytes to `file`: chunks are made as the bytes arrive, the file is flushed, and nothing is left if it fails or the stream runs past `cap`. Answers the plain size. */
/**
 * Walks a tar as it streams by and says whether it ended properly: every header's data arrived whole, and the two blocks of zeros that close a tar came on a header boundary. An archive the Engine cut short
 * and closed cleanly fails this wherever the cut fell, including inside zero-filled data. Memory is one header.
 */
export class TarWalker {
  private head = Buffer.alloc(512);
  private have = 0;
  private skip = 0;          // data and padding still to pass
  private zeros = 0;         // consecutive zero blocks at a header boundary
  feed(b: Uint8Array): void {
    let at = 0;
    while (at < b.length) {
      if (this.skip > 0) { const n = Math.min(this.skip, b.length - at); this.skip -= n; at += n; continue; }
      const n = Math.min(512 - this.have, b.length - at);
      this.head.set(b.subarray(at, at + n), this.have); this.have += n; at += n;
      if (this.have < 512) continue;
      this.have = 0;
      if (this.head.every((x) => x === 0)) { this.zeros += 1; continue; }
      if (this.zeros >= 2) continue;   // anything after the end blocks is padding
      this.zeros = 0;
      const raw = this.head.subarray(124, 136);
      const size = (raw[0]! & 0x80) !== 0 ? raw.subarray(1).reduce((s, x) => s * 256 + x, 0) : parseInt(raw.toString("latin1").replace(/\0.*$/, "").trim() || "0", 8) || 0;
      this.skip = Math.ceil(size / 512) * 512;
    }
  }
  /** Whole: a header boundary, no data owing, and the two end blocks seen. */
  get complete(): boolean { return this.have === 0 && this.skip === 0 && this.zeros >= 2; }
}

/** Run a step that may hang with an upper limit: the answer, or `fallback` when the time is up (the step is left to finish or fail on its own). */
export async function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<T>((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]); } finally { if (t) clearTimeout(t); }
}

/** The Space browser's container does not know the guard (an image from before it existed): a profile cannot be sealed there. */
export class NoGuardError extends Error { constructor() { super("the Space browser needs updating before saved browser profiles can be locked"); this.name = "NoGuardError"; } }

export class TruncatedError extends Error { constructor() { super("the profile's archive ended early, so it was not sealed and nothing was removed"); this.name = "TruncatedError"; } }

export async function sealTo(file: string, src: AsyncIterable<Uint8Array>, key: Uint8Array, kind: SealKind, id: string, cap = SEAL_CAP_BYTES, requireTarEnd = false): Promise<number> {
  const fid = globalThis.crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  const k = keyOf(key, kind, id);
  const fh = await fsp.open(file, "w", 0o600);
  let ok = false;
  try {
    let i = 0, total = 0, parts: Buffer[] = [], len = 0;
    const walker = requireTarEnd ? new TarWalker() : null;
    const emit = async (chunk: Uint8Array, last: boolean): Promise<void> => { await fh.write(`${JSON.stringify(aesWrap(k, chunk, aadOf(kind, id, fid, i++, last)))}\n`); };
    await fh.write(`${JSON.stringify({ v: 2, fid })}\n`);
    for await (const part of src) {
      const b = Buffer.from(part.buffer, part.byteOffset, part.byteLength);
      total += b.length;
      if (total > cap) throw new TooLargeError(total);
      walker?.feed(b);
      parts.push(b); len += b.length;
      if (len > CHUNK) {
        const all = Buffer.concat(parts);
        let off = 0;
        for (; all.length - off > CHUNK; off += CHUNK) await emit(all.subarray(off, off + CHUNK), false);
        parts = [all.subarray(off)]; len = all.length - off;
      }
    }
    // a tar ends with two blocks of zeros; an archive cut short by the Engine after its header was sent still closes cleanly, and sealing it as whole would let the wipe delete the rest
    if (walker && !walker.complete) throw new TruncatedError();
    await emit(Buffer.concat(parts), true);
    await fh.sync();
    ok = true;
    return total;
  } finally {
    await fh.close().catch(() => undefined);
    if (!ok) await fsp.rm(file, { force: true }).catch(() => undefined);
  }
}

/** The plain chunks of a sealed file, in order, one at a time. Throws UnopenedError when anything fails to check; a disk error is passed on as it is. */
export async function* openFrom(file: string, key: Uint8Array, kind: SealKind, id: string): AsyncGenerator<Buffer> {
  const k = keyOf(key, kind, id);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  let fid: string | null = null, i = 0, pending: Box | null = null;
  const parse = (line: string): Box => {
    try {
      const b = JSON.parse(line) as Box;
      if (typeof b?.iv !== "string" || typeof b.ct !== "string" || typeof b.tag !== "string") throw new Error("shape");
      if (Buffer.from(b.iv, "base64").length !== 12 || Buffer.from(b.tag, "base64").length !== 16) throw new Error("sizes");
      return b;
    } catch { throw new UnopenedError(); }
  };
  let legacy = false;   // the first version's files (no header, no file id): opened once, and the next seal writes the new form
  const decrypt = (b: Box, last: boolean): Buffer => { try { return Buffer.from(aesUnwrap(k, b, legacy ? `vyre:${kind}:profile:v1|${id}|${i++}|${last ? 1 : 0}` : aadOf(kind, id, fid as string, i++, last))); } catch { throw new UnopenedError(); } };
  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      if (fid === null) {
        let h: { v?: unknown; fid?: unknown; iv?: unknown };
        try { h = JSON.parse(line) as typeof h; } catch { throw new UnopenedError(); }
        if (typeof h.iv === "string") { legacy = true; fid = "legacy"; }   // no header: the first chunk itself
        else {
          if (h.v !== 2 || typeof h.fid !== "string" || !/^[0-9a-f]{32}$/.test(h.fid)) throw new UnopenedError();
          fid = h.fid;
          continue;
        }
      }
      if (pending !== null) yield decrypt(pending, false);
      pending = parse(line);
    }
    if (pending === null || fid === null) throw new UnopenedError();
    yield decrypt(pending, true);
  } finally { rl.close(); }
}

/** The directory is flushed, so a rename survives a power cut. (Node has no F_FULLFSYNC: on macOS this is what fsync gives.) */
function syncDir(dir: string): void {
  let fd: number | undefined;
  try { fd = fs.openSync(dir, "r"); fs.fsyncSync(fd); } catch { /* a platform that cannot flush a directory */ } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export interface SealedStoreDeps {
  /** The seal key as the daemon loaded it, at each use. It throws or answers nothing when there is none; a key is never made here. */
  key(): Uint8Array;
  /** The folder the sealed files and state files live in. */
  dir: string;
  kind: SealKind;
}

/** Where a profile's sealed file and state live, and how they are written. Nothing here knows about Docker. */
export function createSealedStore(d: SealedStoreDeps) {
  const file = (id: string): string => path.join(d.dir, `${checkId(d.kind, id)}${FILE_SUFFIX}`);
  const mark = (id: string): string => `${file(id)}.state`;
  const writeState = (to: string, text: string): void => {
    fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 });
    const tmp = `${to}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, to);
    syncDir(d.dir);
  };
  return {
    file,
    state(id: string): SealState {
      try { const t = fs.readFileSync(mark(id), "utf8").trim(); if (t === "hot" || t === "wiping") return t; } catch { /* no state file */ }
      return fs.existsSync(file(id)) ? "sealed" : "none";
    },
    setState(id: string, s: "hot" | "wiping"): void { writeState(mark(id), s); },
    clearState(id: string): void { fs.rmSync(mark(id), { force: true }); syncDir(d.dir); },
    hasFile(id: string): boolean { return fs.existsSync(file(id)); },
    /** The ids with a state file: profiles whose volume may hold a plain copy. */
    pending(): string[] {
      try { return fs.readdirSync(d.dir).filter((n) => n.endsWith(`${FILE_SUFFIX}.state`)).map((n) => n.slice(0, -`${FILE_SUFFIX}.state`.length)).filter((id) => ID[d.kind].test(id)); } catch { return []; }
    },
    /** Seal the stream and make it the profile's file, atomically and durably. A stream past the cap or a failure leaves the old file as it was. Answers the plain size. */
    async saveFrom(id: string, src: AsyncIterable<Uint8Array>, cap = SEAL_CAP_BYTES, requireTarEnd = false): Promise<number> {
      const f = file(id);
      fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 });
      const tmp = `${f}.tmp`;
      const bytes = await sealTo(tmp, src, loaded(d.key), d.kind, id, cap, requireTarEnd);
      fs.renameSync(tmp, f);
      syncDir(d.dir);
      return bytes;
    },
    /** The whole file is read and every chunk checked, nothing kept. Null when there is no file. Throws UnopenedError (nothing touched) when it does not check. */
    async verify(id: string): Promise<number | null> {
      if (!fs.existsSync(file(id))) return null;
      let n = 0;
      for await (const c of openFrom(file(id), loaded(d.key), d.kind, id)) n += c.length;
      return n;
    },
    open(id: string): AsyncGenerator<Buffer> { return openFrom(file(id), loaded(d.key), d.kind, id); },
    /** A profile over the cap is remembered on disk, so a restart does not forget it and the health can still name it. */
    setOversize(id: string, bytes: number): void { fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(`${file(id)}.big`, String(bytes), { mode: 0o600 }); },
    clearOversize(id: string): void { fs.rmSync(`${file(id)}.big`, { force: true }); },
    /** A guard that could not be lifted after a whole restore: remembered on disk, so a restart still lifts it. */
    setLift(id: string): void { fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(`${file(id)}.lift`, "1", { mode: 0o600 }); },
    clearLift(id: string): void { fs.rmSync(`${file(id)}.lift`, { force: true }); },
    needsLift(id: string): boolean { return fs.existsSync(`${file(id)}.lift`); },
    oversize(): Array<{ id: string; bytes: number }> {
      try { return fs.readdirSync(d.dir).filter((n) => n.endsWith(`${FILE_SUFFIX}.big`)).map((n) => ({ id: n.slice(0, -`${FILE_SUFFIX}.big`.length), bytes: Number(fs.readFileSync(path.join(d.dir, n), "utf8")) || 0 })).filter((x) => ID[d.kind].test(x.id)); } catch { return []; }
    },
    discard(id: string): void { for (const p of [file(id), `${file(id)}.tmp`, mark(id), `${mark(id)}.tmp`, `${file(id)}.big`, `${file(id)}.lift`]) fs.rmSync(p, { force: true }); syncDir(d.dir); },
  };
}
export type SealedStore = ReturnType<typeof createSealedStore>;

/** The Engine's archive calls as streams: the host's own, or the buffered calls adapted (a scripted Engine). */
export function streamsOf(http: DockerHttp): DockerStream {
  if (http.stream) return http.stream;
  return {
    async get(a) { const r = await http({ method: "GET", path: a.path, ...(a.query ? { query: a.query } : {}), ...(a.timeoutMs ? { timeoutMs: a.timeoutMs } : {}) }); return { status: r.status, body: Readable.from([Buffer.from(r.body)]) as never }; },
    async put(a) {
      const parts: Buffer[] = [];
      for await (const c of a.body) parts.push(Buffer.from(c as Uint8Array));
      return http({ method: "PUT", path: a.path, ...(a.query ? { query: a.query } : {}), body: Buffer.concat(parts), contentType: a.contentType, ...(a.timeoutMs ? { timeoutMs: a.timeoutMs } : {}) });
    },
  };
}

/**
 * Whether the start of a tar holds nothing but its root: an emptied profile reads as a tar of nothing (a root folder entry and the end blocks, at most 1,536 bytes). Only the first bytes are looked at.
 * `head` is what has been read so far and `done` says the stream ended.
 */
export function tarIsEmpty(head: Uint8Array, done: boolean): boolean | null {
  const entry = (at: number): "none" | "root" | "file" | "more" => {
    if (head.length < at + 512) return "more";
    const h = head.subarray(at, at + 512);
    if (h.every((b) => b === 0)) return "none";
    const name = new TextDecoder().decode(h.subarray(0, 100)).replace(/\0.*$/, "").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    const size = parseInt(new TextDecoder().decode(h.subarray(124, 136)).replace(/\0.*$/, "").trim() || "0", 8) || 0;
    return (name === "" || name === ".") && size === 0 ? "root" : "file";
  };
  const first = entry(0);
  if (first === "more") return done ? true : null;
  if (first === "none") return true;
  if (first === "file") return false;
  const second = entry(512);
  if (second === "more") return done ? true : null;
  return second === "none";
}

/** A source of tar bytes with its first bytes looked at: `empty` says whether it holds nothing but its root, and `bytes` yields everything again, the looked-at bytes first. */
export async function peekTar(body: AsyncIterable<Uint8Array>): Promise<{ empty: boolean; bytes: AsyncGenerator<Uint8Array> }> {
  const it = body[Symbol.asyncIterator]();
  const head: Buffer[] = [];
  let len = 0, done = false, empty: boolean | null = null;
  while (empty === null) {
    const r = await it.next();
    if (r.done) done = true; else { head.push(Buffer.from(r.value)); len += r.value.length; }
    empty = tarIsEmpty(Buffer.concat(head), done);
    if (done && empty === null) empty = true;
  }
  async function* bytes(): AsyncGenerator<Uint8Array> {
    for (const h of head) yield h;
    if (!done) { for (;;) { const r = await it.next(); if (r.done) return; yield r.value; } }
  }
  return { empty, bytes: bytes() };
}

export interface ProfileSealDeps {
  http: DockerHttp;
  /** The seal key as the daemon loaded it; throws or answers nothing when there is none. */
  key(): Uint8Array;
  dir: string;
  /** Container name of a computer. */
  container(computerId: string): string;
  image: string;
  user: { uid: number; gid: number };
  /** Engine calls take this long at most; a big profile takes a while to read and to write. */
  timeoutMs?: number;
  /** One thing at a time per computer; the host's lock, shared with start, stop and the migration read. Recovery takes it per computer. */
  lock?: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
  /** The most a profile may hold. Default SEAL_CAP_BYTES. */
  cap?: number;
}

/** The label a wipe helper carries and the one command it runs (host/src/sites-runner/computers-policy.ts allows exactly this; a test holds the two together). */
export const SEAL_HELPER = "seal-rm";
export const WIPE_SCRIPT = `chmod -R u+rwX ${PROFILE_GUEST} 2>/dev/null; find ${PROFILE_GUEST} -mindepth 1 -delete`;

/** The one lock per computer, shared by every host in this process (a rebound host takes the same one). */
export const computersLock = keyedLock();
/** The one lock per Space browser profile. */
export const browserLock = keyedLock();

export function createProfileSeal(d: ProfileSealDeps) {
  const timeoutMs = d.timeoutMs ?? 600_000;
  const cap = d.cap ?? SEAL_CAP_BYTES;
  const lock = d.lock ?? computersLock;
  const store = createSealedStore({ key: d.key, dir: d.dir, kind: "computers" });
  const streams = streamsOf(d.http);
  const looked = new Set<string>();

  /**
   * A throwaway container that empties the profile disk: the computer's own image on no network, sharing only that computer's volumes, with no capability and no new privileges, running one fixed command as
   * the computer's own user. It shares the volumes of the stopped computer container, so the runner behind a Team server can name its policy as exactly that. The command opens up folders the agent made
   * read-only before it deletes, so a locked folder cannot keep a profile from being emptied.
   */
  async function wipe(computerId: string): Promise<void> {
    const name = `${d.container(computerId)}-${SEAL_HELPER}`;
    await d.http({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } }).catch(() => undefined);
    const made = await d.http({
      method: "POST", path: "/containers/create", query: { name }, timeoutMs,
      json: {
        Image: d.image, Entrypoint: [], Labels: { "vyre.computer": computerId, "vyre.helper": SEAL_HELPER }, Cmd: ["sh", "-c", WIPE_SCRIPT], User: `${d.user.uid}:${d.user.gid}`, NetworkDisabled: true,
        HostConfig: { VolumesFrom: [d.container(computerId)], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false },
      },
    });
    if (made.status !== 201) throw new Error(`the wipe helper was not created (${made.status})`);
    try {
      const started = await d.http({ method: "POST", path: `/containers/${name}/start`, timeoutMs });
      if (started.status !== 204) throw new Error(`the wipe helper did not start (${started.status})`);
      const waited = await d.http({ method: "POST", path: `/containers/${name}/wait`, timeoutMs });
      const code = (JSON.parse(new TextDecoder().decode(waited.body)) as { StatusCode?: number }).StatusCode;
      if (code !== 0) throw new Error(`the profile volume was not emptied (exit ${code ?? "unknown"})`);
    } finally {
      await d.http({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } }).catch(() => undefined);
    }
  }

  /** "running" (also paused or restarting), "stopped" (exited or only created), or "gone". */
  async function status(computerId: string): Promise<"running" | "stopped" | "gone"> {
    const r = await d.http({ method: "GET", path: `/containers/${d.container(computerId)}/json`, timeoutMs: 30_000 });
    if (r.status === 404) return "gone";
    if (r.status !== 200) throw new Error(`the computer could not be looked at (${r.status})`);
    const s = (JSON.parse(new TextDecoder().decode(r.body)) as { State?: { Status?: string; Running?: boolean } }).State;
    return s?.Running === true || (s?.Status !== undefined && s.Status !== "exited" && s.Status !== "created" && s.Status !== "dead") ? "running" : "stopped";
  }

  const self = {
    state: (computerId: string): SealState => store.state(checkId("computers", computerId)),
    /** The computers whose profile is over the cap and stays plain (remembered across restarts). */
    oversize: (): string[] => store.oversize().map((x) => x.id),
    /**
     * The container must be stopped (it is looked at here, and a running or paused one is refused). The sealed file is written, flushed and renamed before the volume is touched. A profile that reads as empty
     * while its state is hot means the person cleared it: the old sealed file is dropped, it is not brought back. A profile over the cap is left as it is, plain, and reported. Answers what happened.
     */
    async seal(computerId: string): Promise<"sealed" | "empty" | "oversize" | "skipped"> {
      checkId("computers", computerId);
      const st = await status(computerId);
      if (st === "running") throw new Error("the computer is running, so its profile is not sealed");
      if (st === "gone") return "skipped";
      const s = store.state(computerId);
      if (s === "wiping") { await wipe(computerId); store.clearState(computerId); return "sealed"; }
      if (s === "sealed") return "skipped";
      if (s === "none") store.setState(computerId, "hot");   // before the file exists, so a crash after the save still reads as plain data to seal
      const r = await streams.get({ path: `/containers/${d.container(computerId)}/archive`, query: { path: `${PROFILE_GUEST}/.` }, timeoutMs });
      let empty = false;
      let bytes: AsyncGenerator<Uint8Array> | null = null;
      if (r.status === 404) { empty = true; for await (const _ of r.body as AsyncIterable<Uint8Array>) void _; }
      else if (r.status !== 200) { r.body.destroy(); throw new Error(`the profile could not be read (${r.status})`); }
      else { const p = await peekTar(r.body as AsyncIterable<Uint8Array>); empty = p.empty; bytes = p.bytes; if (empty) r.body.destroy(); }
      if (empty) { store.discard(computerId); return "empty"; }
      try { await store.saveFrom(computerId, bytes as AsyncGenerator<Uint8Array>, cap, true); }
      catch (e) {
        r.body.destroy();
        if (e instanceof TooLargeError) { store.setOversize(computerId, e.bytes); d.log?.("warn", "computers.profile.too_large", { computer: computerId, mb: Math.round(e.bytes / 1024 ** 2), capMb: Math.round(cap / 1024 ** 2) }); return "oversize"; }
        throw e;
      }
      store.clearOversize(computerId);
      store.setState(computerId, "wiping");
      await wipe(computerId);
      store.clearState(computerId);
      return "sealed";
    },
    /**
     * Before the container starts. The sealed file is read and every chunk checked first (a wrong key, a changed or cut file throws and nothing is touched); then the profile is put back with the state at
     * "wiping", so a restore that fails (a non-200, a timeout, a full disk) wipes the partial copy and leaves the good file the truth, never a broken profile. No sealed file is a computer that has never slept.
     */
    async unseal(computerId: string): Promise<void> {
      checkId("computers", computerId);
      const s = store.state(computerId);
      if (s === "hot") return;
      if (s === "wiping") { try { await wipe(computerId); } catch (e) { d.log?.("warn", "computers.profile.wipe_failed", { computer: computerId, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); } }
      if (!store.hasFile(computerId)) { store.setState(computerId, "hot"); return; }
      await store.verify(computerId);
      store.setState(computerId, "wiping");
      try {
        const r = await streams.put({ path: `/containers/${d.container(computerId)}/archive`, query: { path: PROFILE_GUEST }, contentType: "application/x-tar", body: Readable.from(store.open(computerId)), timeoutMs });
        if (r.status !== 200) throw new Error(`the profile could not be put back (${r.status})`);
      } catch (e) {
        await wipe(computerId).catch(() => undefined);
        throw e;
      }
      store.setState(computerId, "hot");
    },
    /**
     * At boot and then every minute: every computer that is not running is made safe, each under its own lock and each failure on its own. A finished sealed file with an unfinished wipe is wiped; a plain
     * profile left by a crash or by a container that died (hot) is sealed; a computer made before sealing existed (no file, no state) is sealed if its volume holds anything, looked at once per start. Answers
     * the computers it sealed.
     */
    async recoverStopped(): Promise<string[]> {
      const list = await d.http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ label: ["vyre.computer"] }) } });
      if (list.status !== 200) throw new Error(`the computers could not be listed (${list.status})`);
      const rows = JSON.parse(new TextDecoder().decode(list.body)) as { State?: string; Labels?: Record<string, string> }[];
      const sealed: string[] = [];
      for (const r of rows) {
        const id = r.Labels?.["vyre.computer"];
        if (!id || r.State === "running" || r.State === "restarting" || r.State === "paused" || r.Labels?.["vyre.helper"]) continue;
        if (store.oversize().some((x) => x.id === id)) continue;   // left plain and reported; the next sleep looks again, a timer does not read a gigabyte every minute
        try {
          await lock(checkId("computers", id), async () => {
            const s = store.state(id);
            if (s === "sealed" || (s === "none" && looked.has(id))) return;
            if (s === "none") looked.add(id);
            const out = await self.seal(id);
            if (out === "sealed") sealed.push(id);
          });
        } catch (e) { d.log?.("warn", "computers.profile.recover_failed", { computer: id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); }
      }
      return sealed;
    },
    /** The computer is removed: its sealed profile goes with it. */
    async discard(computerId: string): Promise<void> { store.discard(computerId); },
  };
  return self;
}
