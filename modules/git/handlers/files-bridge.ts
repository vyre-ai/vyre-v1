// The Files tree and the git working copy are one tree (ARCH 6.x: the real working tree is data/trees/<folderId>/ and Files is a view over it). The git module keeps the two in step at the
// edges of its own operations, through the files.* capabilities only:
//   toTree    before an operation that reads the working copy (init, status, diff, commit, branch, sync): what Files holds under the folder is written into the working copy.
//   fromTree  after an operation that changes the working copy (pull, sync, branch switch): what git left there is brought into Files, so a pulled file is a file in the tree.
// A small record beside the working copy (<trees>/<folderId>.files.json, outside the repository) says which path is which file and what each side looked like when they last matched, so
// only what changed moves and a file git brought in is never deleted because Files has not heard of it. Files over the direct write limit stay where they are (named in the log).
// Every step is best effort: a Files call that fails or answers something unexpected leaves the working copy as it was and never fails the git operation.
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";

type Row = Record<string, unknown>;
interface Entry { fileId: string; /** what Files said when the bytes were written: updatedAt:size */ stamp: string; /** sha-256 of the bytes on disk then */ sha: string }
interface Book { files: Record<string, Entry> }

const CHUNK = 200_000;
/** Files accepts a direct write up to this size (files MAX_INLINE). */
const DIRECT = 256 * 1024;

const obj = (v: unknown): Row => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const arr = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const bookPath = (treesDir: string, folderId: string): string => path.join(treesDir, `${folderId}.files.json`);
function readBook(treesDir: string, folderId: string): Book {
  try {
    const v = obj(JSON.parse(fs.readFileSync(bookPath(treesDir, folderId), "utf8")));
    return { files: obj(v["files"]) as Record<string, Entry> };
  } catch { return { files: {} }; }
}
function saveBook(treesDir: string, folderId: string, book: Book): void {
  fs.mkdirSync(treesDir, { recursive: true });
  fs.writeFileSync(bookPath(treesDir, folderId), JSON.stringify(book));
}

/** Every page of files.list for one folder: its files and its folders. */
async function listAll(ctx: Ctx, folder: string): Promise<{ files: Row[]; folders: Row[] }> {
  const files: Row[] = [], folders: Row[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const page = obj(await ctx.call("files.list", { folder, limit: 500, ...(cursor ? { cursor } : {}) }));
    files.push(...arr(page["files"]));
    folders.push(...arr(page["folders"]));
    const next = str(page["next"]);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return { files, folders };
}

async function readAll(ctx: Ctx, fileId: string): Promise<Uint8Array | undefined> {
  const parts: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i < 1000; i++) {
    const r = obj(await ctx.call("files.read", { fileId, as: "base64", offset, length: CHUNK }));
    if (typeof r["base64"] !== "string") return undefined;
    const b = Buffer.from(r["base64"], "base64");
    parts.push(b);
    offset += b.length;
    if (r["truncated"] !== true || b.length === 0) return Buffer.concat(parts);
  }
  return undefined;
}

const stampOf = (f: Row): string => `${String(f["updatedAt"])}:${String(f["size"])}`;

/** Files to the working copy. */
export async function toTree(ctx: Ctx, treesDir: string, dir: string, folderId: string): Promise<void> {
  try {
    const book = readBook(treesDir, folderId);
    const seen = new Set<string>();
    const walk = async (folder: string, rel: string): Promise<void> => {
      const { files, folders } = await listAll(ctx, folder);
      for (const f of files) {
        const name = str(f["name"]), fileId = str(f["fileId"]);
        if (!name || !fileId || f["deletedAt"] !== undefined && f["deletedAt"] !== null) continue;
        const relPath = rel ? `${rel}/${name}` : name;
        seen.add(relPath);
        const have = book.files[relPath];
        const target = path.join(dir, relPath);
        if (have && have.fileId === fileId && have.stamp === stampOf(f) && fs.existsSync(target)) continue;   // nothing new in Files for this one
        const bytes = await readAll(ctx, fileId);
        if (!bytes) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
        book.files[relPath] = { fileId, stamp: stampOf(f), sha: await sha256(bytes) };
      }
      for (const sub of folders) {
        const name = str(sub["name"]), id = str(sub["folderId"]);
        if (name && id) await walk(id, rel ? `${rel}/${name}` : name);
      }
    };
    await walk(folderId, "");
    // a path Files no longer holds goes from the working copy too, unless it changed there since (git's change is not ours to throw away)
    for (const [relPath, entry] of Object.entries(book.files)) {
      if (seen.has(relPath)) continue;
      const target = path.join(dir, relPath);
      try {
        if (fs.existsSync(target) && (await sha256(fs.readFileSync(target))) === entry.sha) fs.unlinkSync(target);
      } catch { /* leave it */ }
      delete book.files[relPath];
    }
    saveBook(treesDir, folderId, book);
  } catch (e) {
    ctx.log?.warn("git: could not copy Files into the working copy", { folderId, error: e instanceof Error ? e.message : String(e) });
  }
}

function walkDisk(root: string, rel = ""): string[] {
  const out: string[] = [];
  let names: fs.Dirent[];
  try { names = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    if (rel === "" && e.name === ".git") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkDisk(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

/** The working copy to Files. */
export async function fromTree(ctx: Ctx, treesDir: string, dir: string, folderId: string): Promise<void> {
  try {
    const book = readBook(treesDir, folderId);
    const folderIds = new Map<string, string>([["", folderId]]);
    /** The Files folder for a relative directory, made on the way down when it is not there. */
    const folderFor = async (rel: string): Promise<string> => {
      const known = folderIds.get(rel);
      if (known) return known;
      const cut = rel.lastIndexOf("/");
      const parentRel = cut < 0 ? "" : rel.slice(0, cut), name = cut < 0 ? rel : rel.slice(cut + 1);
      const parent = await folderFor(parentRel);
      const { folders } = await listAll(ctx, parent);
      let id = str(folders.find((f) => str(f["name"]) === name)?.["folderId"]);
      if (!id) id = str(obj(obj(await ctx.call("files.folder.create", { idempotencyKey: `git-in:${folderId}:dir:${rel}`, parentId: parent, name }))["folder"])["folderId"]);
      if (!id) throw new Error(`no Files folder for ${rel}`);
      folderIds.set(rel, id);
      return id;
    };
    const onDisk = walkDisk(dir);
    for (const relPath of onDisk) {
      const bytes = fs.readFileSync(path.join(dir, relPath));
      const sha = await sha256(bytes);
      const have = book.files[relPath];
      if (have && have.sha === sha) continue;
      if (bytes.byteLength > DIRECT) { ctx.log?.warn("git: a working copy file is over the direct write limit and stays out of Files", { folderId, path: relPath }); continue; }
      const content = { base64: Buffer.from(bytes).toString("base64") };
      let made: Row;
      if (have) made = obj(obj(await ctx.call("files.write", { fileId: have.fileId, content, reason: "git" }))["file"]);
      else {
        const cut = relPath.lastIndexOf("/");
        const parent = await folderFor(cut < 0 ? "" : relPath.slice(0, cut));
        const name = cut < 0 ? relPath : relPath.slice(cut + 1);
        made = obj(obj(await ctx.call("files.create", { idempotencyKey: `git-in:${folderId}:${relPath}:${sha}`, folderId: parent, name, content }))["file"]);
      }
      const fileId = str(made["fileId"]) || have?.fileId || "";
      if (fileId) book.files[relPath] = { fileId, stamp: stampOf(made), sha };
    }
    // a file git removed is removed from Files (Trash), so the two stay one tree
    const present = new Set(onDisk);
    for (const [relPath, entry] of Object.entries(book.files)) {
      if (present.has(relPath)) continue;
      try { await ctx.call("files.delete", { fileId: entry.fileId }); } catch { /* already gone */ }
      delete book.files[relPath];
    }
    saveBook(treesDir, folderId, book);
  } catch (e) {
    ctx.log?.warn("git: could not bring the working copy into Files", { folderId, error: e instanceof Error ? e.message : String(e) });
  }
}
