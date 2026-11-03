// A goal's Files folder in a terminal agent's work folder, as `goal/` (owner ruling 3 Nov, lane l-engine21; deferred from rc.18 by l-goals).
// Vyre Files are not files on disk, so this is a two-way sync around each turn of a Claude Code or Codex chat that belongs to a goal (its lead's chat, or a task of the goal):
//   start  upload what an unfinished earlier turn left changed (a daemon that stopped mid-turn), then download the folder: new files, files that changed in Vyre, and remove what went away.
//   end    upload what changed on disk as a new version of the same file, new files as new files (folders as needed). Nothing is ever deleted in Vyre from the disk.
// The manifest (.vyre-goal.json, beside goal/ and not in it) remembers per path: the file, the version downloaded, a hash of the bytes written, and whether it is read-only.
// Conflicts keep both: a file changed in Vyre during the turn (files.write with the version the turn started from is refused) is saved as a second file "<name> (agent copy)<ext>" and the
// Vyre version stays; a new file whose name is taken (also by a file the agent cannot see) becomes a copy too. A file is never replaced behind someone's back.
// The read gate (host/src/seams/agent-read.ts, rc.20) holds here because every read is made as the engine (origin "engine", agent-bound): a Not available file or a file nobody reviewed yet
// (Needs review) is never written to disk; a Redacted file is written as the redacted text the gate hands back, marked read-only here, and never uploaded over the original (an edit of it is saved
// as a copy, which holds only the redacted words). A folder set to Not available is not entered. The rule for folders handed to an engine on a person's computer (mounts.engine_folders: nothing
// hidden below a disk folder) stays as it is; goal/ is a different thing, a copy that holds nothing but what an agent may read.
// Writes run as the agent acting for the person (credit "<Person> (Agent)", Review changes folders stage them), through `act`.
// Size: a file up to the Files upload limit (25 MB) is saved back; one over the direct write limit (256 KB) goes up through an upload slot (files.upload_url, bytes put in process by the host), the rest inline.
// Deletes: a file deleted in goal/ is moved to Vyre's Trash (files.delete as the agent, through the Gate like any agent delete; recoverable, never a purge), unless it changed in Vyre meanwhile. Where the Space's rules
// hold an agent's delete, the turn does not wait: the held delete is the chat's normal approval card (Approve moves it to Trash, Keep leaves it, and the next turn finds the file back in goal/ and GOAL-SYNC.txt says so).
// Where they allow it, the file goes straight to Trash and the chat's turn line says so with Undo (files.restore). A file that is a Google document's export (or has hidden parts) that was edited on disk is saved beside it as a copy, in the format it came down in, and the turn line says so.
// What cannot be saved back (over 25 MB) is said in GOAL-SYNC.txt in the work folder, which the skill tells the agent to read.
import { sha256b64 } from "../../kernel/src/seal/wire.ts";
import fs from "node:fs";
import path from "node:path";
import type { EngineSession, OpenSession, SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

export const GOAL_DIR = "goal";
export const GOAL_MANIFEST = ".vyre-goal.json";
export const GOAL_NOTES = "GOAL-SYNC.txt";
/** The direct write limit of Files (content inline); above it a file goes through an upload slot. */
export const MAX_INLINE = 256 * 1024;
/** The Files upload limit (MAX_UPLOAD in modules/files). */
export const MAX_UP = 25 * 1024 * 1024;
export const MAX_DOWN = 25 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_BYTES = 200 * 1024 * 1024;
const MB = 1024 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export interface GoalFolderPorts {
  /** A read as the asker through the pipeline with origin "engine": the read gate applies. */
  read(cap: string, input: unknown, asker: string): Promise<unknown>;
  /** A write as the agent acting for the asker. */
  act(cap: string, input: unknown, who: { agentId: string; asker: string }): Promise<unknown>;
  /** Bytes into an upload slot (the address files.upload_url gave). Absent: a file over the inline limit is not saved back. */
  put?(url: string, bytes: Uint8Array): Promise<void>;
  log?(msg: string, attrs?: Record<string, unknown>): void;
}
export interface GoalTurn { work: string; goalId: string; agentId: string; asker: string; turnId: string }

interface Entry { fileId: string; version: number; sha: string; ro: boolean; /** a Google document's export */ g?: boolean }
/** What a sync did, for the notes file and the chat's turn line. */
export interface SyncResult { notes: string[]; trashed: Array<{ fileId: string; name: string }>; held: Array<{ fileId: string; name: string; taskId: string }>; copies: string[] }
interface Manifest { v: 1; goalId: string; folderId: string; files: Record<string, Entry>; folders: Record<string, string>; /** deletes the Gate is holding: file id to task id */ held?: Record<string, string> }

const sha = (b: Uint8Array): string => sha256b64(b);
const codeOf = (e: unknown): string => (isObj(e) && isObj(e.error) ? str(e.error.code) : isObj(e) ? str(e.code) : "");
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Windows' reserved device names, which open a device and not a file. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
/** A Vyre name as a name on disk: no separators or control characters, no device names, no trailing dots or spaces, not too long. */
export function diskName(name: string): string {
  let n = name.replace(/[\\/\u0000-\u001f:*?"<>|]/g, "_").replace(/[. ]+$/, "");
  if (n === "" || n === "." || n === "..") n = "_";
  if (RESERVED.test(n)) n = `_${n}`;
  return n.length > 120 ? n.slice(0, 120) : n;
}
/** The names in one folder never collide, also on a disk that does not tell A from a ("a (2).md"). */
function uniqueName(name: string, taken: Set<string>): string {
  const ext = path.extname(name), stem = ext ? name.slice(0, -ext.length) : name;
  let n = name, i = 1;
  while (taken.has(n.toLowerCase())) n = `${stem} (${++i})${ext}`;
  taken.add(n.toLowerCase());
  return n;
}

const readManifest = (work: string): Manifest | null => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(work, GOAL_MANIFEST), "utf8")) as Partial<Manifest>;
    return m.v === 1 && typeof m.goalId === "string" && typeof m.folderId === "string" && isObj(m.files) && isObj(m.folders) ? (m as Manifest) : null;
  } catch { return null; }
};
const writeManifest = (work: string, m: Manifest): void => fs.writeFileSync(path.join(work, GOAL_MANIFEST), JSON.stringify(m), { mode: 0o600 });

/** Whether `p` is inside `root` once both are real paths: a symlink out of goal/ is never followed. */
function inside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

interface Listed { files: Obj[]; folders: Obj[] }
async function listAll(p: GoalFolderPorts, folderId: string, asker: string): Promise<Listed> {
  const out: Listed = { files: [], folders: [] };
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = (await p.read("files.list", { folder: folderId, limit: 500, ...(cursor ? { cursor } : {}) }, asker)) as Obj;
    for (const f of Array.isArray(r.files) ? r.files : []) if (isObj(f)) out.files.push(f);
    for (const f of Array.isArray(r.folders) ? r.folders : []) if (isObj(f)) out.folders.push(f);
    cursor = typeof r.next === "string" && r.next !== "" ? r.next : undefined;
    if (!cursor) break;
  }
  return out;
}

/** The goal's folder id; it is made the first time it is needed. */
async function goalFolder(p: GoalFolderPorts, t: GoalTurn): Promise<string | null> {
  const g = (await p.read("goals.get", { goalId: t.goalId }, t.asker).catch(() => null)) as { goal?: { folderId?: unknown } } | null;
  if (typeof g?.goal?.folderId === "string" && g.goal.folderId !== "") return g.goal.folderId;
  const made = (await p.act("goals.folder", { goalId: t.goalId, idempotencyKey: `gf-${t.turnId}` }, t)) as { folderId?: unknown };
  return typeof made.folderId === "string" && made.folderId !== "" ? made.folderId : null;
}

const rmEmptyDirs = (root: string, dir: string): void => {
  for (let d = dir; inside(root, d); d = path.dirname(d)) {
    try { if (fs.readdirSync(d).length > 0) return; fs.rmdirSync(d); } catch { return; }
  }
};

/** Download the goal's folder into goal/. Returns the notes for GOAL-SYNC.txt. */
export async function syncDown(p: GoalFolderPorts, t: GoalTurn): Promise<string[]> {
  const notes: string[] = [];
  const folderId = await goalFolder(p, t);
  if (!folderId) return ["The goal's folder could not be opened, so goal/ was not updated."];
  const root = path.join(t.work, GOAL_DIR);
  fs.mkdirSync(root, { recursive: true });
  const rootReal = fs.realpathSync(root);
  const old = readManifest(t.work);
  const next: Manifest = { v: 1, goalId: t.goalId, folderId, files: {}, folders: {} };
  const wasHeld = old?.held ?? {};
  let count = 0, bytes = 0;
  const seen = new Set<string>();   // fileIds seen this pass

  const walk = async (fid: string, rel: string, depth: number): Promise<void> => {
    const [list, states] = await Promise.all([
      listAll(p, fid, t.asker),
      (p.read("files.agent_states", { folderId: fid }, t.asker) as Promise<Obj>).catch(() => null),
    ]);
    const badge = new Map<string, string>();
    for (const f of Array.isArray(states?.files) ? (states!.files as unknown[]) : []) if (isObj(f)) badge.set(str(f.fileId), str(f.state));
    const folderValue = new Map<string, string>();
    for (const f of Array.isArray(states?.folders) ? (states!.folders as unknown[]) : []) if (isObj(f)) folderValue.set(str(f.folderId), str(f.value));
    const taken = new Set<string>();
    for (const f of list.folders) {
      const id = str(f.folderId);
      if (folderValue.get(id) === "off") continue;   // Not available: not even its name goes to disk
      const name = uniqueName(diskName(str(f.name)), taken);
      const r = rel === "" ? name : `${rel}/${name}`;
      next.folders[r] = id;
      fs.mkdirSync(path.join(root, r), { recursive: true });
      if (depth < MAX_DEPTH) await walk(id, r, depth + 1);
      else notes.push(`${r} is nested too deep to copy.`);
    }
    for (const f of list.files) {
      const fileId = str(f.fileId);
      const state = badge.get(fileId);
      // Not available, Needs review (nobody has redacted it yet) or a state the gate did not report: nothing goes to disk
      if (state === "off" || state === "needs_review" || state === undefined) continue;
      const name = uniqueName(diskName(str(f.name)), taken);
      const r = rel === "" ? name : `${rel}/${name}`;
      const google = str(f.kind) === "google_native";
      const ro = state !== "clear" || google;
      const version = num(f.version);
      if (++count > MAX_FILES) { if (count === MAX_FILES + 1) notes.push(`The folder has more than ${MAX_FILES} files; the rest are not in goal/.`); continue; }
      if (num(f.size) > MAX_DOWN) { notes.push(`${r} is over ${MAX_DOWN / MB} MB and is not in goal/.`); continue; }
      const abs = path.join(root, r);
      const was = old?.files[r];
      // unchanged in Vyre, and what is on disk is what was written: nothing to fetch (a redacted file is fetched every time, its redactions can change without a new version)
      if (was && !ro && !was.ro && was.fileId === fileId && was.version === version) {
        try { if (sha(fs.readFileSync(abs)) === was.sha) { next.files[r] = was; seen.add(fileId); bytes += num(f.size); continue; } } catch { /* gone from disk: fetched again */ }
      }
      let b64: string;
      try {
        const got = (await p.read("files.read", { fileId, as: "base64" }, t.asker)) as Obj;
        b64 = str(got.base64);
        if (got.truncated === true) { notes.push(`${r} could not be read whole and is not in goal/.`); continue; }
      } catch (e) {
        // the gate refused (Not available, hidden parts of a picture or a PDF): the file stays off the disk, and a copy from an earlier pass goes
        if (!/^permission\./.test(codeOf(e))) p.log?.("a goal file could not be read for goal/", { fileId, error: msgOf(e) });
        continue;
      }
      const data = Buffer.from(b64, "base64");
      bytes += data.byteLength;
      if (bytes > MAX_BYTES) { notes.push(`goal/ is over ${MAX_BYTES / MB} MB; ${r} and the files after it are not copied.`); continue; }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (fs.existsSync(abs)) fs.chmodSync(abs, 0o644);
        fs.writeFileSync(abs, data, { mode: ro ? 0o444 : 0o644 });
      } catch (e) { p.log?.("a goal file could not be written", { fileId, error: msgOf(e) }); continue; }
      next.files[r] = { fileId, version, sha: sha(data), ro, ...(google ? { g: true } : {}) };
      seen.add(fileId);
    }
  };
  await walk(folderId, "", 0);

  // what was written before and is not in Vyre now (deleted, moved out, hidden since) leaves the disk: its edits were uploaded first
  for (const r of Object.keys(old?.files ?? {})) {
    if (next.files[r]) continue;   // the path holds a file of Vyre's now
    const abs = path.join(root, r);
    if (!inside(rootReal, path.join(rootReal, r))) continue;
    try { if (fs.lstatSync(abs).isFile()) { fs.rmSync(abs, { force: true }); rmEmptyDirs(rootReal, path.dirname(abs)); } } catch { /* already gone */ }
  }
  // a delete the Gate held that is still a file in Vyre: it was kept (or is still waiting), so it is back on disk
  for (const [fileId] of Object.entries(wasHeld)) { const at = Object.entries(next.files).find(([, e]) => e.fileId === fileId); if (at) notes.push(`${at[0]} was deleted in goal/ but the delete was not approved (or still waits), so it is back.`); }
  writeManifest(t.work, next);
  return notes;
}

/** Upload what changed on disk. Returns the notes for GOAL-SYNC.txt. */
export async function syncUp(p: GoalFolderPorts, t: GoalTurn): Promise<SyncResult> {
  const notes: string[] = [], trashed: SyncResult["trashed"] = [], held: SyncResult["held"] = [], copies: string[] = [];
  const out = (): SyncResult => ({ notes, trashed, held, copies });
  const m = readManifest(t.work);
  const root = path.join(t.work, GOAL_DIR);
  if (!m || m.goalId !== t.goalId || !fs.existsSync(root)) return out();
  const rootReal = fs.realpathSync(root);
  let n = 0;
  const key = (what: string): string => `gf-${t.turnId}-${what}-${++n}`;
  /** The content of a write: inline up to the direct limit, an upload slot above it, null when there is no way to send it. */
  const contentOf = async (data: Buffer): Promise<{ base64: string } | { blobId: string } | null> => {
    if (data.byteLength <= MAX_INLINE) return { base64: data.toString("base64") };
    if (!p.put) return null;
    const slot = (await p.act("files.upload_url", { size: data.byteLength, idempotencyKey: key("slot") }, t)) as { blobId?: unknown; url?: unknown };
    if (typeof slot.blobId !== "string" || typeof slot.url !== "string") throw new Error("Files gave no upload slot");
    await p.put(slot.url, data);
    return { blobId: slot.blobId };
  };
  const isText = (b: Buffer): boolean => !b.subarray(0, 4096).includes(0);
  const copyName = (name: string, taken: Set<string>, data?: Buffer, format = false): string => {
    // a Google document's export may have no extension: the copy keeps the format it came down in (text is markdown, anything else is a Word file)
    if (format && path.extname(name) === "") name = `${name}${data && isText(data) ? ".md" : ".docx"}`;
    const ext = path.extname(name), stem = ext ? name.slice(0, -ext.length) : name;
    return uniqueName(`${stem} (agent copy)${ext}`, taken);
  };
  // names already taken in a Vyre folder, as an agent sees them (a hidden file with the same name still refuses the create, which is answered below)
  const namesIn = new Map<string, Set<string>>();
  const takenIn = async (folderId: string): Promise<Set<string>> => {
    let s = namesIn.get(folderId);
    if (!s) { s = new Set<string>(); try { for (const f of (await listAll(p, folderId, t.asker)).files) s.add(str(f.name).toLowerCase()); } catch { /* the create answers */ } namesIn.set(folderId, s); }
    return s;
  };
  const folderOf = async (relDir: string): Promise<string | null> => {
    if (relDir === "") return m.folderId;
    const known = m.folders[relDir];
    if (known) return known;
    const parent = await folderOf(path.posix.dirname(relDir) === "." ? "" : path.posix.dirname(relDir));
    if (!parent) return null;
    const name = path.posix.basename(relDir);
    for (const tryName of [name, `${name} (agent)`]) {
      try {
        const r = (await p.act("files.folder.create", { parentId: parent, name: tryName, idempotencyKey: key("folder") }, t)) as { folder?: { folderId?: unknown } };
        const id = str(r.folder?.folderId);
        if (id) { m.folders[relDir] = id; return id; }
      } catch (e) { if (codeOf(e) !== "validation.duplicate") { notes.push(`The folder ${relDir} could not be made in Vyre: ${msgOf(e)}`); return null; } }
    }
    notes.push(`The folder ${relDir} could not be made in Vyre.`);
    return null;
  };
  const saveCopy = async (relDir: string, name: string, data: Buffer, why: string, format = false): Promise<boolean> => {
    const fid = await folderOf(relDir);
    if (!fid) return false;
    const taken = await takenIn(fid);
    for (let i = 0; i < 3; i++) {
      const copy = copyName(name, taken, data, format);
      try {
        const content = await contentOf(data);
        if (!content) { notes.push(`${why} The copy is over ${MAX_INLINE / 1024} KB and could not be sent.`); return false; }
        await p.act("files.create", { folderId: fid, name: copy, content, idempotencyKey: key("copy") }, t);
        const line = `${why} It was saved as ${relDir ? `${relDir}/` : ""}${copy}.`;
        notes.push(line); copies.push(line);
        return true;
      } catch (e) { if (codeOf(e) !== "validation.duplicate") { notes.push(`${why} The copy could not be saved: ${msgOf(e)}`); return false; } }
    }
    return false;
  };

  const files: string[] = [];
  const dirs: string[] = [];
  const scan = (dir: string, rel: string): void => {
    let names: string[];
    try { names = fs.readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      if (name.startsWith(".vyre")) continue;
      const abs = path.join(dir, name), r = rel === "" ? name : `${rel}/${name}`;
      let st: fs.Stats;
      try { st = fs.lstatSync(abs); } catch { continue; }
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) continue;   // a link could point out of goal/
      if (st.isDirectory()) { dirs.push(r); scan(abs, r); } else files.push(r);
    }
  };
  scan(rootReal, "");

  for (const r of files) {
    const abs = path.join(rootReal, r);
    let data: Buffer;
    try { data = fs.readFileSync(abs); } catch { continue; }
    const h = sha(data);
    const e = m.files[r];
    if (e && e.sha === h) continue;   // not touched
    const relDir = path.posix.dirname(r) === "." ? "" : path.posix.dirname(r), name = path.posix.basename(r);
    if (data.byteLength > MAX_UP) { notes.push(`${r} is over ${MAX_UP / MB} MB, the Files upload limit, so it was not saved to Vyre. Split it or keep it in your work folder.`); if (e) e.sha = h; continue; }
    if (e && e.ro) {
      // never over the original: a file with parts hidden from AI holds only the redacted words
      const kept = await saveCopy(relDir, name, data, e.g ? `${r} is a Google document, which is edited in Google and not from here, so your edit was kept beside it.` : `${r} has parts hidden from AI, so your edit could not replace it.`, e.g === true);
      if (kept) e.sha = h;   // dealt with; the next start brings the redacted text back
      continue;
    }
    if (e) {
      try {
        const content = await contentOf(data);
        if (!content) { notes.push(`${r} could not be sent to Vyre.`); continue; }
        const w = (await p.act("files.write", { fileId: e.fileId, content, baseVersion: e.version, reason: "Edited in a terminal turn", idempotencyKey: key("write") }, t)) as { file?: { version?: unknown }; changesetId?: unknown };
        e.sha = h;
        if (typeof w.changesetId === "string") notes.push(`${r} is waiting for a person to approve it in Review changes.`);
        else if (typeof w.file?.version === "number") e.version = w.file.version;
      } catch (err) {
        if (codeOf(err) === "validation.version_conflict") {
          const kept = await saveCopy(relDir, name, data, `${r} changed in Vyre while you worked, so your version did not replace it.`);
          if (kept) { e.sha = h; e.version = 0; }   // version 0: the next start downloads Vyre's version
        } else if (codeOf(err) === "permission.on_hold") { notes.push(`${r} is waiting for approval before it is saved.`); e.sha = h; }
        else notes.push(`${r} was not saved to Vyre: ${msgOf(err)}`);
      }
      continue;
    }
    // a new file
    const fid = await folderOf(relDir);
    if (!fid) continue;
    try {
      const content = await contentOf(data);
      if (!content) { notes.push(`${r} could not be sent to Vyre.`); continue; }
      const c = (await p.act("files.create", { folderId: fid, name, content, idempotencyKey: key("create") }, t)) as { file?: { fileId?: unknown; version?: unknown }; changesetId?: unknown };
      const id = str(c.file?.fileId);
      if (id) m.files[r] = { fileId: id, version: num(c.file?.version) || 1, sha: h, ro: false };
      if (typeof c.changesetId === "string") notes.push(`${r} is waiting for a person to approve it in Review changes.`);
    } catch (err) {
      if (codeOf(err) === "validation.duplicate") {
        const kept = await saveCopy(relDir, name, data, `A file named ${name} is already in that Vyre folder.`);
        if (kept) m.files[r] = { fileId: "", version: 0, sha: h, ro: true };   // the disk file is the copy's source; it is replaced by Vyre's own at the next start
      } else notes.push(`${r} was not saved to Vyre: ${msgOf(err)}`);
    }
  }
  // a file that was in goal/ and is not any more goes to Vyre's Trash, where it can be restored: never a purge, and not when someone changed it in Vyre meanwhile
  const onDisk = new Set(files);
  for (const [r, e] of Object.entries(m.files)) {
    if (onDisk.has(r) || e.ro || e.fileId === "" || m.held?.[e.fileId]) continue;
    try { fs.lstatSync(path.join(rootReal, r)); continue; } catch { /* gone from disk */ }
    try {
      const now = ((await p.read("files.get", { fileId: e.fileId }, t.asker)) as { file?: { version?: unknown; deletedAt?: unknown } }).file;
      if (!now || now.deletedAt) { delete m.files[r]; continue; }
      if (num(now.version) !== e.version) { notes.push(`${r} was deleted in goal/ but changed in Vyre meanwhile, so it was kept.`); continue; }
      await p.act("files.delete", { fileId: e.fileId, idempotencyKey: key("trash") }, t);
      trashed.push({ fileId: e.fileId, name: r });
      delete m.files[r];
    } catch (err) {
      // the Gate holds an agent's delete: the turn does not wait, the approval card is the chat's
      if (codeOf(err) === "permission.on_hold" && typeof (err as { taskId?: unknown }).taskId === "string") { held.push({ fileId: e.fileId, name: r, taskId: (err as { taskId: string }).taskId }); (m.held ??= {})[e.fileId] = (err as { taskId: string }).taskId; continue; } notes.push(`${r} was deleted in goal/ but could not be moved to Trash in Vyre: ${msgOf(err)}`); }
  }
  // folders that exist only on disk (empty ones the agent made) are made too, so they are there for the next turn
  for (const d of dirs) if (!m.folders[d]) await folderOf(d);
  writeManifest(t.work, m);
  return out();
}

const notesFile = (work: string, notes: string[]): void => {
  const f = path.join(work, GOAL_NOTES);
  if (notes.length === 0) { fs.rmSync(f, { force: true }); return; }
  fs.writeFileSync(f, `Vyre could not do everything with goal/ at the end of the last turn. Read this before you work:\n${notes.map((n) => `- ${n}`).join("\n")}\n`, { mode: 0o644 });
};

/** Both halves of a turn, kept apart per work folder so two turns never sync one folder at once. */
const chain = new Map<string, Promise<unknown>>();
function exclusive<T>(work: string, f: () => Promise<T>): Promise<T> {
  const prev = chain.get(work) ?? Promise.resolve();
  const run = prev.then(f, f);
  const tail = run.catch(() => undefined);
  chain.set(work, tail);
  void tail.then(() => { if (chain.get(work) === tail) chain.delete(work); });
  return run;
}

export async function startOfTurn(p: GoalFolderPorts, t: GoalTurn): Promise<SyncResult> {
  return exclusive(t.work, async () => {
    // an earlier turn that never finished (the daemon stopped) left edits on disk: they go up before anything is downloaded over them
    const up = await syncUp(p, t).catch((e: unknown): SyncResult => { p.log?.("goal/ could not be saved at the start of a turn", { goalId: t.goalId, error: msgOf(e) }); return { notes: [], trashed: [], held: [], copies: [] }; });
    const down = await syncDown(p, t);
    notesFile(t.work, [...up.notes, ...down]);
    return up;
  });
}
export async function endOfTurn(p: GoalFolderPorts, t: GoalTurn): Promise<SyncResult> {
  return exclusive(t.work, async () => { const r = await syncUp(p, t); notesFile(t.work, r.notes); return r; });
}

/** The chat's turn lines for what a sync did: copies kept, and files moved to Trash with Undo. */
export function turnLines(r: SyncResult): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (r.copies.length > 0) out.push({ state: "note", text: r.copies.slice(0, 3).join(" ") + (r.copies.length > 3 ? ` And ${r.copies.length - 3} more.` : "") });
  if (r.trashed.length > 0) {
    const names = r.trashed.slice(0, 5).map((x) => x.name).join(", ") + (r.trashed.length > 5 ? ` and ${r.trashed.length - 5} more` : "");
    out.push({ state: "trashed", text: `Moved ${r.trashed.length === 1 ? "a file" : `${r.trashed.length} files`} deleted in goal/ to Vyre's Trash: ${names}.`, fileIds: r.trashed.map((x) => x.fileId) });
  }
  if (r.held.length > 0) {
    const names = r.held.slice(0, 5).map((x) => x.name).join(", ") + (r.held.length > 5 ? ` and ${r.held.length - 5} more` : "");
    out.push({ state: "note", text: `Moving ${r.held.length === 1 ? "a file" : `${r.held.length} files`} deleted in goal/ to Vyre's Trash waits for approval: ${names}.` });
    for (const x of r.held.slice(0, 10)) out.push({ state: "waiting", taskId: x.taskId });
  }
  return out;
}

// ---- which turns, and the wrapper ----

export interface GoalFolderDeps extends GoalFolderPorts {
  workOf(spec: SessionSpec): string | null;
  /** True for a session that is a terminal engine (Claude Code or Codex); a test's scripted engine says yes for all. */
  terminal(spec: SessionSpec): boolean;
  /** A line in the chat from the agent whose turn it is (a turn_status block). */
  say?(turn: { threadId: string; agentId: string; asker: string }, data: Record<string, unknown>): void;
}

/** The goal a chat belongs to: the lead's chat (scope goal) or a task of the goal (scope task, the goal in its working notes). Cached per chat. */
export function createGoalOf(p: Pick<GoalFolderPorts, "read">): (threadId: string, asker: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (threadId, asker) => {
    if (cache.has(threadId)) return cache.get(threadId) ?? null;
    let goal: string | null = null;
    const th = ((await p.read("threads.get", { threadId }, asker).catch(() => null)) as { thread?: Obj } | null)?.thread;
    if (th && str(th.scopeType) === "goal" && str(th.scopeId)) goal = str(th.scopeId);
    else if (th && str(th.scopeType) === "task" && str(th.scopeId)) {
      const task = ((await p.read("tasks.get", { taskId: str(th.scopeId) }, asker).catch(() => null)) as { task?: { workingNotes?: Obj } } | null)?.task;
      goal = str(task?.workingNotes?.["goal.id"]) || null;
    }
    if (th) { cache.set(threadId, goal); if (cache.size > 500) cache.delete(cache.keys().next().value as string); }
    return goal;
  };
}

/**
 * An OpenSession whose terminal engines see the goal's folder as goal/ in their work folder: downloaded before the turn, saved after it (before the turn's "done" is passed on, so a turn is
 * finished only when its files are in Vyre), and saved again if the turn ends any other way. A failure never holds a turn.
 */
export function withGoalFolder(open: OpenSession, d: GoalFolderDeps): OpenSession {
  const goalOf = createGoalOf(d);
  return async (spec) => {
    const session = await open(spec);
    if (spec.tools === "none" || !d.terminal(spec)) return session;
    return Object.create(session, {
      send: {
        value: (input: TurnInput) => (async function* () {
          let t: GoalTurn | null = null;
          try {
            const work = d.workOf(spec);
            const goalId = work ? await goalOf(input.threadId, input.asker) : null;
            if (work && goalId) {
              t = { work, goalId, agentId: input.agent.id, asker: input.asker, turnId: input.turnId };
              say(input, await startOfTurn(d, t));
            }
          } catch (e) { d.log?.("goal/ could not be set up for the engine", { threadId: input.threadId, error: msgOf(e) }); }
          function say(i: TurnInput, r: SyncResult): void { for (const data of turnLines(r)) d.say?.({ threadId: i.threadId, agentId: i.agent.id, asker: i.asker }, data); }
          let saved = false;
          const save = async (): Promise<void> => {
            if (saved || !t) return;
            saved = true;
            try { say(input, await endOfTurn(d, t)); } catch (e) { d.log?.("goal/ could not be saved to Vyre", { threadId: input.threadId, error: msgOf(e) }); }
          };
          try {
            for await (const ev of session.send(input)) {
              if (ev.type === "done") await save();
              yield ev;
            }
          } finally { await save(); }
        })(),
        writable: true, configurable: true,
      },
    }) as EngineSession;
  };
}
