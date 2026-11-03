// The agents' git repositories on every computer of a Personal Space (lane l-multidevice). A repository is trees/<folderId> (modules/git); its working files come from Files, which the cells and
// blobs already keep in step, so what has to travel is the history: objects and branches. Each computer fetches from each other one it reaches, over the same end-to-end channel:
//   GET  /v1/peers/git/repos              the repositories here and the tip of each branch
//   GET  /v1/peers/git/bundle?repo=&have= a git bundle of every branch, without what the asker already has (`have`: tips it named that exist here too)
// The asker fetches the bundle into refs/peers/<computer>/* (its own namespace, so nothing of its own is touched) and then settles each branch:
//   missing here                     created at their tip
//   the same                         nothing
//   theirs is ahead of ours          fast-forwarded (the checked-out branch only when its working tree is clean)
//   ours is ahead of theirs          kept
//   both moved                       ours stays; theirs is kept beside it as <branch>@<computer>. Nothing is ever force-overwritten.
// A repository only the other computer has is made here with its branches, and its checked-out branch is checked out.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import type { PeerChannel } from "./link.ts";

const REPO_RE = /^[A-Za-z0-9_-]{1,120}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;
const ZERO = "0".repeat(40);

function git(cwd: string, args: string[], o: { input?: Buffer } = {}): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 256 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" } }, (e, stdout, stderr) => {
      resolve({ ok: !e, out: Buffer.from(stdout ?? "").toString("utf8"), err: Buffer.from(stderr ?? "").toString("utf8") });
    });
    if (o.input) p.stdin?.end(o.input);
  });
}

const treesOf = (root: string): string => path.join(root, "trees");
export function reposOf(root: string): string[] {
  let names: fs.Dirent[];
  try { names = fs.readdirSync(treesOf(root), { withFileTypes: true }); } catch { return []; }
  return names.filter((n) => n.isDirectory() && REPO_RE.test(n.name) && fs.existsSync(path.join(treesOf(root), n.name, ".git"))).map((n) => n.name).sort();
}

export async function headsOf(dir: string): Promise<Record<string, string>> {
  const r = await git(dir, ["for-each-ref", "--format=%(refname:strip=2) %(objectname)", "refs/heads"]);
  const out: Record<string, string> = {};
  for (const line of r.out.split("\n")) { const [b, s] = line.trim().split(" "); if (b && s && SHA_RE.test(s)) out[b] = s; }
  return out;
}
const has = async (dir: string, sha: string): Promise<boolean> => (await git(dir, ["cat-file", "-e", `${sha}^{commit}`])).ok;
const ancestor = async (dir: string, a: string, b: string): Promise<boolean> => (await git(dir, ["merge-base", "--is-ancestor", a, b])).ok;
const currentBranch = async (dir: string): Promise<string | null> => { const r = await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]); return r.ok ? r.out.trim() : null; };
const safeName = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 40) || "computer";

// ---- the computer asked

export async function serveGit(root: string, req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const send = (status: number, body: unknown): void => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/v1/peers/git/repos") {
    const repos: { repo: string; heads: Record<string, string>; head: string | null }[] = [];
    for (const repo of reposOf(root)) { const dir = path.join(treesOf(root), repo); repos.push({ repo, heads: await headsOf(dir), head: await currentBranch(dir) }); }
    send(200, { data: { repos } });
    return;
  }
  const repo = url.searchParams.get("repo") ?? "";
  if (!REPO_RE.test(repo) || !reposOf(root).includes(repo)) { send(404, { error: { code: "validation.not_found", message: "No such repository." } }); return; }
  const dir = path.join(treesOf(root), repo);
  const have = (url.searchParams.get("have") ?? "").split(",").filter((s) => SHA_RE.test(s));
  const not: string[] = [];
  for (const s of have) if (await has(dir, s)) not.push(`^${s}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-git-"));
  const file = path.join(tmp, "b.bundle");
  try {
    const r = await git(dir, ["bundle", "create", file, "--branches", ...not]);
    if (!r.ok || !fs.existsSync(file)) { res.writeHead(204, { "cache-control": "no-store" }); res.end(); return; }
    res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---- the computer asking

export interface TreeSyncResult { repos: number; created: string[]; moved: string[]; kept: string[] }

/** Fetch every repository the other computer has and settle its branches here. `peer` names the other computer (its id for the namespace, its name for a branch kept beside ours). */
export async function syncTrees(root: string, ch: PeerChannel, auth: Record<string, string>, peer: { id: string; name: string }): Promise<TreeSyncResult> {
  const out: TreeSyncResult = { repos: 0, created: [], moved: [], kept: [] };
  const list = await ch.request({ method: "GET", path: "/v1/peers/git/repos", headers: auth });
  if (list.status !== 200) return out;
  const ns = `refs/peers/${safeName(peer.id)}`;
  const tag = safeName(peer.name);
  for (const r of list.json<{ data: { repos: { repo: string; heads: Record<string, string>; head: string | null }[] } }>().data.repos) {
    if (!REPO_RE.test(r.repo)) continue;
    const dir = path.join(treesOf(root), r.repo);
    const fresh = !fs.existsSync(path.join(dir, ".git"));
    if (fresh) { fs.mkdirSync(dir, { recursive: true }); await git(dir, ["init", "--quiet"]); }
    const mine = await headsOf(dir);
    // a branch the other computer keeps beside its own (<branch>@<computer>) is that computer's copy of someone else's: it does not travel on
    const theirs = Object.entries(r.heads).filter(([b, s]) => BRANCH_RE.test(b) && !b.includes("..") && !b.includes("@") && SHA_RE.test(s));
    const missing = [];
    for (const [, s] of theirs) if (!(await has(dir, s))) missing.push(s);
    if (missing.length) {
      const b = await ch.request({ method: "GET", path: `/v1/peers/git/bundle?repo=${encodeURIComponent(r.repo)}&have=${Object.values(mine).join(",")}`, headers: auth, timeoutMs: 5 * 60_000 });
      if (b.status === 200 && b.body.length) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-git-"));
        try {
          const file = path.join(tmp, "b.bundle");
          fs.writeFileSync(file, b.body);
          // into this computer's own namespace for the other one: no branch of ours is touched by the fetch
          await git(dir, ["fetch", "--quiet", "--no-tags", file, `+refs/heads/*:${ns}/*`]);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      }
    }
    out.repos++;
    const checked = await currentBranch(dir);
    for (const [branch, sha] of theirs) {
      if (!(await has(dir, sha))) continue;
      const local = mine[branch];
      if (local === sha) continue;
      if (local === undefined) {
        if ((await git(dir, ["update-ref", `refs/heads/${branch}`, sha, ZERO])).ok) out.created.push(`${r.repo}:${branch}`);
        continue;
      }
      if (await ancestor(dir, sha, local)) continue;   // ours is ahead
      if (await ancestor(dir, local, sha)) {
        // theirs is ahead: a fast-forward, the checked-out branch only when nothing in its working tree is uncommitted
        if (branch === checked) {
          const clean = (await git(dir, ["status", "--porcelain", "--untracked-files=no"])).out.trim() === "";
          if (clean && (await git(dir, ["merge", "--ff-only", "--quiet", sha])).ok) { out.moved.push(`${r.repo}:${branch}`); continue; }
        } else if ((await git(dir, ["update-ref", `refs/heads/${branch}`, sha, local])).ok) { out.moved.push(`${r.repo}:${branch}`); continue; }
      }
      // both moved (or ours could not be moved): theirs is kept beside ours, never over it
      const beside = `${branch}@${tag}`;
      const prev = (await headsOf(dir))[beside];
      if (prev === sha) continue;
      if (prev === undefined ? (await git(dir, ["update-ref", `refs/heads/${beside}`, sha, ZERO])).ok : (await ancestor(dir, prev, sha)) && (await git(dir, ["update-ref", `refs/heads/${beside}`, sha, prev])).ok) out.kept.push(`${r.repo}:${beside}`);
    }
    if (fresh && r.head && BRANCH_RE.test(r.head) && (await headsOf(dir))[r.head]) {
      await git(dir, ["symbolic-ref", "HEAD", `refs/heads/${r.head}`]);
      await git(dir, ["reset", "--quiet", "--hard", "HEAD"]);
    }
  }
  return out;
}
