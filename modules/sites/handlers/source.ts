// Where a deploy's code comes from, put in a fresh folder on the machine that builds it:
//   repo      a shallow git clone of one branch (a token from the Vault for a private repo goes in through git's environment, never the address or argv)
//   folderId  a folder in Files, read file by file as the person or agent deploying (their own access applies)
//   fileId    a .zip or .tar.gz in Files, unpacked
//   path      a folder on the computer this daemon runs on, copied (an agent on the person's own computer); never on a server, whose disk is not the agent's
// `root` picks a folder inside any of these (a monorepo's app).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { untar } from "../../../sandbox/src/tar.ts";

export interface SourceSpec { repo?: string; branch?: string; tokenHandle?: string; folderId?: string; fileId?: string; path?: string; root?: string }
export interface Fetched { dir: string; commit?: string; message?: string; branch?: string; cleanup(): void }
export class SourceError extends Error {
  readonly fix: "connect_repo" | "retry";
  constructor(message: string, fix: "connect_repo" | "retry" = "connect_repo") { super(message); this.fix = fix; }
}

const FILES_MAX = 5000;
const BYTES_MAX = 300 * 1024 * 1024;
const SKIP = new Set([".git", "node_modules", ".next", ".venv", "venv", "__pycache__"]);

/** owner/name, a github.com address with or without .git, or any https git address. */
export function repoUrl(raw: string): string {
  const r = raw.trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) return `https://github.com/${r.replace(/\.git$/, "")}.git`;
  if (/^https:\/\/[^/\s]*@/.test(r)) throw new SourceError("Leave the token out of the address. Pick it from the Vault instead.");
  if (!/^https:\/\/[^\s@]+$/.test(r) || r.startsWith("-")) throw new SourceError("A repo is an https address, like https://github.com/acme/app, or acme/app on GitHub.");
  const u = new URL(r);
  if (u.username || u.password) throw new SourceError("Leave the token out of the address. Pick it from the Vault instead.");
  return /github\.com$/i.test(u.hostname) && !/\.git$/.test(u.pathname) ? `${r.replace(/\/+$/, "")}.git` : r;
}

export function cleanBranch(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const b = raw.trim();
  if (b.length > 100 || !/^[A-Za-z0-9._/-]+$/.test(b) || b.includes("..") || b.startsWith("-") || b.startsWith("/") || b.endsWith("/")) throw new SourceError("That branch name cannot be used.");
  return b;
}

function git(args: string[], cwd: string, token: string | null, timeoutMs = 180_000): Promise<{ code: number; out: string }> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" };
  if (token) {
    // the header is given to git through its environment: no address, argv or config file holds it
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.replace(/(Authorization: Basic )[A-Za-z0-9+/=]+/g, "$1***");
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, out });
    });
  });
}

/** The commit a branch points at now, without a clone: for redeploy on push. */
export async function remoteHead(repo: string, branch: string | undefined, token: string | null): Promise<string | null> {
  const r = await git(["ls-remote", "--", repoUrl(repo), branch ? `refs/heads/${branch}` : "HEAD"], os.tmpdir(), token, 30_000);
  if (r.code !== 0) return null;
  return /^([0-9a-f]{40})\s/m.exec(r.out)?.[1] ?? null;
}

function gitWhy(out: string): string {
  if (/Authentication failed|could not read Username|terminal prompts disabled|403|401/i.test(out)) return "The repo is private or the token cannot read it. Pick a Vault key that holds a GitHub token with read access to it.";
  if (/Remote branch .* not found|couldn't find remote ref/i.test(out)) return "That branch is not in the repo.";
  if (/not found|does not exist|Repository not found/i.test(out)) return "That repo was not found. Check the address, or give a token if it is private.";
  if (/Could not resolve host|unable to access/i.test(out)) return "The repo could not be reached from this server.";
  return `git could not fetch it: ${out.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`;
}

async function fromRepo(dir: string, s: SourceSpec, token: string | null): Promise<{ commit?: string; message?: string; branch?: string }> {
  const url = repoUrl(s.repo as string);
  const branch = cleanBranch(s.branch);
  const r = await git(["clone", "--depth", "1", "--single-branch", ...(branch ? ["--branch", branch] : []), "--", url, "."], dir, token);
  if (r.code !== 0) throw new SourceError(gitWhy(r.out));
  const head = await git(["log", "-1", "--format=%H%n%s"], dir, null, 10_000);
  const [commit, ...msg] = head.out.trim().split("\n");
  const cur = branch ?? (await git(["rev-parse", "--abbrev-ref", "HEAD"], dir, null, 10_000)).out.trim();
  fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
  return { ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { commit } : {}), ...(msg.length ? { message: msg.join(" ").slice(0, 200) } : {}), ...(cur ? { branch: cur } : {}) };
}

function safeJoin(root: string, rel: string): string {
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new SourceError("The upload has a file outside its folder.");
  return p;
}

/** The entries of a zip: names and bytes, stored or deflated. Read from the central directory, so a zip made by any tool reads. */
export function unzip(buf: Buffer): Array<{ name: string; data: Buffer }> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new SourceError("That file is not a zip.");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new SourceError("The zip is damaged.");
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const lnameLen = buf.readUInt16LE(local + 26), lextraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: zlib.inflateRawSync(raw) });
    else throw new SourceError("The zip uses a compression this server does not read. Zip it again with the default settings.");
  }
  return out;
}

function writeAll(dir: string, entries: Array<{ name: string; data: Uint8Array }>): void {
  if (entries.length > FILES_MAX) throw new SourceError(`An upload holds at most ${FILES_MAX} files. Leave node_modules and build output out.`);
  let size = 0;
  for (const e of entries) {
    const parts = e.name.split("/");
    if (parts.some((p) => SKIP.has(p)) || parts.includes("__MACOSX")) continue;
    size += e.data.length;
    if (size > BYTES_MAX) throw new SourceError("The upload is over 300 MB. Leave node_modules and build output out.");
    const p = safeJoin(dir, e.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, e.data);
  }
}

/** An archive that holds one top folder (project-main/...) unpacks as that folder's contents, the way GitHub's own zip download looks. */
function lift(dir: string): void {
  const top = fs.readdirSync(dir).filter((n) => n !== ".DS_Store");
  if (top.length !== 1) return;
  const only = path.join(dir, top[0] as string);
  if (!fs.statSync(only).isDirectory()) return;
  const tmp = `${dir}.lift`;
  fs.renameSync(only, tmp);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
}

function copyLocal(from: string, to: string): void {
  const root = path.resolve(from);
  let st: fs.Stats;
  try { st = fs.statSync(root); } catch { throw new SourceError("That folder is not on this computer."); }
  if (!st.isDirectory()) throw new SourceError("Give a folder, not a file.");
  let files = 0;
  fs.cpSync(root, to, { recursive: true, dereference: false, filter: (src) => { const n = path.basename(src); if (src !== root && SKIP.has(n)) return false; files++; if (files > FILES_MAX * 4) throw new SourceError("That folder is too large to deploy. Leave node_modules and build output out."); return true; } });
}

export interface SourceDeps {
  /** a capability call as the person or agent deploying */
  call(cap: string, input: unknown): Promise<unknown>;
  /** the token behind a Vault key, filled for this deploy only, or null */
  token(handle: string): Promise<string | null>;
  /** true when this daemon runs in a container (a server): a path on its disk is not the agent's */
  contained: boolean;
  tmp?: string;
}

async function fromFolder(dir: string, folderId: string, d: SourceDeps): Promise<void> {
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const walk = async (folder: string, prefix: string): Promise<void> => {
    let cursor: string | undefined;
    do {
      const page = (await d.call("files.list", { folder, limit: 500, ...(cursor ? { cursor } : {}) })) as { files?: Array<{ fileId: string; name: string; size: number }>; folders?: Array<{ folderId: string; name: string }>; next?: string };
      for (const f of page.files ?? []) {
        if (entries.length >= FILES_MAX) throw new SourceError(`A folder holds at most ${FILES_MAX} files to deploy. Leave node_modules and build output out.`);
        const got = (await d.call("files.read", { fileId: f.fileId, as: "base64" })) as { base64?: string };
        if (typeof got.base64 !== "string") throw new SourceError(`${prefix}${f.name} could not be read.`);
        entries.push({ name: `${prefix}${f.name}`, data: Buffer.from(got.base64, "base64") });
      }
      for (const sub of page.folders ?? []) if (!SKIP.has(sub.name)) await walk(sub.folderId, `${prefix}${sub.name}/`);
      cursor = page.next;
    } while (cursor);
  };
  await walk(folderId, "");
  if (entries.length === 0) throw new SourceError("That folder is empty.");
  writeAll(dir, entries);
}

async function fromArchive(dir: string, fileId: string, d: SourceDeps): Promise<void> {
  const meta = (await d.call("files.get", { fileId })) as { file?: { name?: string; size?: number } };
  const name = meta.file?.name ?? "";
  const got = (await d.call("files.read", { fileId, as: "base64" })) as { base64?: string };
  if (typeof got.base64 !== "string") throw new SourceError("That file could not be read.");
  const buf = Buffer.from(got.base64, "base64");
  if (/\.zip$/i.test(name) || buf.readUInt32LE(0) === 0x04034b50) writeAll(dir, unzip(buf));
  else if (/\.(tar\.gz|tgz|tar)$/i.test(name) || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    const tar = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
    writeAll(dir, untar(new Uint8Array(tar)).filter((e) => e.type === "file").map((e) => ({ name: e.path.replace(/^\.\//, ""), data: e.data })));
  } else throw new SourceError("Upload a .zip or .tar.gz of the project, or a folder.");
  lift(dir);
}

/** Fetch the code into a new folder. The caller removes it with cleanup() once the build has read it. */
export async function fetchSource(s: SourceSpec, d: SourceDeps): Promise<Fetched> {
  const parent = d.tmp ?? os.tmpdir();
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const base = fs.mkdtempSync(path.join(parent, "vyre-site-src-"));
  const dir = path.join(base, "src");
  fs.mkdirSync(dir);
  const cleanup = (): void => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(`${dir}.lift`, { recursive: true, force: true }); };
  try {
    let meta: { commit?: string; message?: string; branch?: string } = {};
    const given = [s.repo, s.folderId, s.fileId, s.path].filter((v) => v !== undefined && v !== "").length;
    if (given !== 1) throw new SourceError("Give the site one source: a GitHub repo, a folder or zip in Files, or a folder on this computer.");
    if (s.repo) meta = await fromRepo(dir, s, s.tokenHandle ? await d.token(s.tokenHandle) : null);
    else if (s.folderId) await fromFolder(dir, s.folderId, d);
    else if (s.fileId) await fromArchive(dir, s.fileId, d);
    else {
      if (d.contained) throw new SourceError("A path is a folder on your own computer, and this Vyre runs on a server. Upload the folder, put it in Files, or give a GitHub repo.");
      copyLocal(s.path as string, dir);
    }
    let at = dir;
    if (s.root && s.root.trim() !== "" && s.root.trim() !== ".") {
      at = safeJoin(dir, s.root.trim().replace(/^\/+|\/+$/g, ""));
      if (!fs.existsSync(at) || !fs.statSync(at).isDirectory()) throw new SourceError(`There is no folder ${s.root} in it.`);
    }
    return { dir: at, ...meta, cleanup };
  } catch (e) { cleanup(); throw e; }
}
