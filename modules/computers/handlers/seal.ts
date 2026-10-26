// The profile disk of an agent computer at rest (ARCH 6.6): while a computer sleeps its browser profile (cookies, saved logins, history) is not on the Docker volume. At sleep the stopped container's
// profile folder is read as a tar through the Engine archive API, sealed in 8 MB AES-256-GCM chunks under a key derived for this computer, written to the Space's data folder, and the volume is wiped
// by a one-shot helper container with no network and no capability. At wake the tar is opened and put back before the container starts. A copied volume or a Docker data folder alone holds nothing.
// File format: one JSON line per chunk, a Box {iv, ct, tag}; the AAD names the computer, the chunk number and whether it is the last one, so a cut, a swap or a splice of two files fails to open.
import fs from "node:fs";
import path from "node:path";
import { aesUnwrap, aesWrap, hkdf32 } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";
import type { DockerHttp } from "../../../sandbox/src/docker.ts";

export const PROFILE_GUEST = "/home/agent/.profile-disk";
const CHUNK = 8 * 1024 * 1024;
const FILE_SUFFIX = ".profile";

export interface ProfileSealDeps {
  http: DockerHttp;
  /** The node key for computer profiles (32 bytes); read at each use, never kept. */
  key(): Uint8Array;
  /** The folder the sealed files live in. */
  dir: string;
  /** Container and volume names of a computer. */
  container(computerId: string): string;
  volume(computerId: string): string;
  image: string;
  user: { uid: number; gid: number };
  /** Engine calls take this long at most; a big profile takes a while to read and to write. */
  timeoutMs?: number;
}

const aadOf = (computerId: string, i: number, last: boolean): string => `vyre:computers:profile:v1|${computerId}|${i}|${last ? 1 : 0}`;
const keyOf = (d: ProfileSealDeps, computerId: string): Buffer => hkdf32(d.key(), "vyre:computers:profile:v1", computerId);
const fileOf = (d: ProfileSealDeps, computerId: string): string => path.join(d.dir, `${computerId.replace(/[^A-Za-z0-9_-]/g, "_")}${FILE_SUFFIX}`);

/** The sealed form of a tar: JSON lines, one Box per chunk. */
export function sealBytes(plain: Uint8Array, key: Uint8Array, computerId: string): string {
  const n = Math.max(1, Math.ceil(plain.length / CHUNK));
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(JSON.stringify(aesWrap(key, plain.subarray(i * CHUNK, (i + 1) * CHUNK), aadOf(computerId, i, i === n - 1))));
  return `${lines.join("\n")}\n`;
}

/** Throws when the key, the computer or the order is wrong, or the file was cut. */
export function openBytes(sealed: string, key: Uint8Array, computerId: string): Buffer {
  const lines = sealed.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("the sealed profile is empty");
  return Buffer.concat(lines.map((l, i) => Buffer.from(aesUnwrap(key, JSON.parse(l) as Box, aadOf(computerId, i, i === lines.length - 1)))));
}

/** How many files and folders a tar holds besides its own root: an emptied profile volume reads as a tar of nothing. */
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

export function createProfileSeal(d: ProfileSealDeps) {
  const timeoutMs = d.timeoutMs ?? 600_000;

  /** A throwaway container that empties the volume: no network, no capability, no new privileges, nothing but the volume. */
  async function wipe(computerId: string): Promise<void> {
    const name = `${d.container(computerId)}-wipe`;
    await d.http({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } }).catch(() => undefined);
    const made = await d.http({
      method: "POST", path: "/containers/create", query: { name }, timeoutMs,
      json: {
        Image: d.image, Entrypoint: [], Cmd: ["find", "/p", "-mindepth", "1", "-delete"], User: `${d.user.uid}:${d.user.gid}`, NetworkDisabled: true,
        HostConfig: { Binds: [`${d.volume(computerId)}:/p:rw`], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false },
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

  return {
    /** The container must be stopped. The sealed file is written and flushed before the volume is touched. */
    async seal(computerId: string): Promise<void> {
      const r = await d.http({ method: "GET", path: `/containers/${d.container(computerId)}/archive`, query: { path: `${PROFILE_GUEST}/.` }, timeoutMs });
      if (r.status !== 200) throw new Error(`the profile could not be read (${r.status})`);
      const text = sealBytes(r.body, keyOf(d, computerId), computerId);
      fs.mkdirSync(d.dir, { recursive: true, mode: 0o700 });
      const file = fileOf(d, computerId), tmp = `${file}.tmp`;
      const fd = fs.openSync(tmp, "w", 0o600);
      try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
      await wipe(computerId);
    },
    /** Before the container starts. No sealed file means a computer that has never slept: nothing to put back. */
    async unseal(computerId: string): Promise<void> {
      const file = fileOf(d, computerId);
      if (!fs.existsSync(file)) return;
      let tar: Buffer;
      try { tar = openBytes(fs.readFileSync(file, "utf8"), keyOf(d, computerId), computerId); } catch { throw new Error("the sealed profile did not open: it was changed, cut short or sealed under another key. The computer was not started."); }
      const r = await d.http({ method: "PUT", path: `/containers/${d.container(computerId)}/archive`, query: { path: PROFILE_GUEST }, body: tar, contentType: "application/x-tar", timeoutMs });
      if (r.status !== 200) throw new Error(`the profile could not be put back (${r.status})`);
    },
    /**
     * At boot: a computer whose container is not running but whose volume still holds a profile (the daemon died between unseal and seal) is sealed now, so plaintext never waits for the next wake. A volume
     * that is already empty is left alone, so a clean sleep's sealed file is never replaced by an empty one. Answers the computers it sealed.
     */
    async recoverStopped(): Promise<string[]> {
      const list = await d.http({ method: "GET", path: "/containers/json", query: { all: "true", filters: JSON.stringify({ label: ["vyre.computer"] }) } });
      if (list.status !== 200) throw new Error(`the computers could not be listed (${list.status})`);
      const rows = JSON.parse(new TextDecoder().decode(list.body)) as { State?: string; Labels?: Record<string, string> }[];
      const sealed: string[] = [];
      for (const r of rows) {
        const id = r.Labels?.["vyre.computer"];
        if (!id || r.State === "running" || r.State === "restarting" || r.State === "paused") continue;
        const arc = await d.http({ method: "GET", path: `/containers/${d.container(id)}/archive`, query: { path: `${PROFILE_GUEST}/.` }, timeoutMs });
        if (arc.status !== 200 || tarEntries(arc.body) === 0) continue;
        await this.seal(id);
        sealed.push(id);
      }
      return sealed;
    },
    /** The computer is removed: its sealed profile goes with it. */
    async discard(computerId: string): Promise<void> {
      fs.rmSync(fileOf(d, computerId), { force: true });
    },
  };
}
