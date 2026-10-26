// The disk side of the agent's home, seen only from inside the computer's container. The folder bound at ~/Vyre is controlled by the computer: a program in it can make a symlink from any folder to any
// path. So the daemon never opens a path of that folder on the host. Every read, write and removal goes through Docker, which resolves the path inside the container's own root: a link can only point at
// something the container already has, never at the host.
//   read    GET  /containers/<id>/archive?path=~/Vyre/.   (a tar of the whole home, works on a stopped container)
//   write   PUT  /containers/<id>/archive?path=~/Vyre     (a tar of the files to put, owned by the agent's user; read-only files owned by root, mode 0444)
//   remove  a throwaway container that shares the computer's mounts (VolumesFrom) runs rm and rmdir on named paths, as the agent's user, with no network and no capability
// Reading never follows a link: the tar says what each entry is, and a symlink, a hardlink, a device or a fifo is refused and named.
import { tarFiles } from "../../../sandbox/src/tar.ts";
import type { DockerHttp } from "../../../sandbox/src/docker.ts";

export const GUEST_HOME = "/home/agent/Vyre";
/** A home bigger than this is not mirrored in one pass: the pass says so and leaves it alone. */
const MAX_SNAPSHOT = 256 * 1024 * 1024;
/** A file bigger than Files accepts (25 MB) stays on the computer only. */
export const MAX_MIRROR_FILE = 25 * 1024 * 1024;

export interface DiskFile { bytes: Buffer; mtimeMs: number }
export interface DiskSnapshot { files: Map<string, DiskFile>; dirs: Set<string>; refused: string[]; complete: boolean }

export interface HomeFs {
  snapshot(): Promise<DiskSnapshot>;
  put(files: Array<{ rel: string; bytes: Uint8Array; readOnly: boolean }>): Promise<void>;
  remove(files: string[], dirs: string[]): Promise<void>;
}

const dec = new TextDecoder();
const field = (h: Uint8Array, at: number, len: number): string => dec.decode(h.subarray(at, at + len)).replace(/\0.*$/s, "");
const octal = (h: Uint8Array, at: number, len: number): number => parseInt(field(h, at, len).trim() || "0", 8) || 0;

/** The pax records of an extended header: "<len> key=value\n" repeated. */
function paxRecords(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const text = Buffer.from(data).toString("utf8");
  for (let at = 0; at < text.length;) {
    const sp = text.indexOf(" ", at);
    if (sp < 0) break;
    const len = parseInt(text.slice(at, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = text.slice(sp + 1, at + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    at += len;
  }
  return out;
}

/** Normalise an entry name to a path under the home: no leading ./, no trailing /, and null for anything absolute or climbing. */
export function relOf(name: string): string | null {
  const parts = name.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.includes("..") || name.startsWith("/")) return null;
  return parts.join("/");
}

/** What a tar from the Docker archive API holds. Reads headers only as far as they describe plain files and folders; anything else is refused by name. */
export function readTar(tar: Uint8Array): DiskSnapshot {
  const snap: DiskSnapshot = { files: new Map(), dirs: new Set(), refused: [], complete: true };
  let pendingName: string | null = null;
  let pax: Record<string, string> = {};
  for (let at = 0; at + 512 <= tar.length;) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const type = String.fromCharCode(h[156] ?? 48);
    let size = octal(h, 124, 12);
    if (pax["size"] !== undefined) size = Number(pax["size"]) || size;
    const data = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x" || type === "g") { if (type === "x") pax = { ...pax, ...paxRecords(data) }; continue; }
    if (type === "L") { pendingName = field(data, 0, data.length); continue; }
    const ustar = field(h, 257, 5) === "ustar";
    const prefix = ustar ? field(h, 345, 155) : "";
    const raw = pax["path"] ?? pendingName ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    const mtime = Number(pax["mtime"] ?? octal(h, 136, 12)) * 1000;
    pendingName = null; pax = {};
    const rel = relOf(raw);
    if (rel === null) { snap.refused.push(raw); continue; }
    if (rel === "") continue;
    if (type === "5") { snap.dirs.add(rel); continue; }
    if (type === "0" || type === "\0") {
      if (size > MAX_MIRROR_FILE) { snap.refused.push(rel); continue; }
      snap.files.set(rel, { bytes: Buffer.from(data), mtimeMs: mtime });
      continue;
    }
    snap.refused.push(rel);   // a symlink (2), hardlink (1), device (3, 4), fifo (6) or anything else
  }
  return snap;
}

export function createContainerHomeFs(d: { http: DockerHttp; container: string; image: string; user: { uid: number; gid: number }; timeoutMs?: number }): HomeFs {
  const timeoutMs = d.timeoutMs ?? 120_000;
  const dir = (rel: string): string => `${GUEST_HOME}/${rel}`;

  return {
    async snapshot() {
      const r = await d.http({ method: "GET", path: `/containers/${d.container}/archive`, query: { path: `${GUEST_HOME}/.` }, timeoutMs });
      if (r.status === 404) return { files: new Map(), dirs: new Set(), refused: [], complete: true };
      if (r.status !== 200) throw new Error(`the home could not be read (${r.status})`);
      if (r.body.length > MAX_SNAPSHOT) return { files: new Map(), dirs: new Set(), refused: [], complete: false };
      return readTar(r.body);
    },
    async put(files) {
      if (files.length === 0) return;
      const at = Math.floor(Date.now() / 1000);
      const tar = tarFiles(files.map((f) => ({ path: f.rel, data: f.bytes, mode: f.readOnly ? 0o444 : 0o644, uid: f.readOnly ? 0 : d.user.uid, gid: f.readOnly ? 0 : d.user.gid, mtime: at })));
      const r = await d.http({ method: "PUT", path: `/containers/${d.container}/archive`, query: { path: GUEST_HOME }, body: tar, contentType: "application/x-tar", timeoutMs });
      if (r.status !== 200) throw new Error(`the home could not be written (${r.status})`);
    },
    async remove(files, dirs) {
      if (files.length === 0 && dirs.length === 0) return;
      const name = `${d.container}-home-rm`;
      await d.http({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } }).catch(() => undefined);
      const script = 'mode=f; for p in "$@"; do if [ "$p" = "::" ]; then mode=d; continue; fi; if [ "$mode" = f ]; then rm -f -- "$p"; else rmdir -- "$p" 2>/dev/null; fi; done; true';
      const made = await d.http({
        method: "POST", path: "/containers/create", query: { name }, timeoutMs,
        json: {
          Image: d.image, Entrypoint: [], Cmd: ["sh", "-c", script, "sh", ...files.map(dir), "::", ...dirs.map(dir)], User: `${d.user.uid}:${d.user.gid}`, NetworkDisabled: true,
          HostConfig: { VolumesFrom: [d.container], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], NetworkMode: "none", Privileged: false, AutoRemove: false },
        },
      });
      if (made.status !== 201) throw new Error(`the removal helper was not created (${made.status})`);
      try {
        const started = await d.http({ method: "POST", path: `/containers/${name}/start`, timeoutMs });
        if (started.status !== 204) throw new Error(`the removal helper did not start (${started.status})`);
        await d.http({ method: "POST", path: `/containers/${name}/wait`, timeoutMs });
      } finally {
        await d.http({ method: "DELETE", path: `/containers/${name}`, query: { force: "true" } }).catch(() => undefined);
      }
    },
  };
}
