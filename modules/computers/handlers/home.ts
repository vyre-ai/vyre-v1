// The agent's home on its computer (ruling 98): the Files module is the one source of truth, and the daemon mirrors the agent's folder (Agents/<name>) onto the folder bound at ~/Vyre. Every call to
// Files runs as the agent principal, never as the host, so access (what the agent may read or write), the review rules, versions, the lint and the Vault scrubber apply exactly as for any other writer.
// A file the agent may not read is not listed, so it is not on the computer, and a file whose access is taken away leaves the computer at the next pass.
//
// Each pass compares three things: what Files has (files.list), what the disk has (lstat, never following a link) and what the last pass left (the manifest: path, file id, version, sha256 of the content).
//   only the disk changed      -> files.write as the agent (a new version, "edited on the computer")
//   only Files changed         -> the new content is written to the disk
//   both changed               -> Files keeps the original path; the computer's version is saved beside it as "name (from computer).ext" and the agent's owner gets a task, so it is never silent
//   AGENT.md, agent.toml       -> read-only on the computer: an edit there is put back and becomes an agent suggestion for review
//   a symlink, a hardlink, a device, a socket, or a path that leaves the folder -> never read, never sent; the pass names it and leaves it alone
// A file over the direct-write size goes through the upload path (files.upload_url, then the bytes to its url). Files are mirrored whole, not streamed; the pass skips a file written in the last second so a
// half-written file is not sent, and Chromium's partial downloads (.crdownload) wait until they are renamed.
import fs from "node:fs";
import path from "node:path";
import { sha256b64 } from "../../../kernel/src/seal/index.ts";

export const MAX_DIRECT = 256 * 1024;
const READ_CHUNK = 1024 * 1024;
export const READ_ONLY = new Set(["AGENT.md", "agent.toml"]);
const SETTLE_MS = 1000;
const MAX_NAME = 255;
const MAX_FILES = 5000;
const SKIP = /\.(crdownload|part|tmp)$/i;

export interface HomeDeps {
  /** One call to a Files, agents or tasks capability as the agent principal. Throws on a refusal. */
  callAs(agentId: string, cap: string, input: unknown): Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Send bytes to an upload url from files.upload_url. */
  putBytes(url: string, bytes: Uint8Array): Promise<void>;
  now(): number;
  log(level: "info" | "warn", msg: string, attrs?: Record<string, unknown>): void;
}

interface ManifestEntry { fileId: string; version: number; sha: string }
interface Manifest { files: Record<string, ManifestEntry>; folders: Record<string, string> }
interface RemoteFile { fileId: string; name: string; folderId: string; version: number; size: number; path: string }
interface LocalFile { rel: string; abs: string; size: number; mtimeMs: number }

export interface HomeSync {
  /** One pass; passes of one home never overlap. Answers what it did. */
  pass(): Promise<HomeReport>;
}
export interface HomeReport { down: number; up: number; conflicts: number; removed: number; refused: string[]; suggested: number }

const emptyManifest = (): Manifest => ({ files: {}, folders: {} });

function cleanName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME && name !== "." && name !== ".." && !/[\0/\\]/.test(name);
}
const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/** "notes.txt" -> "notes (from computer).txt"; a name with no extension just gets the suffix. */
export function conflictName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (from computer)${name.slice(dot)}` : `${name} (from computer)`;
}

export function createHomeSync(o: { agentId: string; computerId: string; home: string; manifest: string }, d: HomeDeps): HomeSync {
  let running: Promise<HomeReport> | null = null;

  function load(): Manifest {
    try { const m = JSON.parse(fs.readFileSync(o.manifest, "utf8")) as Manifest; if (m && typeof m === "object" && m.files && m.folders) return m; } catch { /* first pass */ }
    return emptyManifest();
  }
  function save(m: Manifest): void {
    fs.mkdirSync(path.dirname(o.manifest), { recursive: true, mode: 0o700 });
    const tmp = `${o.manifest}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 });
    fs.renameSync(tmp, o.manifest);
  }

  // ---- the two sides

  async function remote(rootFolder: string): Promise<{ files: Map<string, RemoteFile>; folders: Map<string, string>; complete: boolean }> {
    const files = new Map<string, RemoteFile>();
    const folders = new Map<string, string>();   // path -> folder id
    folders.set("", rootFolder);
    const queue: Array<{ id: string; rel: string }> = [{ id: rootFolder, rel: "" }];
    while (queue.length > 0 && files.size < MAX_FILES) {
      const here = queue.shift()!;
      let cursor: string | undefined;
      do {
        const r = await d.callAs(o.agentId, "files.list", { folder: here.id, ...(cursor ? { cursor } : {}), limit: 200 });
        for (const f of (r.files ?? []) as Array<{ fileId: string; name: string; folderId: string; version: number; size: number; deletedAt?: number }>) {
          if (f.deletedAt || !cleanName(f.name)) continue;
          const rel = here.rel ? `${here.rel}/${f.name}` : f.name;
          files.set(rel, { fileId: f.fileId, name: f.name, folderId: f.folderId, version: f.version, size: f.size, path: rel });
        }
        for (const g of (r.folders ?? []) as Array<{ folderId: string; name: string }>) {
          if (!cleanName(g.name)) continue;
          const rel = here.rel ? `${here.rel}/${g.name}` : g.name;
          folders.set(rel, g.folderId);
          queue.push({ id: g.folderId, rel });
        }
        cursor = r.next as string | undefined;
      } while (cursor);
    }
    return { files, folders, complete: queue.length === 0 };
  }

  /** The disk, by lstat: a link, a device, a hardlink, or anything that is not a plain file or folder is refused and named; nothing here follows a link. */
  function local(refused: string[]): { files: Map<string, LocalFile>; dirs: Set<string> } {
    const files = new Map<string, LocalFile>();
    const dirs = new Set<string>();
    const walk = (rel: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(path.join(o.home, rel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (!cleanName(e.name)) { refused.push(childRel); continue; }
        const abs = path.join(o.home, childRel);
        let st: fs.Stats;
        try { st = fs.lstatSync(abs); } catch { continue; }
        if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) { refused.push(childRel); continue; }
        if (st.isDirectory()) { dirs.add(childRel); walk(childRel); continue; }
        if (st.nlink > 1) { refused.push(childRel); continue; }
        if (SKIP.test(e.name)) continue;
        files.set(childRel, { rel: childRel, abs, size: st.size, mtimeMs: st.mtimeMs });
      }
    };
    walk("");
    return { files, dirs };
  }

  /** Read a plain file without following a link and without leaving the folder. Null when it changed under us into something else. */
  function readLocal(abs: string): Buffer | null {
    const real = (() => { try { return fs.realpathSync(abs); } catch { return null; } })();
    const base = fs.realpathSync(o.home);
    if (real === null || (real !== base && !real.startsWith(base + path.sep))) return null;
    let fd: number | null = null;
    try {
      fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink > 1) return null;
      return fs.readFileSync(fd);
    } catch { return null; } finally { if (fd !== null) fs.closeSync(fd); }
  }

  function writeLocal(rel: string, bytes: Uint8Array, readOnly: boolean): void {
    const abs = path.join(o.home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o777 });
    const tmp = `${abs}.vyre-tmp`;
    try { fs.rmSync(abs, { force: true }); } catch { /* replaced below */ }
    fs.writeFileSync(tmp, bytes, { mode: readOnly ? 0o444 : 0o666 });
    fs.chmodSync(tmp, readOnly ? 0o444 : 0o666);
    fs.renameSync(tmp, abs);
  }

  async function download(f: RemoteFile): Promise<Buffer> {
    const parts: Buffer[] = [];
    for (let offset = 0; ; offset += READ_CHUNK) {
      const r = await d.callAs(o.agentId, "files.read", { fileId: f.fileId, as: "base64", offset, length: READ_CHUNK });
      const chunk = Buffer.from(String(r.base64 ?? ""), "base64");
      parts.push(chunk);
      if (!r.truncated || chunk.length === 0) break;
    }
    return Buffer.concat(parts);
  }

  async function content(bytes: Buffer): Promise<{ text?: string; base64?: string; blobId?: string }> {
    if (bytes.length <= MAX_DIRECT) return { base64: bytes.toString("base64") };
    const slot = await d.callAs(o.agentId, "files.upload_url", { size: bytes.length });
    await d.putBytes(String(slot.url), bytes);
    return { blobId: String(slot.blobId) };
  }

  // ---- the pass

  async function run(): Promise<HomeReport> {
    const report: HomeReport = { down: 0, up: 0, conflicts: 0, removed: 0, refused: [], suggested: 0 };
    const agent = (await d.callAs(o.agentId, "agents.get", { agentId: o.agentId })).agent as { folderId: string; ownerId: string };
    fs.mkdirSync(o.home, { recursive: true, mode: 0o777 });
    const m = load();
    const R = await remote(agent.folderId);
    const L = local(report.refused);
    const settled = (f: LocalFile): boolean => d.now() - f.mtimeMs >= SETTLE_MS;

    const folderFor = async (rel: string): Promise<string> => {
      const known = R.folders.get(rel);
      if (known) return known;
      const parent = await folderFor(dirOf(rel));
      const made = await d.callAs(o.agentId, "files.folder.create", { parentId: parent, name: baseOf(rel), idempotencyKey: `home:${o.computerId}:mkdir:${rel}` });
      const id = String(made.folder?.folderId ?? made.folderId);
      R.folders.set(rel, id);
      m.folders[rel] = id;
      return id;
    };

    // folders: Files' folders appear on the disk
    for (const rel of [...R.folders.keys()].filter((p) => p !== "").sort()) {
      fs.mkdirSync(path.join(o.home, rel), { recursive: true, mode: 0o777 });
      try { fs.chmodSync(path.join(o.home, rel), 0o777); } catch { /* not ours to change */ }
      m.folders[rel] = R.folders.get(rel)!;
    }

    const paths = new Set<string>([...R.files.keys(), ...L.files.keys(), ...Object.keys(m.files)]);
    for (const rel of [...paths].sort()) {
      const r = R.files.get(rel), l = L.files.get(rel), prev = m.files[rel];
      const readOnly = !rel.includes("/") && READ_ONLY.has(rel);
      try {
        if (r && !l) {
          if (prev && prev.version === r.version) {
            // gone from the disk, unchanged in Files: the agent deleted it
            if (readOnly) { writeLocal(rel, await download(r), true); report.down++; continue; }
            await d.callAs(o.agentId, "files.delete", { fileId: r.fileId });
            delete m.files[rel];
            report.removed++;
          } else {
            const bytes = await download(r);
            writeLocal(rel, bytes, readOnly);
            m.files[rel] = { fileId: r.fileId, version: r.version, sha: sha256b64(bytes) };
            report.down++;
          }
        } else if (!r && l) {
          if (prev) {
            // gone from Files (deleted, or access taken away): it leaves the computer, unless it was changed here
            if (!R.complete) continue;   // the listing was cut short: never read a missing file as a revoked one
            const bytes = readLocal(l.abs);
            if (bytes !== null && sha256b64(bytes) === prev.sha) { fs.rmSync(l.abs, { force: true }); delete m.files[rel]; report.removed++; continue; }
            if (bytes === null) continue;
            fs.rmSync(l.abs, { force: true });
            delete m.files[rel];
            report.removed++;
            d.log("warn", "computers.home.revoked_with_edits", { computer: o.computerId, path: rel });
          } else {
            if (!settled(l)) continue;
            const bytes = readLocal(l.abs);
            if (bytes === null) { report.refused.push(rel); continue; }
            if (readOnly) { fs.rmSync(l.abs, { force: true }); continue; }
            const folderId = await folderFor(dirOf(rel));
            const made = await d.callAs(o.agentId, "files.create", { folderId, name: baseOf(rel), content: await content(bytes), idempotencyKey: `home:${o.computerId}:create:${rel}:${sha256b64(bytes)}` });
            const f = made.file as { fileId: string; version: number };
            m.files[rel] = { fileId: f.fileId, version: f.version, sha: sha256b64(bytes) };
            report.up++;
          }
        } else if (r && l) {
          const bytes = readLocal(l.abs);
          if (bytes === null) { report.refused.push(rel); continue; }
          const sha = sha256b64(bytes);
          const localChanged = !prev || sha !== prev.sha;
          const remoteChanged = !prev || r.version !== prev.version;
          if (!localChanged && !remoteChanged) continue;
          if (readOnly) {
            if (localChanged) {
              const theirs = await download(r);
              await d.callAs(o.agentId, "agents.suggestion.propose", {
                agentId: o.agentId, file: rel, diff: `--- ${rel}\n+++ ${rel} (edited on the computer)\n${bytes.toString("utf8").slice(0, 20_000)}`,
                reason: "Edited on the agent's computer, where this file is read-only.", idempotencyKey: `home:${o.computerId}:suggest:${rel}:${sha}`,
              }).then(() => { report.suggested++; }, () => undefined);
              writeLocal(rel, theirs, true);
              m.files[rel] = { fileId: r.fileId, version: r.version, sha: sha256b64(theirs) };
              continue;
            }
          }
          if (localChanged && !remoteChanged) {
            if (!settled(l)) continue;
            const w = await d.callAs(o.agentId, "files.write", { fileId: r.fileId, content: await content(bytes), baseVersion: r.version, reason: "edited on the computer" });
            m.files[rel] = { fileId: r.fileId, version: Number(w.file?.version ?? r.version + 1), sha };
            report.up++;
          } else if (!localChanged && remoteChanged) {
            const theirs = await download(r);
            writeLocal(rel, theirs, readOnly);
            m.files[rel] = { fileId: r.fileId, version: r.version, sha: sha256b64(theirs) };
            report.down++;
          } else {
            // both changed: Files keeps this path, the computer's version is kept beside it, and the agent's owner is told
            const theirs = await download(r);
            const copy = conflictName(baseOf(rel));
            const copyRel = dirOf(rel) ? `${dirOf(rel)}/${copy}` : copy;
            const made = await d.callAs(o.agentId, "files.create", { folderId: r.folderId, name: copy, content: await content(bytes), idempotencyKey: `home:${o.computerId}:conflict:${rel}:${sha}` });
            const cf = made.file as { fileId: string; version: number };
            writeLocal(rel, theirs, readOnly);
            writeLocal(copyRel, bytes, false);
            m.files[rel] = { fileId: r.fileId, version: r.version, sha: sha256b64(theirs) };
            m.files[copyRel] = { fileId: cf.fileId, version: cf.version, sha };
            await d.callAs(o.agentId, "tasks.create", {
              title: `A file changed in two places: ${rel}`, summary: `${rel} was edited on the agent's computer and in Vyre Files at the same time. Vyre Files kept its version. The computer's version is saved beside it as ${copy}.`,
              assigned: { kind: "person", id: agent.ownerId }, fileIds: [r.fileId, cf.fileId], source: { kind: "manual", id: o.computerId }, idempotencyKey: `home:${o.computerId}:conflict-task:${rel}:${sha}`,
            }).catch((e: unknown) => { d.log("warn", "computers.home.conflict_task_failed", { computer: o.computerId, error: e instanceof Error ? e.message.slice(0, 120) : "unknown" }); });
            report.conflicts++;
          }
        } else if (prev) {
          delete m.files[rel];   // gone on both sides
        }
      } catch (e) {
        d.log("warn", "computers.home.file_failed", { computer: o.computerId, path: rel, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
      }
    }

    // folders only on the disk: made in Files; folders Files no longer lists: removed when empty
    for (const rel of [...L.dirs].sort()) {
      if (R.folders.has(rel) || m.folders[rel] !== undefined) continue;   // a folder Files used to list and no longer does was taken away, not made here
      try { await folderFor(rel); } catch (e) { d.log("warn", "computers.home.folder_failed", { computer: o.computerId, path: rel, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); }
    }
    for (const rel of Object.keys(m.folders).sort().reverse()) {
      if (R.folders.has(rel) || !R.complete) continue;
      try { fs.rmdirSync(path.join(o.home, rel)); } catch { /* not empty or already gone */ }
      delete m.folders[rel];
    }
    save(m);
    if (report.refused.length > 0) d.log("warn", "computers.home.refused", { computer: o.computerId, paths: report.refused.slice(0, 20) });
    return report;
  }

  const self: HomeSync = {
    pass(): Promise<HomeReport> {
      if (running) return running.then(() => self.pass());
      running = run().finally(() => { running = null; });
      return running;
    },
  };
  return self;
}
