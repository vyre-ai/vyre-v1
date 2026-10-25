// Credential files for the sandboxes that run on a person's own machine (S8): the CLI's sign-in files come from the Mine vault at session start, live in a directory that is RAM (a tmpfs the
// caller names: /dev/shm or /run/user/<uid> on Linux, a RAM disk on a Mac), are readable by the person only, and are overwritten and removed when the session ends. The Docker sandbox does not use
// this: it puts them into the container's own tmpfs and they are gone with the container.
import { SandboxError } from "./types.ts";
import type { CredentialFile } from "./types.ts";

export interface DirEntry { name: string; dir: boolean }

/** The few file operations the store needs, so a test can watch every one. Nothing here follows a link. */
export interface CredFs {
  mkdir(path: string, mode: number): Promise<void>;
  /** Create a file that must not exist (O_EXCL) and must not be a link, with this mode. */
  writeNew(path: string, data: Uint8Array, mode: number): Promise<void>;
  /** Write over the bytes of an existing file, in place, and flush them. */
  overwrite(path: string, data: Uint8Array): Promise<void>;
  /** Size of a file, or null if it is gone. */
  size(path: string): Promise<number | null>;
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
}

const SESSION = /^[a-z0-9][a-z0-9-]{2,63}$/;

export interface CredentialStore {
  /** Write the files for a session and return where they are. */
  put(sessionId: string, files: readonly CredentialFile[]): Promise<{ dir: string; paths: string[] }>;
  /** Overwrite and remove everything of a session. Throws, after trying everything, if anything is left. Safe to call twice. */
  shred(sessionId: string): Promise<{ files: number }>;
  /** At start-up: shred whatever an earlier run left (a crash). */
  shredAll(): Promise<{ sessions: number; files: number }>;
}

export interface CredentialStoreOptions {
  /** A directory on RAM, owned by the person, mode 0700. */
  root: string;
  random?: (n: number) => Uint8Array;
}

export function createCredentialStore(fs: CredFs, o: CredentialStoreOptions): CredentialStore {
  const random = o.random ?? ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const root = o.root.replace(/\/+$/, "");
  if (!root.startsWith("/")) throw new SandboxError("sandbox.policy", "the credential directory must be an absolute path");

  const safeRel = (p: string): string[] => {
    if (p === "" || p.startsWith("/") || p.includes("\0")) throw new SandboxError("sandbox.policy", `not a relative path: ${JSON.stringify(p).slice(0, 60)}`);
    const segs = p.split("/");
    if (segs.some((s) => s === "" || s === "." || s === "..")) throw new SandboxError("sandbox.policy", `a credential path may not climb or repeat: ${p.slice(0, 60)}`);
    return segs;
  };

  async function overwriteAll(path: string): Promise<void> {
    const n = await fs.size(path);
    if (n === null || n === 0) return;
    // Random, then zeros: nothing of the content is left in the blocks that held it.
    await fs.overwrite(path, random(n));
    await fs.overwrite(path, new Uint8Array(n));
  }

  /** Remove a directory tree, each folder's files before the folder. Returns the number of files removed; `failed` collects the files that could not be. */
  async function remove(dir: string, failed: string[]): Promise<number> {
    let files = 0;
    let entries: DirEntry[];
    try { entries = await fs.list(dir); } catch { return 0; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.dir) { files += await remove(p, failed); continue; }
      try { await overwriteAll(p); await fs.unlink(p); files++; } catch { failed.push(p); }
    }
    try { await fs.rmdir(dir); } catch { /* a folder that still holds a file we could not remove: the caller sees the file */ }
    return files;
  }

  return {
    async put(sessionId, files) {
      if (!SESSION.test(sessionId)) throw new SandboxError("sandbox.policy", "not a session id");
      if (!(await fs.exists(root))) await fs.mkdir(root, 0o700);
      const dir = `${root}/${sessionId}`;
      await fs.mkdir(dir, 0o700);
      const made = new Set<string>();
      const paths: string[] = [];
      try {
        for (const f of files) {
          const segs = safeRel(f.path);
          for (let i = 1; i < segs.length; i++) {
            const d = `${dir}/${segs.slice(0, i).join("/")}`;
            if (!made.has(d)) { made.add(d); await fs.mkdir(d, 0o700); }
          }
          const full = `${dir}/${f.path}`;
          await fs.writeNew(full, f.data, 0o600);
          paths.push(full);
        }
      } catch (e) {
        // A half-written set is worse than none: take back what was written.
        await remove(dir, []);
        throw e;
      }
      return { dir, paths };
    },
    async shred(sessionId) {
      if (!SESSION.test(sessionId)) throw new SandboxError("sandbox.policy", "not a session id");
      const dir = `${root}/${sessionId}`;
      if (!(await fs.exists(dir))) return { files: 0 };
      const failed: string[] = [];
      const files = await remove(dir, failed);
      if (failed.length > 0) throw new SandboxError("sandbox.shred", `${failed.length} credential file(s) could not be removed`);
      if (await fs.exists(dir)) throw new SandboxError("sandbox.shred", "the credential folder could not be removed");
      return { files };
    },
    async shredAll() {
      if (!(await fs.exists(root))) return { sessions: 0, files: 0 };
      let sessions = 0;
      let files = 0;
      const failed: string[] = [];
      for (const e of await fs.list(root)) {
        if (!e.dir) { try { await overwriteAll(`${root}/${e.name}`); await fs.unlink(`${root}/${e.name}`); files++; } catch { failed.push(e.name); } continue; }
        sessions++;
        files += await remove(`${root}/${e.name}`, failed);
      }
      if (failed.length > 0) throw new SandboxError("sandbox.shred", `${failed.length} leftover credential file(s) could not be removed`);
      return { sessions, files };
    },
  };
}

/** The real thing, on node:fs. Created with O_EXCL and O_NOFOLLOW; never follows a link; flushes after every overwrite. */
export async function nodeCredFs(): Promise<CredFs> {
  const fsp = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  const nofollow = constants.O_NOFOLLOW ?? 0;
  return {
    mkdir: async (p, mode) => { await fsp.mkdir(p, { mode }); await fsp.chmod(p, mode); },
    async writeNew(p, data, mode) {
      const fh = await fsp.open(p, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, mode);
      try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
      await fsp.chmod(p, mode);
    },
    async overwrite(p, data) {
      const fh = await fsp.open(p, constants.O_WRONLY | nofollow);
      try { await fh.write(data, 0, data.length, 0); await fh.sync(); } finally { await fh.close(); }
    },
    async size(p) { try { const s = await fsp.lstat(p); return s.isFile() ? s.size : 0; } catch { return null; } },
    unlink: (p) => fsp.unlink(p),
    rmdir: (p) => fsp.rmdir(p),
    async list(p) { return (await fsp.readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() })); },
    async exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } },
  };
}
