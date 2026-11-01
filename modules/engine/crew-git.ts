// Crew teammates work in their own copy of the project's repository (DESIGN-crew.md, step 1). The copy is a plain `git clone --local` made into the teammate thread's work folder, with its own branch: a
// worktree would point its .git back at the person's repository, which the sandbox does not bind, so git could not commit inside it. Everything the agent does stays in that folder until a person
// presses Merge, which fetches the branch back from it (landBranch). git runs on the host through the same launcher the CLI engines use; nothing here talks to a remote.
import fs from "node:fs";
import path from "node:path";
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import type { CliProcess } from "../../agent/src/drivers/cli/types.ts";

export class GitError extends Error {
  readonly code: "engine.git_failed" | "validation.bad_input";
  constructor(code: GitError["code"], message: string) { super(message); this.name = "GitError"; this.code = code; }
}

export interface GitResult { code: number; out: string; err: string }

const GIT_ENV: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

async function collect(p: CliProcess): Promise<GitResult> {
  let out = "";
  for await (const chunk of p.stdout) out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  const exit = await p.exited;
  return { code: exit.code ?? -1, out, err: p.stderrTail() };
}

/** Runs one git command in `cwd`. Never throws for a non-zero exit: the caller reads `code`. A missing git is a GitError. */
export async function git(args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<GitResult> {
  try {
    const p = await createLocalLauncher().spawn({ argv: ["git", ...args], cwd, env: { ...GIT_ENV, ...env } });
    p.endInput();
    return await collect(p);
  } catch (e) { throw new GitError("engine.git_failed", e instanceof Error ? e.message : "git could not start"); }
}

async function must(args: readonly string[], cwd: string, what: string, env: Readonly<Record<string, string>> = {}): Promise<string> {
  const r = await git(args, cwd, env);
  if (r.code !== 0) throw new GitError("engine.git_failed", `${what}: ${(r.err || r.out).trim().split("\n").slice(-2).join(" ").slice(0, 300) || `git exited ${r.code}`}`);
  return r.out;
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;

/** A branch name a person or an agent may ask for: no spaces, no `..`, nothing git would read as an option. */
export function cleanBranch(name: string): string {
  const b = name.trim();
  if (!BRANCH.test(b) || b.includes("..") || b.endsWith("/") || b.endsWith(".lock")) throw new GitError("validation.bad_input", "That is not a branch name.");
  return b;
}

/** The project's repository: an absolute path to a folder that is a git work tree. Answers its current branch. */
export async function repoHead(repo: string): Promise<{ branch: string; sha: string }> {
  if (!path.isAbsolute(repo) || !fs.existsSync(repo)) throw new GitError("validation.bad_input", "The project repository is not a folder on this computer.");
  const inside = await git(["rev-parse", "--is-inside-work-tree"], repo);
  if (inside.code !== 0 || inside.out.trim() !== "true") throw new GitError("validation.bad_input", "The project repository folder is not a git repository.");
  const branch = (await must(["rev-parse", "--abbrev-ref", "HEAD"], repo, "reading the branch")).trim();
  const sha = (await must(["rev-parse", "HEAD"], repo, "reading the commit")).trim();
  return { branch, sha };
}

export interface CrewIdentity { name: string; email: string }

const making = new Map<string, Promise<{ created: boolean }>>();

/**
 * Makes `dest` a clone of `repo` on a new branch `branch` started from `base`. Idempotent and safe to call twice at once: the copy is made beside `dest` and moved into place in one step, so anyone who
 * sees a `.git` in `dest` sees a finished copy, and a second caller waits for the first. A folder that already holds the clone is left as it is (the teammate's work is in it), so a restart or a second
 * open of the thread changes nothing. `dest` must be empty or absent the first time.
 */
export function prepareClone(o: { repo: string; dest: string; branch: string; base: string; ident: CrewIdentity }): Promise<{ created: boolean }> {
  const running = making.get(o.dest);
  if (running) return running.then(() => ({ created: false }));
  const p = makeClone(o).finally(() => making.delete(o.dest));
  making.set(o.dest, p);
  return p;
}

async function makeClone(o: { repo: string; dest: string; branch: string; base: string; ident: CrewIdentity }): Promise<{ created: boolean }> {
  const branch = cleanBranch(o.branch);
  const base = cleanBranch(o.base);
  if (fs.existsSync(path.join(o.dest, ".git"))) return { created: false };
  fs.mkdirSync(o.dest, { recursive: true });
  if (fs.readdirSync(o.dest).length > 0) throw new GitError("engine.git_failed", "The teammate's folder already holds files that are not a copy of the repository.");
  const tmp = `${o.dest}.crew-${process.pid}-${Date.now().toString(36)}`;
  try {
    await must(["clone", "--quiet", "--local", "--no-checkout", o.repo, tmp], path.dirname(o.dest), "copying the repository");
    await must(["checkout", "--quiet", "-b", branch, `origin/${base}`], tmp, `starting ${branch} from ${base}`);
    // `base` stays as a local name for the commit the work started from, so the summary still has something to compare with once the origin is gone
    await must(["branch", "--quiet", "--force", base, `origin/${base}`], tmp, `keeping ${base}`);
    await must(["config", "user.name", o.ident.name], tmp, "setting the author");
    await must(["config", "user.email", o.ident.email], tmp, "setting the author");
    // the clone is the teammate's alone: what it must not push anywhere is a remote it cannot reach, so the origin is removed once the branch exists
    await must(["remote", "remove", "origin"], tmp, "closing the copy off");
    fs.rmSync(o.dest, { recursive: true, force: true });
    fs.renameSync(tmp, o.dest);
    return { created: true };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

export interface CrewSummary {
  branch: string; base: string; commits: Array<{ sha: string; subject: string }>; files: Array<{ path: string; added: number; deleted: number }>; dirty: boolean; ahead: number;
}

/** What the teammate changed relative to the commit it started from: commits, files with counts, and whether anything is left uncommitted. */
export async function summarize(dest: string, base: string): Promise<CrewSummary> {
  const branch = (await must(["rev-parse", "--abbrev-ref", "HEAD"], dest, "reading the branch")).trim();
  const log = (await must(["log", "--format=%h%x09%s", `${base}..HEAD`], dest, "reading the commits")).split("\n").filter(Boolean).slice(0, 50)
    .map((l) => { const [sha = "", ...rest] = l.split("\t"); return { sha, subject: rest.join("\t") }; });
  const num = (await must(["diff", "--numstat", `${base}...HEAD`], dest, "reading the changes")).split("\n").filter(Boolean).slice(0, 200)
    .map((l) => { const [a = "0", d = "0", ...p] = l.split("\t"); return { path: p.join("\t"), added: Number(a) || 0, deleted: Number(d) || 0 }; });
  const dirty = (await must(["status", "--porcelain"], dest, "reading the state")).trim() !== "";
  const ahead = Number((await must(["rev-list", "--count", `${base}..HEAD`], dest, "counting commits")).trim()) || 0;
  return { branch, base, commits: log, files: num, dirty, ahead };
}

/** Commits whatever the teammate left uncommitted, so a finished turn never loses work. Answers true when it made a commit. */
export async function commitLeftovers(dest: string, message: string): Promise<boolean> {
  if ((await must(["status", "--porcelain"], dest, "reading the state")).trim() === "") return false;
  await must(["add", "-A"], dest, "staging the changes");
  await must(["commit", "--quiet", "-m", message], dest, "saving the changes");
  return true;
}

/**
 * Lands the teammate's branch in the project repository: the branch is fetched from the clone as `crew/<branch>` and, when the repository is on `base` with nothing uncommitted, merged with a merge commit.
 * Otherwise the branch is left there for a person to merge. A conflict is undone, never left half way.
 */
export async function landBranch(o: { repo: string; clone: string; branch: string; base: string }): Promise<{ landed: boolean; ref: string; note?: string }> {
  const branch = cleanBranch(o.branch);
  const ref = `crew/${branch.replace(/^crew\//, "")}`;
  await must(["fetch", "--quiet", o.clone, `+${branch}:refs/heads/${ref}`], o.repo, "bringing the branch back");
  const head = await repoHead(o.repo);
  const clean = (await must(["status", "--porcelain"], o.repo, "reading the repository state")).trim() === "";
  if (head.branch !== o.base) return { landed: false, ref, note: `The repository is on ${head.branch}, not ${o.base}. The work is on ${ref}.` };
  if (!clean) return { landed: false, ref, note: `The repository has uncommitted changes. The work is on ${ref}.` };
  const merged = await git(["merge", "--no-ff", "--no-edit", "-m", `Merge ${ref}`, ref], o.repo, { GIT_AUTHOR_NAME: "Vyre", GIT_AUTHOR_EMAIL: "vyre@invalid", GIT_COMMITTER_NAME: "Vyre", GIT_COMMITTER_EMAIL: "vyre@invalid" });
  if (merged.code === 0) return { landed: true, ref };
  await git(["merge", "--abort"], o.repo);
  return { landed: false, ref, note: `The branch does not merge cleanly into ${o.base}. The work is on ${ref}.` };
}

/** Pushes the base branch of the project repository to its origin, from the host, with the person's own git setup. A repository with no origin says so and changes nothing. */
export async function pushBase(o: { repo: string; base: string }): Promise<{ pushed: boolean; remote?: string; note?: string }> {
  const base = cleanBranch(o.base);
  const url = await git(["remote", "get-url", "origin"], o.repo);
  if (url.code !== 0 || url.out.trim() === "") return { pushed: false, note: "The project repository has no remote called origin." };
  const out = await git(["push", "--quiet", "origin", base], o.repo);
  if (out.code !== 0) return { pushed: false, remote: url.out.trim(), note: `The remote did not take it: ${(out.err || out.out).trim().split("\n").slice(-2).join(" ").slice(0, 240)}` };
  return { pushed: true, remote: url.out.trim() };
}

/**
 * What the repository says about a teammate's branch, however it got there: how far ahead of its start the branch is, whether its tip is now part of the base branch (the lead merged it, a person did it in a
 * terminal, anything), and whether the remote's copy of the base holds it. Read from the repository, never from a flag a button set. Null when the teammate's copy is gone. A squash or a rebase leaves the
 * original commits out of the base and reads as not merged.
 */
export async function branchFacts(o: { repo: string; clone: string; branch: string; base: string }): Promise<{ ahead: number; merged: boolean; pushed: boolean } | null> {
  if (!fs.existsSync(o.clone) || !fs.existsSync(o.repo)) return null;
  const tip = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${cleanBranch(o.branch)}`], o.clone);
  if (tip.code !== 0) return null;
  const sha = tip.out.trim();
  const ahead = Number((await git(["rev-list", "--count", `${cleanBranch(o.base)}..${sha}`], o.clone)).out.trim()) || 0;
  if (ahead === 0) return { ahead: 0, merged: false, pushed: false };
  if ((await git(["cat-file", "-e", `${sha}^{commit}`], o.repo)).code !== 0) return { ahead, merged: false, pushed: false };
  const merged = (await git(["merge-base", "--is-ancestor", sha, cleanBranch(o.base)], o.repo)).code === 0;
  const pushed = merged && (await git(["merge-base", "--is-ancestor", sha, `origin/${cleanBranch(o.base)}`], o.repo)).code === 0;
  return { ahead, merged, pushed };
}
