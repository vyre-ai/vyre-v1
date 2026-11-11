// The profile disk of an agent computer, and the Chrome profile of an agent in the Space browser, at rest (ARCH 6.6, V1-SPEC 2.7). While nothing runs on it, a browser profile (cookies, saved sign-ins,
// local storage, history) is not on the Docker volume: it is read out as a tar, sealed in 8 MB AES-256-GCM chunks under a key made for this one profile, written to the Space's data folder, and the
// volume is emptied. When the browser is needed again the tar is opened and put back first. A copied volume or a copy of Docker's own data holds nothing readable.
//
// File format: one JSON line per chunk, a Box {iv, ct, tag}. The additional data names the kind, the profile, the chunk number and whether it is the last one, so a cut, a swap, a splice of two files or a
// file moved to another profile fails to open. A profile also has a small state file next to it, because "the volume still holds the plain profile" must survive a crash:
//   none    no sealed file, no state file: a profile that never slept, or one made before sealing existed (its plain profile is sealed at its first sleep, or at the next boot).
//   sealed  a sealed file and no state file: the sealed file is the profile and the volume holds nothing.
//   hot     the plain profile is the truth (unsealed or in use). A boot seals every hot profile that is not running.
//   wiping  the sealed file is complete and written; only the volume still has to be emptied. A boot finishes the wipe and never reads the volume again, so a half-emptied volume cannot replace the file.
// The previous sealed file is kept as <id>.profile.prev for one generation, so a profile that was wrongly empty at a seal never destroys the last good copy.
import fs from "node:fs";
import path from "node:path";
import { aesUnwrap, aesWrap, hkdf32 } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";
import type { DockerHttp } from "../../../sandbox/src/docker.ts";

export const PROFILE_GUEST = "/home/agent/.profile-disk";
export const CHUNK = 8 * 1024 * 1024;
const FILE_SUFFIX = ".profile";

export type SealKind = "computers" | "sbrowser";
export type SealState = "none" | "sealed" | "hot" | "wiping";

const aadOf = (kind: SealKind, id: string, i: number, last: boolean): string => `vyre:${kind}:profile:v1|${id}|${i}|${last ? 1 : 0}`;
const keyOf = (key: Uint8Array, kind: SealKind, id: string): Buffer => hkdf32(key, `vyre:${kind}:profile:v1`, id);
const safe = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_");

/** The sealed form of a tar, one line (a Box as JSON, newline included) per chunk. Lines are made one at a time, so a large profile never becomes one string. */
export function* sealLines(plain: Uint8Array, key: Uint8Array, kind: SealKind, id: string): Generator<string> {
  const n = Math.max(1, Math.ceil(plain.length / CHUNK));
  const k = keyOf(key, kind, id);
  for (let i = 0; i < n; i++) yield `${JSON.stringify(aesWrap(k, plain.subarray(i * CHUNK, (i + 1) * CHUNK), aadOf(kind, id, i, i === n - 1)))}\n`;
}

export const sealBytes = (plain: Uint8Array, key: Uint8Array, kind: SealKind, id: string): Buffer => Buffer.from([...sealLines(plain, key, kind, id)].join(""));

/** Throws when the key, the kind, the profile or the order is wrong, or the file was cut or changed. */
export function openBytes(sealed: Buffer, key: Uint8Array, kind: SealKind, id: string): Buffer {
  const k = keyOf(key, kind, id);
  const lines: Buffer[] = [];
  for (let at = 0; at < sealed.length;) {
    let end = sealed.indexOf(10, at);
    if (end < 0) end = sealed.length;
    if (end > at) lines.push(sealed.subarray(at, end));
    at = end + 1;
  }
  if (lines.length === 0) throw new Error("the sealed profile is empty");
  return Buffer.concat(lines.map((l, i) => Buffer.from(aesUnwrap(k, JSON.parse(l.toString("utf8")) as Box, aadOf(kind, id, i, i === lines.length - 1)))));
}

/** How many files and folders a tar holds besides its own root: an emptied profile reads as a tar of nothing. */
export function tarEntries(tar: Uint8Array): number {
  let n = 0;
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const name = new TextDecoder().decode(head.subarray(0, 100)).replace(/\0.*$/, "");
    const size = parseInt(new TextDecoder().decode(head.subarray(124, 136)).replace(/\0.*$/, "").trim() || "0", 8) || 0;
    if (name.replace(/^(\.\/)+/, "").replace(/\/+$/, "") !== "" && name !== ".") n++;
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return n;
}

export const UNOPENED = "the sealed profile did not open: it was changed, cut short or sealed under another key. Nothing was started and the sealed data was not touched.";

export interface SealedStoreDeps {
  /** The key the sealed files are made under (32 bytes or more); read at each use, never kept. This one function is where the key is chosen. */
  key(): Uint8Array;
  /** The folder the sealed files and state files live in. */
  dir: string;
  kind: SealKind;
}

/** Where a profile's sealed file and state live, and how they are written. Nothing here knows about Docker. */
export function createSealedStore(d: SealedStoreDeps) {
  const file = (id: string): string => path.join(d.dir, `${safe(id)}${FILE_SUFFIX}`);
  const mark = (id: string): string => `${file(id)}.state`;
  const writeSync = (to: string, data: Buffer | string[]): void => {
    fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 });
    const tmp = `${to}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try { for (const part of Array.isArray(data) ? data : [data]) fs.writeSync(fd, part); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, to);
  };
  return {
    file,
    state(id: string): SealState {
      try { const t = fs.readFileSync(mark(id), "utf8").trim(); if (t === "hot" || t === "wiping") return t; } catch { /* no state file */ }
      return fs.existsSync(file(id)) ? "sealed" : "none";
    },
    setState(id: string, s: "hot" | "wiping"): void { writeSync(mark(id), s); },
    clearState(id: string): void { fs.rmSync(mark(id), { force: true }); },
    hasFile(id: string): boolean { return fs.existsSync(file(id)); },
    /** Seal the tar and make it the profile's file, atomically; the file it replaces becomes `.prev`. */
    save(id: string, tar: Uint8Array): void {
      const k = d.key();
      const f = file(id);
      fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 });
      const tmp = `${f}.tmp`;
      const fd = fs.openSync(tmp, "w", 0o600);
      try { for (const line of sealLines(tar, k, d.kind, id)) fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fs.existsSync(f)) fs.renameSync(f, `${f}.prev`);
      fs.renameSync(tmp, f);
    },
    /** The profile's tar. Null when there is no file. Throws UNOPENED (nothing touched) when it does not open. */
    load(id: string): Buffer | null {
      const f = file(id);
      if (!fs.existsSync(f)) return null;
      try { return openBytes(fs.readFileSync(f), d.key(), d.kind, id); } catch { throw new Error(UNOPENED); }
    },
    discard(id: string): void { for (const p of [file(id), `${file(id)}.prev`, `${file(id)}.tmp`, mark(id), `${mark(id)}.tmp`]) fs.rmSync(p, { force: true }); },
  };
}
export type SealedStore = ReturnType<typeof createSealedStore>;

export interface ProfileSealDeps {
  http: DockerHttp;
  key(): Uint8Array;
  dir: string;
  /** Container and volume names of a computer. */
  container(computerId: string): string;
  image: string;
  user: { uid: number; gid: number };
  /** Engine calls take this long at most; a big profile takes a while to read and to write. */
  timeoutMs?: number;
}

/** The label and name a wipe helper carries (host/src/sites-runner/computers-policy.ts allows exactly this one). */
export const SEAL_HELPER = "seal-rm";
export const WIPE_CMD: readonly string[] = ["find", PROFILE_GUEST, "-mindepth", "1", "-delete"];

export function createProfileSeal(d: ProfileSealDeps) {
  const timeoutMs = d.timeoutMs ?? 600_000;
  const store = createSealedStore({ key: d.key, dir: d.dir, kind: "computers" });

  /**
   * A throwaway container that empties the profile disk: the computer's own image on no network, sharing only that computer's volumes, with no capability and no new privileges, running one fixed command.
   * It shares the volumes of the stopped computer container, so the runner behind a Team server can name its policy as exactly that.
   */
  async function wipe(computerId: string): Promise<void> {
    const name = `${d.container(computerId)}-${SEAL_HELPER}`;
    await d.http({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } }).catch(() => undefined);
    const made = await d.http({
      method: "POST", path: "/containers/create", query: { name }, timeoutMs,
      json: {
        Image: d.image, Entrypoint: [], Labels: { "vyre.computer": computerId, "vyre.helper": SEAL_HELPER }, Cmd: [...WIPE_CMD], User: `${d.user.uid}:${d.user.gid}`, NetworkDisabled: true,
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

  async function read(computerId: string): Promise<Uint8Array | null> {
    const r = await d.http({ method: "GET", path: `/containers/${d.container(computerId)}/archive`, query: { path: `${PROFILE_GUEST}/.` }, timeoutMs });
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`the profile could not be read (${r.status})`);
    return r.body;
  }

  const self = {
    state: (computerId: string): SealState => store.state(computerId),
    /**
     * The container must be stopped. The sealed file is written and flushed before the volume is touched, and a profile that reads as empty never replaces a sealed file that has data and makes none (a computer woken and put to
     * sleep with nothing on the volume keeps what it had).
     */
    async seal(computerId: string): Promise<boolean> {
      if (store.state(computerId) === "wiping") { await wipe(computerId); store.clearState(computerId); return true; }
      const tar = await read(computerId);
      if (tar === null || tarEntries(tar) === 0) { store.clearState(computerId); return false; }
      store.save(computerId, tar);
      store.setState(computerId, "wiping");
      await wipe(computerId);
      store.clearState(computerId);
      return true;
    },
    /**
     * Before the container starts. The sealed file is opened first (a wrong key, a changed or cut file throws and nothing is touched), then the profile is marked as plain, then it is put back. No sealed file
     * is a computer that has never slept: it only gets the mark.
     */
    async unseal(computerId: string): Promise<void> {
      let s = store.state(computerId);
      if (s === "wiping") { await wipe(computerId); store.clearState(computerId); s = "sealed"; }
      if (s === "hot") return;
      const tar = store.load(computerId);
      store.setState(computerId, "hot");
      if (tar === null || tarEntries(tar) === 0) return;
      const r = await d.http({ method: "PUT", path: `/containers/${d.container(computerId)}/archive`, query: { path: PROFILE_GUEST }, body: tar, contentType: "application/x-tar", timeoutMs });
      if (r.status !== 200) throw new Error(`the profile could not be put back (${r.status})`);
    },
    /**
     * At boot: every computer that is not running is made safe. A finished sealed file with an unfinished wipe is wiped; a plain profile left by a crash (hot) is sealed now, so it never waits for the next wake;
     * a computer made before sealing existed (no file, no state) is sealed if its volume holds anything. A volume that is empty is left alone, so a clean sleep's sealed file is never replaced. Answers the
     * computers it sealed.
     */
    async recoverStopped(): Promise<string[]> {
      const list = await d.http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ label: ["vyre.computer"] }) } });
      if (list.status !== 200) throw new Error(`the computers could not be listed (${list.status})`);
      const rows = JSON.parse(new TextDecoder().decode(list.body)) as { State?: string; Labels?: Record<string, string> }[];
      const sealed: string[] = [];
      for (const r of rows) {
        const id = r.Labels?.["vyre.computer"];
        if (!id || r.State === "running" || r.State === "restarting" || r.State === "paused" || r.Labels?.["vyre.helper"]) continue;
        const s = store.state(id);
        if (s === "sealed") continue;
        if (s === "none") { const arc = await read(id); if (arc === null || tarEntries(arc) === 0) continue; }
        if (await self.seal(id)) sealed.push(id);
      }
      return sealed;
    },
    /** The computer is removed: its sealed profile goes with it. */
    async discard(computerId: string): Promise<void> { store.discard(computerId); },
  };
  return self;
}
