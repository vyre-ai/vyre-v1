// Rewind, the files half (chat gap G36, G37; DESIGN-chat-system item 20). A checkpoint is a commit in a shadow git repository that lives OUTSIDE the agent's work folder (the agent cannot rewrite it) with the
// work folder as its work tree. One is taken at the start of every turn of an agent that works in a folder on this computer. Going back to one first takes a checkpoint of the folder as it is now, so
// a rewind is itself undone by going back to that one: nothing is lost by pressing it.
//
// What it undoes: the files in the agent's work folder. What it never touches (the Rewind card says so before the person presses): messages in the chat, anything a person or agent sent (email,
// messages, posts), records and tasks, other computers and servers, and files outside the work folder. A folder inside the work folder that is its own git repository is kept as one entry
// (git cannot snapshot a repository inside a repository), so edits inside such a project are not rewound by this. Files the folder's own .gitignore names, node_modules and logs are not kept.
import fs from "node:fs";
import path from "node:path";
import { git, GitError } from "./crew-git.ts";

export interface Point {
  sha: string;
  at: number;
  /** What the point was taken for: the turn, or "before a rewind". */
  label: string;
  files: number;
}

const IDENTITY = ["-c", "user.name=Vyre", "-c", "user.email=checkpoints@vyre.invalid", "-c", "commit.gpgsign=false"];
const EXCLUDES = ["node_modules/", ".git/", "*.log", ".DS_Store"];

async function run(gitDir: string, workDir: string, args: readonly string[], what: string): Promise<string> {
  const r = await git(["--git-dir", gitDir, "--work-tree", workDir, ...IDENTITY, ...args], workDir);
  if (r.code !== 0)
    throw new GitError(
      "engine.git_failed",
      `${what}: ${(r.err || r.out).trim().split("\n").slice(-2).join(" ").slice(0, 300) || `git exited ${r.code}`}`,
    );
  return r.out;
}

async function ready(gitDir: string, workDir: string): Promise<void> {
  if (!path.isAbsolute(gitDir) || !path.isAbsolute(workDir))
    throw new GitError("validation.bad_input", "Checkpoints need absolute folders.");
  const inside = path.relative(workDir, gitDir);
  if (!inside.startsWith("..") && !path.isAbsolute(inside))
    throw new GitError("validation.bad_input", "The checkpoint store cannot live inside the folder it watches.");
  if (!fs.existsSync(workDir)) throw new GitError("validation.bad_input", "The work folder is not on this computer.");
  if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
    fs.mkdirSync(gitDir, { recursive: true });
    const r = await git(["init", "--quiet", "--bare", gitDir], workDir);
    if (r.code !== 0) throw new GitError("engine.git_failed", "The checkpoint store could not be made.");
    fs.mkdirSync(path.join(gitDir, "info"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "info", "exclude"), `${EXCLUDES.join("\n")}\n`);
  }
}

/** One checkpoint of the folder as it is now. An unchanged folder still gets a point (the turn's own mark), so every turn can be gone back to. */
export async function snapshot(o: { gitDir: string; workDir: string; label: string; now: number }): Promise<Point> {
  await ready(o.gitDir, o.workDir);
  await run(o.gitDir, o.workDir, ["add", "-A", "--ignore-errors"], "The folder could not be read");
  const label = o.label.replace(/[\r\n]+/g, " ").slice(0, 200);
  await run(
    o.gitDir,
    o.workDir,
    ["commit", "--quiet", "--allow-empty", "--date", `${Math.floor(o.now / 1000)} +0000`, "-m", label],
    "The checkpoint could not be saved",
  );
  const sha = (await run(o.gitDir, o.workDir, ["rev-parse", "HEAD"], "The checkpoint was not found")).trim();
  const files = (
    await run(o.gitDir, o.workDir, ["ls-tree", "-r", "--name-only", sha], "The checkpoint could not be read")
  )
    .split("\n")
    .filter(Boolean).length;
  return { sha, at: o.now, label, files };
}

/** The checkpoints of a folder, newest first. */
export async function points(o: { gitDir: string; workDir: string; limit?: number }): Promise<Point[]> {
  if (!fs.existsSync(path.join(o.gitDir, "HEAD"))) return [];
  const out = await run(
    o.gitDir,
    o.workDir,
    ["log", `--max-count=${o.limit ?? 50}`, "--format=%H%x09%at%x09%s"],
    "The checkpoints could not be listed",
  ).catch(() => "");
  const list: Point[] = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [sha, at, ...rest] = line.split("\t");
    if (!sha || !at) continue;
    const files = (
      await run(o.gitDir, o.workDir, ["ls-tree", "-r", "--name-only", sha], "The checkpoint could not be read")
    )
      .split("\n")
      .filter(Boolean).length;
    list.push({ sha, at: Number(at) * 1000, label: rest.join("\t"), files });
  }
  return list;
}

export interface Restored {
  /** The checkpoint taken first, so this rewind can itself be undone. */
  undoPoint: Point;
  /** Files put back as they were (changed or deleted since). */
  restored: number;
  /** Files that did not exist at that point and were removed. */
  removed: number;
}

/** Put the folder back as it was at `sha`. Takes a checkpoint of the present first. Only files of the work folder are touched. */
export async function restore(o: { gitDir: string; workDir: string; sha: string; now: number }): Promise<Restored> {
  if (!/^[0-9a-f]{40}$/.test(o.sha)) throw new GitError("validation.bad_input", "That is not a checkpoint.");
  await ready(o.gitDir, o.workDir);
  const known = await git(["--git-dir", o.gitDir, "cat-file", "-e", `${o.sha}^{commit}`], o.workDir);
  if (known.code !== 0) throw new GitError("validation.bad_input", "That checkpoint is not here.");
  const undoPoint = await snapshot({ gitDir: o.gitDir, workDir: o.workDir, label: "Before going back", now: o.now });
  const diff = (
    await run(
      o.gitDir,
      o.workDir,
      ["diff", "--name-status", "-z", o.sha, undoPoint.sha],
      "The change could not be read",
    )
  ).split("\0");
  let restored = 0;
  let removed = 0;
  const gone: string[] = [];
  for (let i = 0; i + 1 < diff.length; i += 2) {
    const status = diff[i]!;
    const file = diff[i + 1]!;
    if (status === "A")
      gone.push(file); // added since the point: it was not there then
    else restored++;
  }
  // put back what changed or was deleted; the paths come from git, never from the caller
  await run(o.gitDir, o.workDir, ["checkout", "--force", o.sha, "--", "."], "The files could not be put back");
  for (const file of gone) {
    const abs = path.resolve(o.workDir, file);
    if (path.relative(o.workDir, abs).startsWith("..")) continue;
    try {
      fs.rmSync(abs, { force: true });
      removed++;
    } catch {
      /* a file that cannot be removed stays: the rewind says how many it removed */
    }
  }
  return { undoPoint, restored, removed };
}
