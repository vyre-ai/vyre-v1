// git operations (spec 2.16; ARCH 7.5 and 8.5). Any folder can be a repository. The real working tree lives at <treesDir>/<folderId> (data/trees/<folderId> on the host)
// and every operation runs the git binary against it through an injected Exec (argv, no shell), so tests drive a real git in a temp directory and the host passes processExec().
//
// Remote auth: github.installation_token returns a Vault filler handle, never the token. The handle is filled into ref `kind: "git_credential"`, the host's filler hands the token
// to takeCredential(ref) once, and it reaches git as an HTTP header in the child's environment only (GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n). It is never put in
// argv, in .git/config, in an event, in a log or in an error: stderr is scrubbed of the token and of its encoded form before it is read.
//
// Protected branches: git.push and git.sync declare the Gate act push_protected with `git.is_protected(input.branch)`. The Gate evaluates that through isProtectedCall below
// (the branch defaults to the current one, the list is the folder's own or the Space setting git.protected_branches). There is no force push.
//
// Commits are authored by the first editor: the author given, else the caller. The email carries the kind (`<id>@<kind>.vyre.local`), which git.log reads back.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { fromTree, toTree } from "./files-bridge.ts";
import path from "node:path";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

type Row = Record<string, unknown>;

// ---- drivers ------------------------------------------------------------------------------------------------

export interface ExecOptions {
  cwd?: string;
  /** added to the child environment; never logged */
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (argv: string[], opts?: ExecOptions) => Promise<ExecResult>;

export interface GitDrivers {
  exec: Exec;
  /** the directory that holds one working tree per folder: <treesDir>/<folderId> */
  treesDir: string;
  /** added to every git child environment (tests point remotes at local repositories with url.<base>.insteadOf here) */
  env?: Record<string, string>;
  /** the Vault filler delivers the installation token for a `git_credential` ref here, once; undefined when nothing was filled */
  takeCredential(ref: string): string | undefined;
}

let configured: GitDrivers | null = null;

/** The host (or a test) calls this with its drivers. Null clears; without drivers git runs through the process, trees under $VYRE_DATA_DIR/trees (default ./data/trees). */
export function configureGit(drivers: GitDrivers | null): void {
  configured = drivers;
}

function drivers(): GitDrivers {
  if (configured) return configured;
  return { exec: processExec(), treesDir: path.join(process.env["VYRE_DATA_DIR"] ?? "data", "trees"), takeCredential: () => undefined };
}

/** Runs a command without a shell. A timeout kills the process and returns code 124. */
export function processExec(): Exec {
  return (argv, opts = {}) =>
    new Promise<ExecResult>((resolve) => {
      const [cmd, ...rest] = argv;
      if (cmd === undefined) {
        resolve({ code: 127, stdout: "", stderr: "no command" });
        return;
      }
      const child = spawn(cmd, rest, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = opts.timeoutMs === undefined ? null : setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs);
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
      child.on("error", (e) => {
        if (timer) clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: stderr + e.message });
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr: timedOut ? `${stderr}\ntimed out after ${opts.timeoutMs} ms` : stderr });
      });
    });
}

// ---- errors and input helpers -------------------------------------------------------------------------------

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

function record(ctx: Ctx, input: unknown): Row {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Row;
}

function reqStr(ctx: Ctx, o: Row, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", `${key} is required.`);
  return v;
}

function optStr(o: Row, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function folderIdOf(ctx: Ctx, o: Row): string {
  const id = reqStr(ctx, o, "folderId");
  if (!/^fld_[a-z0-9]+$/.test(id)) fail(ctx, "validation.bad_input", "folderId is not a folder id.");
  return id;
}

/** A ref (branch, tag, commit, "origin/main") that cannot be read as an option or carry control characters. */
function refOf(ctx: Ctx, v: string, what: string): string {
  if (v.startsWith("-") || /[\u0000- \u007f~^:?*[\\]/.test(v) || v.includes("..") || v.includes("@{")) fail(ctx, "validation.bad_input", `${what} is not a valid name.`);
  return v;
}

/** A path inside the working tree: relative, no "..", no leading dash. */
function pathOf(ctx: Ctx, v: string): string {
  const norm = v.replace(/\\/g, "/");
  if (norm.length === 0 || norm.startsWith("/") || norm.startsWith("-") || norm.split("/").includes("..") || norm.includes("\u0000")) fail(ctx, "validation.bad_input", "A path must stay inside the folder.");
  return norm;
}

const SHA = /^[0-9a-f]{7,40}$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const LOCAL_MS = 60_000;
const NETWORK_MS = 5 * 60_000;

// ---- running git --------------------------------------------------------------------------------------------

function baseEnv(d: GitDrivers): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
    ...(d.env ?? {}),
  };
}

/** Adds one config entry to the child environment (GIT_CONFIG_COUNT and friends), after whatever entries are already there. */
function withConfig(env: Record<string, string>, key: string, value: string): Record<string, string> {
  const n = Number.parseInt(env["GIT_CONFIG_COUNT"] ?? "0", 10);
  const at = Number.isFinite(n) && n >= 0 ? n : 0;
  return { ...env, GIT_CONFIG_COUNT: String(at + 1), [`GIT_CONFIG_KEY_${at}`]: key, [`GIT_CONFIG_VALUE_${at}`]: value };
}

const locks = new Map<string, Promise<unknown>>();

/** One git command at a time per folder (the index lock would refuse the second). */
async function exclusive<T>(folderId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(folderId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(folderId, tail);
  try {
    return await next;
  } finally {
    if (locks.get(folderId) === tail) locks.delete(folderId);
  }
}

interface Repo {
  folderId: string;
  dir: string;
  d: GitDrivers;
}

function repoOf(_ctx: unknown, folderId: string): Repo {
  const d = drivers();
  return { folderId, dir: path.join(d.treesDir, folderId), d };
}

function isRepo(r: Repo): boolean {
  return fs.existsSync(path.join(r.dir, ".git"));
}

function needRepo(ctx: Ctx, r: Repo): void {
  if (!isRepo(r)) fail(ctx, "validation.precondition_failed", "This folder is not a git repository yet. Start history first.");
}

function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length > 0) out = out.split(s).join("***");
  return out;
}

async function git(r: Repo, args: string[], o: { env?: Record<string, string>; timeoutMs?: number; secrets?: readonly string[] } = {}): Promise<ExecResult> {
  const res = await r.d.exec(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.quotepath=off", "-c", "commit.gpgsign=false", ...args], {
    cwd: r.dir,
    env: { ...baseEnv(r.d), ...(o.env ?? {}) },
    timeoutMs: o.timeoutMs ?? LOCAL_MS,
  });
  const secrets = o.secrets ?? [];
  return secrets.length === 0 ? res : { ...res, stdout: scrub(res.stdout, secrets), stderr: scrub(res.stderr, secrets) };
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > 300 ? `${line.slice(0, 300)}...` : line;
}

async function must(ctx: Ctx, r: Repo, args: string[], o: { env?: Record<string, string>; timeoutMs?: number; secrets?: readonly string[] } = {}): Promise<ExecResult> {
  const res = await git(r, args, o);
  if (res.code !== 0) fail(ctx, "validation.precondition_failed", firstLine(res.stderr) || firstLine(res.stdout) || `git ${args[0] ?? ""} failed`);
  return res;
}

/** What went wrong talking to a remote, in the catalogue's terms. */
function remoteFail(ctx: Ctx, res: ExecResult): never {
  const text = `${res.stderr}\n${res.stdout}`;
  if (/authentication failed|invalid username or password|could not read (username|password)|terminal prompts disabled|permission denied|requested url returned error: (401|403)|repository not found|access denied/i.test(text)) {
    return fail(ctx, "provider.auth_failed", "The remote refused the sign-in. Reconnect GitHub and try again.");
  }
  if (res.code === 124 || /could not resolve host|unable to access|timed out|connection (refused|reset|timed)|network is unreachable|early eof|ssl|unexpected disconnect/i.test(text)) {
    return fail(ctx, "provider.unavailable", "The remote could not be reached. Try again in a moment.");
  }
  if (/non-fast-forward|fetch first|\(behind\)|updates were rejected/i.test(text)) {
    return fail(ctx, "validation.precondition_failed", "The remote has changes you do not have yet. Pull first, then push.");
  }
  return fail(ctx, "validation.precondition_failed", firstLine(res.stderr) || firstLine(res.stdout) || "The remote refused the request.");
}

async function validBranch(ctx: Ctx, r: Repo, name: string): Promise<string> {
  refOf(ctx, name, "The branch name");
  const res = await git(r, ["check-ref-format", "--branch", name]);
  if (res.code !== 0) fail(ctx, "validation.bad_input", "The branch name is not valid.");
  return name;
}

async function hasHead(r: Repo): Promise<boolean> {
  return (await git(r, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
}

async function headSha(r: Repo): Promise<string | undefined> {
  const res = await git(r, ["rev-parse", "--verify", "-q", "HEAD"]);
  const sha = res.stdout.trim();
  return res.code === 0 && SHA.test(sha) ? sha : undefined;
}

async function currentBranch(r: Repo): Promise<string | undefined> {
  const res = await git(r, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const name = res.stdout.trim();
  return res.code === 0 && name.length > 0 ? name : undefined;
}

// ---- protected branches -------------------------------------------------------------------------------------

const DEFAULT_PROTECTED = ["main", "master"];

function stringList(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

async function protectedList(ctx: Pick<Ctx, "db" | "call">, folderId: string): Promise<string[]> {
  const rows = ctx.db.all("SELECT * FROM git_protection WHERE folder_id = ?", folderId) as Row[];
  const own = rows[0];
  if (own && typeof own["branches"] === "string") {
    try {
      const list = stringList(JSON.parse(own["branches"]));
      if (list) return list;
    } catch {
      // a damaged row falls back to the Space setting
    }
  }
  try {
    const res = (await ctx.call("settings.get", { key: "git.protected_branches" })) as { row?: { value?: unknown } } | null;
    return stringList(res?.row?.value) ?? DEFAULT_PROTECTED;
  } catch {
    return DEFAULT_PROTECTED;
  }
}

/** The branch name matches a protected entry exactly (a remote-tracking name "origin/main" is judged by the part after the remote). */
function listed(list: readonly string[], branch: string, remote?: string): boolean {
  return list.includes(branch) || (remote !== undefined && branch.startsWith(`${remote}/`) && list.includes(branch.slice(remote.length + 1)));
}

/**
 * What `git.is_protected(input.branch)` evaluates for the Gate: true when the branch the call pushes (the current one when input.branch is absent) is protected for the folder.
 * It never throws; a folder that is not a repository, or a branch it cannot tell, is not protected (the handler itself then refuses the push).
 */
export async function isProtectedCall(ctx: Pick<Ctx, "db" | "call">, input: unknown): Promise<boolean> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const o = input as Row;
  const folderId = typeof o["folderId"] === "string" ? o["folderId"] : "";
  if (!/^fld_[a-z0-9]+$/.test(folderId)) return false;
  let branch = optStr(o, "branch");
  if (branch === undefined) {
    const r = repoOf(ctx, folderId);
    if (!isRepo(r)) return false;
    branch = await currentBranch(r);
  }
  if (branch === undefined) return false;
  return listed(await protectedList(ctx, folderId), branch);
}

// ---- parsing ------------------------------------------------------------------------------------------------

type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
interface FileChange { path: string; status: FileStatus; added: number; removed: number; staged: boolean }
interface Hunk { hunkId: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: { op: "ctx" | "add" | "del"; text: string }[] }
type AuthorKind = "person" | "agent" | "actor" | "external";
interface CommitRow { sha: string; message: string; author: { name: string; kind: AuthorKind; id?: string }; at: number; files: number; parents: string[] }

/** The first n space-separated tokens and the rest of the line (a path may hold spaces). */
function splitN(line: string, n: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let i = 0; i < n; i++) {
    const at = rest.indexOf(" ");
    if (at < 0) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

function kindOfXY(xy: string): FileStatus {
  const x = xy[0] ?? ".";
  const y = xy[1] ?? ".";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflicted";
  const c = x !== "." ? x : y;
  if (c === "A" || c === "C") return "added";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  return "modified";
}

function letterStatus(letter: string): FileStatus {
  const c = letter[0] ?? "M";
  if (c === "A" || c === "C") return "added";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "U") return "conflicted";
  return "modified";
}

/** `--numstat -z` output to {path: [added, removed]}. A rename entry is "A\tR\t" then old and new path as their own NUL fields. */
function parseNumstat(out: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  const parts = out.split("\u0000");
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[i] ?? "");
    if (!m) continue;
    let file = m[3] ?? "";
    if (file === "") {
      file = parts[i + 2] ?? "";
      i += 2;
    }
    map.set(file, [m[1] === "-" ? 0 : Number(m[1]), m[2] === "-" ? 0 : Number(m[2])]);
  }
  return map;
}

/** `--name-status -z` output to [{status, path}], with the new path for a rename or copy. */
function parseNameStatus(out: string): { status: FileStatus; path: string }[] {
  const res: { status: FileStatus; path: string }[] = [];
  const parts = out.split("\u0000");
  for (let i = 0; i < parts.length; i++) {
    const letter = parts[i] ?? "";
    if (letter === "") continue;
    if (letter[0] === "R" || letter[0] === "C") {
      const to = parts[i + 2] ?? "";
      res.push({ status: letterStatus(letter), path: to });
      i += 2;
    } else {
      res.push({ status: letterStatus(letter), path: parts[i + 1] ?? "" });
      i += 1;
    }
  }
  return res;
}

function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split("\n")) {
    if (cur === null || (oldLeft <= 0 && newLeft <= 0)) {
      cur = null;
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      cur = {
        hunkId: `h${hunks.length + 1}`,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      oldLeft = cur.oldLines;
      newLeft = cur.newLines;
      hunks.push(cur);
      continue;
    }
    const c = line[0];
    if (c === "\\") continue;
    if (c === "+") { cur.lines.push({ op: "add", text: line.slice(1) }); newLeft--; }
    else if (c === "-") { cur.lines.push({ op: "del", text: line.slice(1) }); oldLeft--; }
    else if (c === " " || line === "") { cur.lines.push({ op: "ctx", text: line.slice(1) }); oldLeft--; newLeft--; }
  }
  return hunks;
}

function authorOf(name: string, email: string): CommitRow["author"] {
  const m = /^(.+)@(person|agent|actor|external)\.vyre\.local$/.exec(email);
  if (!m) return { name, kind: "external" };
  return { name, kind: m[2] as AuthorKind, id: m[1] as string };
}

async function commitRows(ctx: Ctx, r: Repo, rev: string[], limit: number): Promise<CommitRow[]> {
  const res = await git(r, ["log", "--no-color", "-n", String(limit), "--shortstat", "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B%x1d", ...rev]);
  if (res.code !== 0) {
    if (!(await hasHead(r))) return [];
    fail(ctx, "validation.precondition_failed", firstLine(res.stderr) || "That history could not be read.");
  }
  const rows: CommitRow[] = [];
  for (const chunk of res.stdout.split("\u001e").slice(1)) {
    const cut = chunk.indexOf("\u001d");
    const head = cut < 0 ? chunk : chunk.slice(0, cut);
    const tail = cut < 0 ? "" : chunk.slice(cut + 1);
    const f = head.split("\u001f");
    const sha = f[0] ?? "";
    if (!SHA.test(sha)) continue;
    const stat = /(\d+) files? changed/.exec(tail);
    rows.push({
      sha,
      message: f.slice(5).join("\u001f").trim(),
      author: authorOf(f[2] ?? "", f[3] ?? ""),
      at: Number(f[4] ?? "0") * 1000,
      files: stat ? Number(stat[1]) : 0,
      parents: (f[1] ?? "").split(" ").filter((p) => SHA.test(p)),
    });
  }
  return rows;
}

/** Counts and statuses of the files a diff-producing command touches (`diff`, `diff-tree`), with the same options on both queries. */
async function fileChanges(ctx: Ctx, r: Repo, cmd: string[], tail: string[] = []): Promise<FileChange[]> {
  const stat = await must(ctx, r, [...cmd, "--numstat", "-z", "-M", ...tail]);
  const names = await must(ctx, r, [...cmd, "--name-status", "-z", "-M", ...tail]);
  const counts = parseNumstat(stat.stdout);
  return parseNameStatus(names.stdout).map((n) => {
    const c = counts.get(n.path) ?? [0, 0];
    return { path: n.path, status: n.status, added: c[0], removed: c[1], staged: false };
  });
}

function lineCount(file: string): number {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 1_000_000) return 0;
    const text = fs.readFileSync(file, "utf8");
    if (text.length === 0 || text.includes("\u0000")) return 0;
    return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
}

/** The remotes as configured (raw addresses: `git remote -v` would show them after url.<base>.insteadOf rewriting). Only https addresses are listed. */
async function remotesOf(r: Repo): Promise<{ name: string; url: string }[]> {
  const res = await git(r, ["config", "--get-regexp", "^remote\\..*\\.url$"]);
  const out: { name: string; url: string }[] = [];
  for (const line of res.stdout.split("\n")) {
    const m = /^remote\.(.+)\.url (\S+)$/.exec(line.trim());
    if (m && /^https:\/\/[^@\s]+$/.test(m[2] as string)) out.push({ name: m[1] as string, url: m[2] as string });
  }
  return out;
}

// ---- identity -----------------------------------------------------------------------------------------------

function identityEnv(ctx: Ctx, author: Row | undefined): Record<string, string> {
  const authorId = author?.["id"];
  const authorName = author?.["name"];
  const authorKind = author?.["kind"];
  const rawId = typeof authorId === "string" && authorId.length > 0 ? authorId : ctx.principal.id;
  const id = rawId.replace(/[^A-Za-z0-9._-]/g, "_");
  const kind: AuthorKind = authorKind === "person" || authorKind === "agent" || authorKind === "actor" || authorKind === "external"
    ? authorKind
    : ctx.principal.kind === "service" ? "external" : ctx.principal.kind;
  const name = typeof authorName === "string" && authorName.length > 0 ? authorName : ctx.principal.id;
  const email = `${id}@${kind}.vyre.local`;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

// ---- remote credentials -------------------------------------------------------------------------------------

let refCounter = 0;

/** The environment for one remote call: the installation token as an HTTP header (child environment only) for a github.com remote, nothing for any other. */
async function remoteAuth(ctx: Ctx, r: Repo, remote: string): Promise<{ env: Record<string, string>; secrets: string[] }> {
  const url = (await git(r, ["config", "--get", `remote.${remote}.url`])).stdout.trim();
  if (url === "") fail(ctx, "validation.precondition_failed", `This folder has no remote named ${remote}. Add one first.`);
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return { env: {}, secrets: [] };
  const minted = (await ctx.call("github.installation_token", { repo: `${m[1]}/${m[2]}` })) as { handle?: unknown } | null;
  const handle = minted && typeof minted.handle === "string" ? minted.handle : "";
  if (handle === "") fail(ctx, "provider.auth_failed", "GitHub did not give a token for this repository. Reconnect GitHub and try again.");
  ctx.vault.use(handle);
  refCounter += 1;
  const ref = `git:${r.folderId}:${ctx.now()}:${refCounter}`;
  await ctx.vault.fill(handle, { kind: "git_credential", ref });
  const token = r.d.takeCredential(ref);
  if (token === undefined || token === "") fail(ctx, "provider.auth_failed", "The GitHub token could not be filled. Reconnect GitHub and try again.");
  const encoded = btoa(`x-access-token:${token}`);
  return { env: withConfig(baseEnv(r.d), "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${encoded}`), secrets: [token, encoded] };
}

// ---- handlers -----------------------------------------------------------------------------------------------

function subject(folderId: string): string {
  return `folder/${folderId}`;
}

async function init(ctx: Ctx, input: unknown): Promise<{ branch: string }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  return exclusive(folderId, async () => {
    if (isRepo(r)) {
      const existing = await currentBranch(r);
      return { branch: existing ?? "main" };
    }
    const wanted = optStr(o, "branch");
    fs.mkdirSync(r.dir, { recursive: true });
    const branch = wanted === undefined ? "main" : await validBranch(ctx, r, wanted);
    await must(ctx, r, ["init", "--quiet"]);
    await must(ctx, r, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
    ctx.emit("git.initialized", subject(folderId), { folderId, branch });
    return { branch };
  });
}

async function status(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  if (!isRepo(r)) return { isRepo: false, ahead: 0, behind: 0, clean: true, changes: [], remotes: [], protected: false };
  const res = await must(ctx, r, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]);
  let branch: string | undefined;
  let upstream: string | undefined;
  let head: string | undefined;
  let ahead = 0;
  let behind = 0;
  const changes: FileChange[] = [];
  const parts = res.stdout.split("\u0000");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? "";
    if (rec === "") continue;
    if (rec.startsWith("# branch.oid ")) { const v = rec.slice(13); if (SHA.test(v)) head = v; continue; }
    if (rec.startsWith("# branch.head ")) { const v = rec.slice(14); if (v !== "(detached)") branch = v; continue; }
    if (rec.startsWith("# branch.upstream ")) { upstream = rec.slice(18); continue; }
    if (rec.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(rec);
      if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
      continue;
    }
    if (rec.startsWith("#")) continue;
    const kind = rec[0];
    if (kind === "1") {
      const f = splitN(rec, 8);
      const xy = f[1] ?? "..";
      changes.push({ path: f[8] ?? "", status: kindOfXY(xy), added: 0, removed: 0, staged: (xy[0] ?? ".") !== "." && kindOfXY(xy) !== "conflicted" });
    } else if (kind === "2") {
      const f = splitN(rec, 9);
      const xy = f[1] ?? "..";
      changes.push({ path: f[9] ?? "", status: "renamed", added: 0, removed: 0, staged: (xy[0] ?? ".") !== "." });
      i += 1;
    } else if (kind === "u") {
      const f = splitN(rec, 10);
      changes.push({ path: f[10] ?? "", status: "conflicted", added: 0, removed: 0, staged: false });
    } else if (kind === "?") {
      changes.push({ path: rec.slice(2), status: "untracked", added: 0, removed: 0, staged: false });
    }
  }
  if (changes.length > 0) {
    const counts = parseNumstat((await git(r, ["diff", "--numstat", "-z", "-M", head === undefined ? EMPTY_TREE : "HEAD"])).stdout);
    for (const c of changes) {
      if (c.status === "untracked") c.added = lineCount(path.join(r.dir, c.path));
      else {
        const n = counts.get(c.path);
        if (n) { c.added = n[0]; c.removed = n[1]; }
      }
    }
  }
  const list = await protectedList(ctx, folderId);
  return {
    isRepo: true,
    ...(branch !== undefined ? { branch } : {}),
    ...(upstream !== undefined ? { upstream } : {}),
    ...(head !== undefined ? { head } : {}),
    ahead,
    behind,
    clean: changes.length === 0,
    changes,
    remotes: await remotesOf(r),
    protected: branch !== undefined && list.includes(branch),
  };
}

async function log(ctx: Ctx, input: unknown): Promise<{ commits: CommitRow[]; next?: string }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  const limitIn = o["limit"];
  const limit = typeof limitIn === "number" && Number.isInteger(limitIn) ? Math.min(Math.max(limitIn, 1), 500) : 50;
  const before = optStr(o, "before");
  if (before !== undefined && !SHA.test(before)) fail(ctx, "validation.bad_input", "before is not a commit.");
  const branch = optStr(o, "branch");
  if (branch !== undefined) refOf(ctx, branch, "The branch name");
  const file = optStr(o, "path");
  const rev: string[] = [before !== undefined ? `${before}^` : branch ?? "HEAD"];
  if (file !== undefined) rev.push("--", pathOf(ctx, file));
  const rows = await commitRows(ctx, r, rev, limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return rows.length > limit && last ? { commits: page, next: last.sha } : { commits: page };
}

async function show(ctx: Ctx, input: unknown): Promise<{ commit: CommitRow; files: FileChange[]; hunks: Hunk[] }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  const sha = reqStr(ctx, o, "sha");
  if (!SHA.test(sha)) fail(ctx, "validation.bad_input", "sha is not a commit.");
  const commit = (await commitRows(ctx, r, ["--no-walk", sha], 1))[0];
  if (!commit) return fail(ctx, "validation.precondition_failed", "That commit is not in this folder.");
  const files = await fileChanges(ctx, r, ["diff-tree", "--root", "-r", "--no-commit-id", sha]);
  const file = optStr(o, "path");
  let hunks: Hunk[] = [];
  if (file !== undefined) {
    const patch = await must(ctx, r, ["show", "--no-color", "--format=", "-U3", "-M", sha, "--", pathOf(ctx, file)]);
    hunks = parseHunks(patch.stdout);
  }
  return { commit, files, hunks };
}

async function diff(ctx: Ctx, input: unknown): Promise<{ files: FileChange[]; hunks: Hunk[] }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  const from = optStr(o, "from");
  const to = optStr(o, "to");
  if (from !== undefined) refOf(ctx, from, "from");
  if (to !== undefined) refOf(ctx, to, "to");
  const base = from ?? ((await hasHead(r)) ? "HEAD" : EMPTY_TREE);
  const revs = to !== undefined ? [base, to] : [base];
  const file = optStr(o, "path");
  const tail = file !== undefined ? ["--", pathOf(ctx, file)] : [];
  const files = await fileChanges(ctx, r, ["diff", ...revs], tail);
  const patch = await must(ctx, r, ["diff", "--no-color", "--no-ext-diff", "-U3", "-M", ...revs, ...tail]);
  return { files, hunks: parseHunks(patch.stdout) };
}

async function listBranches(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  const res = await must(ctx, r, [
    "for-each-ref", "--format=%(refname)%1f%(objectname)%1f%(upstream:track,nobracket)", "refs/heads", "refs/remotes",
  ]);
  const list = await protectedList(ctx, folderId);
  const branches: Row[] = [];
  for (const line of res.stdout.split("\n")) {
    const f = line.split("\u001f");
    const ref = f[0] ?? "";
    const sha = f[1] ?? "";
    if (!SHA.test(sha)) continue;
    const isRemote = ref.startsWith("refs/remotes/");
    const name = ref.replace(/^refs\/(heads|remotes)\//, "");
    if (name === "" || name.endsWith("/HEAD")) continue;
    const row: Row = { name, remote: isRemote, sha, protected: listed(list, name, isRemote ? name.split("/")[0] : undefined) };
    const track = f[2] ?? "";
    if (!isRemote && track !== "") {
      row["ahead"] = Number(/ahead (\d+)/.exec(track)?.[1] ?? "0");
      row["behind"] = Number(/behind (\d+)/.exec(track)?.[1] ?? "0");
    }
    branches.push(row);
  }
  const current = await currentBranch(r);
  return { ...(current !== undefined ? { current } : {}), branches };
}

async function commit(ctx: Ctx, input: unknown): Promise<{ sha: string; files: number }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const message = reqStr(ctx, o, "message");
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  const pathsIn = o["paths"];
  const paths = Array.isArray(pathsIn) ? pathsIn.map((p) => pathOf(ctx, String(p))) : undefined;
  const authorIn = o["author"];
  const author = authorIn !== null && typeof authorIn === "object" && !Array.isArray(authorIn) ? (authorIn as Row) : undefined;
  return exclusive(folderId, async () => {
    const branch = await currentBranch(r);
    if (branch === undefined) fail(ctx, "validation.precondition_failed", "Switch to a branch before committing.");
    if (paths !== undefined && paths.length === 0) fail(ctx, "validation.precondition_failed", "No files were chosen to commit.");
    await must(ctx, r, ["add", "-A", "--", ...(paths ?? ["."])]);
    const staged = await git(r, ["diff", "--cached", "--quiet", ...(paths !== undefined ? ["--", ...paths] : [])]);
    if (staged.code === 0) fail(ctx, "validation.precondition_failed", "There is nothing to commit.");
    const env = identityEnv(ctx, author);
    await must(ctx, r, ["commit", "--no-verify", "--no-gpg-sign", "-m", message, ...(paths !== undefined ? ["--only", "--", ...paths] : [])], { env });
    const sha = await headSha(r);
    if (sha === undefined) return fail(ctx, "internal.unexpected", "The commit was made but its id could not be read.");
    const count = (await must(ctx, r, ["diff-tree", "--root", "-r", "--no-commit-id", "--name-only", "-z", sha])).stdout.split("\u0000").filter((p) => p !== "").length;
    ctx.emit("git.committed", subject(folderId), { folderId, sha, branch, by: env["GIT_AUTHOR_EMAIL"]?.split("@")[0] ?? ctx.principal.id, files: count, message });
    return { sha, files: count };
  });
}

async function branchOp(ctx: Ctx, input: unknown): Promise<{ branch: string }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  const action = reqStr(ctx, o, "action");
  if (action !== "create" && action !== "switch" && action !== "delete") fail(ctx, "validation.bad_input", "action must be create, switch or delete.");
  const name = await validBranch(ctx, r, reqStr(ctx, o, "name"));
  const from = optStr(o, "from");
  if (from !== undefined) refOf(ctx, from, "from");
  return exclusive(folderId, async () => {
    const exists = (await git(r, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).code === 0;
    if (action === "create") {
      if (exists) fail(ctx, "validation.duplicate", "A branch with that name already exists.");
      if (!(await hasHead(r))) fail(ctx, "validation.precondition_failed", "Commit once before making another branch.");
      await must(ctx, r, ["branch", name, ...(from !== undefined ? [from] : [])]);
    } else if (action === "switch") {
      await must(ctx, r, ["switch", "--quiet", name]);
    } else {
      if (!exists) fail(ctx, "validation.precondition_failed", "That branch does not exist.");
      if ((await currentBranch(r)) === name) fail(ctx, "validation.precondition_failed", "Switch to another branch before deleting this one.");
      if (listed(await protectedList(ctx, folderId), name)) fail(ctx, "validation.precondition_failed", "A protected branch cannot be deleted. Remove its protection first.");
      await must(ctx, r, ["branch", "-D", name]);
    }
    ctx.emit("git.branch_changed", subject(folderId), { folderId, branch: name, action });
    return { branch: name };
  });
}

interface PullResult { updated: boolean; sha?: string; conflicts: string[] }

async function conflictedFiles(r: Repo): Promise<string[]> {
  const res = await git(r, ["diff", "--name-only", "--diff-filter=U", "-z"]);
  return res.stdout.split("\u0000").filter((p) => p !== "");
}

async function pullInside(ctx: Ctx, r: Repo, o: Row): Promise<PullResult> {
  const remote = refOf(ctx, optStr(o, "remote") ?? "origin", "The remote name");
  const strategy = optStr(o, "strategy") ?? "merge";
  if (strategy !== "merge" && strategy !== "rebase" && strategy !== "ff_only") fail(ctx, "validation.bad_input", "strategy must be merge, rebase or ff_only.");
  const branch = optStr(o, "branch") ?? (await currentBranch(r));
  if (branch === undefined) return fail(ctx, "validation.precondition_failed", "Switch to a branch before pulling.");
  refOf(ctx, branch, "The branch name");
  const before = await headSha(r);
  const auth = await remoteAuth(ctx, r, remote);
  const fetched = await git(r, ["fetch", "--quiet", remote, branch], { env: auth.env, secrets: auth.secrets, timeoutMs: NETWORK_MS });
  if (fetched.code !== 0) remoteFail(ctx, fetched);
  const env = identityEnv(ctx, undefined);
  let conflicts: string[] = [];
  if (strategy === "ff_only") {
    const res = await git(r, ["merge", "--ff-only", "--quiet", "FETCH_HEAD"], { env });
    if (res.code !== 0) fail(ctx, "validation.precondition_failed", "Your branch and the remote have both moved on, so this cannot be a fast-forward. Pull with merge or rebase.");
  } else if (strategy === "merge") {
    const res = await git(r, ["merge", "--no-edit", "--quiet", "FETCH_HEAD"], { env });
    if (res.code !== 0) {
      conflicts = await conflictedFiles(r);
      if (conflicts.length === 0) fail(ctx, "validation.precondition_failed", firstLine(res.stderr) || firstLine(res.stdout) || "The merge failed.");
    }
  } else {
    const res = await git(r, ["rebase", "--quiet", "FETCH_HEAD"], { env });
    if (res.code !== 0) {
      conflicts = await conflictedFiles(r);
      await git(r, ["rebase", "--abort"]);
      if (conflicts.length === 0) fail(ctx, "validation.precondition_failed", firstLine(res.stderr) || firstLine(res.stdout) || "The rebase failed.");
    }
  }
  const after = await headSha(r);
  ctx.emit("git.pulled", subject(r.folderId), { folderId: r.folderId, branch, ...(before !== undefined ? { from: before } : {}), to: after ?? before ?? "0000000", conflicts: conflicts.length });
  return { updated: after !== before, ...(after !== undefined ? { sha: after } : {}), conflicts };
}

async function pull(ctx: Ctx, input: unknown): Promise<PullResult> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  return exclusive(folderId, () => pullInside(ctx, r, o));
}

async function pushInside(ctx: Ctx, r: Repo, o: Row): Promise<{ pushed: boolean; sha?: string }> {
  const remote = refOf(ctx, optStr(o, "remote") ?? "origin", "The remote name");
  const branch = optStr(o, "branch") ?? (await currentBranch(r));
  if (branch === undefined) return fail(ctx, "validation.precondition_failed", "Switch to a branch before pushing.");
  refOf(ctx, branch, "The branch name");
  const exists = (await git(r, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  if (!exists) fail(ctx, "validation.precondition_failed", `There is no branch ${branch} to push.`);
  const auth = await remoteAuth(ctx, r, remote);
  const res = await git(r, ["push", "--quiet", "--set-upstream", remote, `refs/heads/${branch}:refs/heads/${branch}`], { env: auth.env, secrets: auth.secrets, timeoutMs: NETWORK_MS });
  if (res.code !== 0) remoteFail(ctx, res);
  const tip = (await git(r, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).stdout.trim();
  const pushedSha = SHA.test(tip) ? tip : undefined;
  if (pushedSha === undefined) return fail(ctx, "internal.unexpected", "The push worked but its commit could not be read.");
  ctx.emit("git.pushed", subject(r.folderId), { folderId: r.folderId, branch, remote, sha: pushedSha, protectedBranch: listed(await protectedList(ctx, r.folderId), branch) });
  return { pushed: true, sha: pushedSha };
}

async function push(ctx: Ctx, input: unknown): Promise<{ pushed: boolean; sha?: string }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  return exclusive(folderId, () => pushInside(ctx, r, o));
}

async function sync(ctx: Ctx, input: unknown): Promise<{ pulled: boolean; pushed: boolean; conflicts: string[]; sha?: string }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  return exclusive(folderId, async () => {
    const pulled = await pullInside(ctx, r, o);
    if (pulled.conflicts.length > 0) return { pulled: true, pushed: false, conflicts: pulled.conflicts, ...(pulled.sha !== undefined ? { sha: pulled.sha } : {}) };
    const pushed = await pushInside(ctx, r, o);
    return { pulled: true, pushed: pushed.pushed, conflicts: [], ...(pushed.sha !== undefined ? { sha: pushed.sha } : {}) };
  });
}

async function remoteAdd(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const name = reqStr(ctx, o, "name");
  const url = reqStr(ctx, o, "url");
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith("-")) fail(ctx, "validation.bad_input", "The remote name is not valid.");
  if (!/^https:\/\/[^@\s]+$/.test(url)) fail(ctx, "validation.bad_input", "A remote must be an https address without a sign-in in it.");
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  return exclusive(folderId, async () => {
    const have = (await git(r, ["config", "--get", `remote.${name}.url`])).stdout.trim();
    if (have !== "") fail(ctx, "validation.duplicate", "A remote with that name already exists.");
    await must(ctx, r, ["remote", "add", name, url]);
    ctx.emit("git.remote_added", subject(folderId), { folderId, name });
    return { ok: true };
  });
}

async function remoteRemove(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const name = reqStr(ctx, o, "name");
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith("-")) fail(ctx, "validation.bad_input", "The remote name is not valid.");
  const r = repoOf(ctx, folderId);
  needRepo(ctx, r);
  return exclusive(folderId, async () => {
    const have = (await git(r, ["config", "--get", `remote.${name}.url`])).stdout.trim();
    if (have === "") return { ok: false };
    await must(ctx, r, ["remote", "remove", name]);
    ctx.emit("git.remote_removed", subject(folderId), { folderId, name });
    return { ok: true };
  });
}

async function protect(ctx: Ctx, input: unknown): Promise<{ branches: string[] }> {
  const o = record(ctx, input);
  const folderId = folderIdOf(ctx, o);
  const list = stringList(o["branches"]);
  if (!list) return fail(ctx, "validation.bad_input", "branches must be a list of branch names.");
  const names: string[] = [];
  for (const n of list) {
    const name = refOf(ctx, n, "A branch name");
    if (!names.includes(name)) names.push(name);
  }
  ctx.db.run("INSERT OR REPLACE INTO git_protection (folder_id, branches, updated_at) VALUES (?, ?, ?)", folderId, JSON.stringify(names), ctx.now());
  ctx.emit("git.protection_changed", subject(folderId), { folderId, branches: names });
  return { branches: names };
}

async function health(_ctx: Ctx, _input: unknown): Promise<Row> {
  const d = drivers();
  const started = Date.now();
  const res = await d.exec(["git", "--version"], { env: baseEnv(d), timeoutMs: 10_000 });
  const latencyMs = Date.now() - started;
  if (res.code !== 0) return { state: "down", detail: firstLine(res.stderr) || "git did not run", latencyMs };
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(res.stdout);
  const version = m ? `${m[1]}.${m[2]}${m[3] !== undefined ? `.${m[3]}` : ""}` : res.stdout.trim();
  if (m && (Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 25))) {
    return { state: "degraded", detail: `git ${version} is older than 2.25; update it on the server`, latencyMs, version };
  }
  return { state: "healthy", latencyMs, version };
}

const rawHandlers = {
  "git.init": (ctx: Ctx, input: unknown) => init(ctx, input),
  "git.status": (ctx: Ctx, input: unknown) => status(ctx, input),
  "git.log": (ctx: Ctx, input: unknown) => log(ctx, input),
  "git.show": (ctx: Ctx, input: unknown) => show(ctx, input),
  "git.diff": (ctx: Ctx, input: unknown) => diff(ctx, input),
  "git.list_branches": (ctx: Ctx, input: unknown) => listBranches(ctx, input),
  "git.commit": (ctx: Ctx, input: unknown) => commit(ctx, input),
  "git.branch": (ctx: Ctx, input: unknown) => branchOp(ctx, input),
  "git.pull": (ctx: Ctx, input: unknown) => pull(ctx, input),
  "git.push": (ctx: Ctx, input: unknown) => push(ctx, input),
  "git.sync": (ctx: Ctx, input: unknown) => sync(ctx, input),
  "git.remote_add": (ctx: Ctx, input: unknown) => remoteAdd(ctx, input),
  "git.remote_remove": (ctx: Ctx, input: unknown) => remoteRemove(ctx, input),
  "git.protect": (ctx: Ctx, input: unknown) => protect(ctx, input),
  "git.health": (ctx: Ctx, input: unknown) => health(ctx, input),
};

type OpHandler = (ctx: Ctx, input: unknown) => Promise<unknown>;

/** Files is a view over the working copy: before these operations what Files holds is written into it, and after these what git left in it is brought into Files (files-bridge.ts). */
const READS_TREE = new Set(["git.init", "git.status", "git.diff", "git.commit", "git.branch", "git.sync", "git.pull"]);
const CHANGES_TREE = new Set(["git.pull", "git.sync", "git.branch"]);

function bridged(name: string, h: OpHandler): OpHandler {
  return async (ctx, input) => {
    const o = input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Row) : {};
    const folderId = typeof o["folderId"] === "string" && /^fld_[a-z0-9]+$/.test(o["folderId"]) ? o["folderId"] : undefined;
    if (folderId === undefined) return h(ctx, input);
    const r = repoOf(ctx, folderId);
    if (READS_TREE.has(name) && (name === "git.init" || isRepo(r))) await exclusive(folderId, () => toTree(ctx, r.d.treesDir, r.dir, folderId));
    const out = await h(ctx, input);
    if (CHANGES_TREE.has(name) && isRepo(r)) await exclusive(folderId, () => fromTree(ctx, r.d.treesDir, r.dir, folderId));
    return out;
  };
}

export const opsHandlers = Object.fromEntries(Object.entries(rawHandlers).map(([name, h]) => [name, bridged(name, h as OpHandler)])) as typeof rawHandlers;
