// Rewind, the files half (chat gap G36, G37; DESIGN-chat-system item 20). A point is a parentless commit, kept under refs/points, in a shadow git repository that lives OUTSIDE the agent's work folder
// (the sandbox binds only the work folder, so the agent cannot read or rewrite it) with the work folder as its work tree. One is taken as each turn of an agent that works in a folder on this computer starts.
// Going back to one first takes a point of the folder as it is now, so a rewind is itself undone by going back to that one: nothing is lost by pressing it.
//
// What it undoes: the files in the agent's work folder. What it never touches (the Rewind card says so before the person presses): messages in the chat, anything a person or agent sent (email,
// messages, posts), records and tasks, other computers and servers, and files outside the work folder.
// What a point does not hold, and so does not put back (also on the card): files the folder's own .gitignore lists, node_modules, logs, secret files (.env, keys, certificates), and a folder inside the work
// folder that is its own git repository (kept as one entry: git cannot snapshot a repository inside a repository).
// Cost (measured on a build box, modules/engine/tests/checkpoints.measure.ts): a folder of 100 small files, 64 ms; 20,000 files and 2 GB, about 470 ms after the first and 14 s the first time. So a turn
// waits at most WAIT_MS for its point: a slower one finishes in the background, one at a time per folder, and the point is then the folder as it was a moment into the turn.
// Retention: at most KEEP_POINTS per folder and KEEP_MS old; a store over STORE_CAP or the Space's checkpoints over SPACE_CAP lose their oldest points; the disk is never filled by this (MIN_FREE).
import fs from "node:fs";
import path from "node:path";
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import { git, GitError } from "./crew-git.ts";
import { layoutRoots, segmentOf, workFolder } from "./sandbox.ts";

export interface Point {
  sha: string;
  at: number;
  /** What the point was taken for: the turn, or "Before going back". */
  label: string;
  files: number;
}

export const KEEP_POINTS = 30;
export const KEEP_MS = 14 * 24 * 3600_000;
export const STORE_CAP = 3 * 1024 ** 3;
export const SPACE_CAP = 10 * 1024 ** 3;
export const MIN_FREE = 1024 ** 3;
/** How long a turn waits for its point before it goes on and the point finishes in the background. */
export const WAIT_MS = 100;
/** A folder with more files or bytes than this is not kept (a point is a copy on the server's disk), and the look that decides it stops after WALK_MS. All of it runs in the background. */
export const MAX_FILES = 150_000;
export const MAX_BYTES = 8 * 1024 ** 3;
export const WALK_MS = 3_000;

const IDENTITY = ["-c", "user.name=Vyre", "-c", "user.email=checkpoints@vyre.invalid", "-c", "commit.gpgsign=false"];
const EXCLUDES = [
  "node_modules/",
  ".git/",
  "*.log",
  ".DS_Store",
  // secrets are never kept: a point is a copy of the folder on the server's disk
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  ".npmrc",
  ".netrc",
];

async function run(
  gitDir: string,
  workDir: string,
  args: readonly string[],
  what: string,
  env: Record<string, string> = {},
): Promise<string> {
  const r = await git(["--git-dir", gitDir, "--work-tree", workDir, ...IDENTITY, ...args], workDir, env);
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

/** One at a time per store: two turns of two agents never share one, but a slow point and the next turn's must not run git's index lock into each other. */
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(gitDir: string, f: () => Promise<T>): Promise<T> {
  const prev = queues.get(gitDir) ?? Promise.resolve();
  const next = prev.then(f, f);
  const tail = next.catch(() => undefined);
  queues.set(gitDir, tail);
  void tail.then(() => {
    if (queues.get(gitDir) === tail) queues.delete(gitDir);
  });
  return next;
}

const REF = "refs/points";
const refName = (at: number, files: number, n: number): string =>
  `${REF}/${String(at).padStart(15, "0")}-${files}-${String(n).padStart(4, "0")}`;
let counter = 0;

/** One point of the folder as it is now. An unchanged folder still gets a point (the turn's own mark), so every turn can be gone back to. */
export function snapshot(o: { gitDir: string; workDir: string; label: string; now: number }): Promise<Point> {
  return inOrder(o.gitDir, async () => {
    await ready(o.gitDir, o.workDir);
    await run(o.gitDir, o.workDir, ["add", "-A", "--ignore-errors"], "The folder could not be read");
    const tree = (await run(o.gitDir, o.workDir, ["write-tree"], "The folder could not be saved")).trim();
    const files = (await run(o.gitDir, o.workDir, ["ls-files", "--cached"], "The folder could not be listed"))
      .split("\n")
      .filter(Boolean).length;
    const label = o.label.replace(/[\r\n]+/g, " ").slice(0, 200);
    // the time of a point is in its name (refs/points/<ms>-<files>-<n>), not in git's dates
    const sha = (
      await run(o.gitDir, o.workDir, ["commit-tree", tree, "-m", label], "The point could not be saved")
    ).trim();
    await run(
      o.gitDir,
      o.workDir,
      ["update-ref", refName(o.now, files, counter++ % 10_000), sha],
      "The point could not be named",
    );
    return { sha, at: o.now, label, files };
  });
}

/** The points of a folder, newest first. */
export async function points(o: { gitDir: string; workDir: string; limit?: number }): Promise<Point[]> {
  if (!fs.existsSync(path.join(o.gitDir, "HEAD"))) return [];
  const out = await run(
    o.gitDir,
    o.workDir,
    [
      "for-each-ref",
      "--sort=-refname",
      `--count=${o.limit ?? 50}`,
      "--format=%(objectname)\t%(refname)\t%(subject)",
      REF,
    ],
    "The points could not be listed",
  ).catch(() => "");
  const list: Point[] = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [sha, ref, ...rest] = line.split("\t");
    const m = /refs\/points\/(\d+)-(\d+)-\d+$/.exec(ref ?? "");
    if (!sha || !m) continue;
    list.push({ sha, at: Number(m[1]), label: rest.join("\t"), files: Number(m[2]) });
  }
  return list;
}

export interface Restored {
  /** The point taken first, so this rewind can itself be undone. */
  undoPoint: Point;
  /** Files put back as they were (changed or deleted since). */
  restored: number;
  /** Files that did not exist at that point and were removed. */
  removed: number;
}

/** Put the folder back as it was at `sha`, one of this store's points. Takes a point of the present first. Only files of the work folder are touched. */
export async function restore(o: { gitDir: string; workDir: string; sha: string; now: number }): Promise<Restored> {
  if (!/^[0-9a-f]{40}$/.test(o.sha)) throw new GitError("validation.bad_input", "That is not a checkpoint.");
  await ready(o.gitDir, o.workDir);
  // only a point that is still kept: a made-up commit, or one pruned since, is not here
  if (!(await points({ gitDir: o.gitDir, workDir: o.workDir, limit: 1000 })).some((p) => p.sha === o.sha))
    throw new GitError("validation.bad_input", "That point is not here any more.");
  const undoPoint = await snapshot({ gitDir: o.gitDir, workDir: o.workDir, label: "Before going back", now: o.now });
  return inOrder(o.gitDir, async () => {
    // what turns the folder as it is now (the point just taken) into the folder at `sha`: one line per path, ":<mode1> <mode2> <blob1> <blob2> <status>\0<path>\0"
    const raw = (
      await run(
        o.gitDir,
        o.workDir,
        ["diff-tree", "-r", "-z", "--raw", "--no-renames", "--no-abbrev", undoPoint.sha, o.sha],
        "The change could not be read",
      )
    ).split("\0");
    const changes: Array<{ status: string; mode: string; blob: string; file: string }> = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const meta = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/.exec(raw[i] ?? "");
      if (meta && raw[i + 1]) changes.push({ status: meta[5]!, mode: meta[2]!, blob: meta[4]!, file: raw[i + 1]! });
    }
    // Every path below is the work folder's own: nothing is written, replaced or removed through a link. The paths come from git, but the folder is the agent's to arrange as it likes, so each one is
    // walked from the real work folder, one component at a time, and a component that is a link is never entered.
    const base = fs.realpathSync(o.workDir);
    let restored = 0;
    let removed = 0;
    // removals first (a path that is not in the point), so a folder that is about to become a file or a link is empty of them
    for (const c of changes.filter((x) => x.status === "D")) if (removeIn(base, c.file)) removed++;
    for (const c of changes.filter((x) => x.status !== "D")) {
      await writeIn(o.gitDir, o.workDir, base, c.file, c.mode, c.blob);
      restored++;
    }
    return { undoPoint, restored, removed };
  });
}

/** The folder part of a path inside `base`, walked without following links: the real folder it is, or null when a component is a link or not a folder (nothing is removed through it). */
function walkDirs(base: string, rel: string, make: boolean): string | null {
  let at = base;
  const parts = rel.split("/").filter((x) => x !== "" && x !== ".");
  if (parts.some((x) => x === "..")) return null;
  for (const part of parts.slice(0, -1)) {
    const next = path.join(at, part);
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(next);
    } catch {
      st = null;
    }
    if (st?.isDirectory() === true && !st.isSymbolicLink()) {
      at = next;
      continue;
    }
    if (!make) return null; // a link, a file or nothing where a folder should be: nothing is there to remove
    // writing: a link or a file in the way is replaced by a real folder (the link itself is removed, never what it points at)
    if (st !== null) fs.rmSync(next, { recursive: true, force: true });
    fs.mkdirSync(next);
    at = next;
  }
  return path.join(at, parts[parts.length - 1] ?? "");
}

/** Remove one path of the work folder (a file, a link, or a folder of them: a link inside is removed, not followed). True when something was removed. */
function removeIn(base: string, rel: string): boolean {
  const target = walkDirs(base, rel, false);
  if (target === null) return false;
  try {
    fs.lstatSync(target);
  } catch {
    return false;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true }); // rmSync never follows a link it meets
    return true;
  } catch {
    return false; // a path that cannot be removed stays: the rewind says how many it removed
  }
}

/** Put one path back as the point had it: a file with its bytes and its executable bit, or a link as a link. */
async function writeIn(
  gitDir: string,
  workDir: string,
  base: string,
  rel: string,
  mode: string,
  blob: string,
): Promise<void> {
  const target = walkDirs(base, rel, true);
  if (target === null) return;
  const bytes = await blobOf(gitDir, workDir, blob);
  try {
    if (fs.lstatSync(target) !== undefined) fs.rmSync(target, { recursive: true, force: true }); // a folder, file or link where this one goes: gone first, so the write never lands through it
  } catch {
    /* nothing there */
  }
  if (mode === "120000") fs.symlinkSync(bytes.toString("utf8"), target);
  else fs.writeFileSync(target, bytes, { mode: mode === "100755" ? 0o755 : 0o644 });
  if (mode === "100755") fs.chmodSync(target, 0o755);
}

/** The exact bytes of one object (git's own output as a string would lose binary content). */
async function blobOf(gitDir: string, workDir: string, blob: string): Promise<Buffer> {
  if (!/^[0-9a-f]{40,64}$/.test(blob)) throw new GitError("validation.bad_input", "That is not a file of a point.");
  const p = await createLocalLauncher().spawn({
    argv: ["git", "--git-dir", gitDir, "cat-file", "blob", blob],
    cwd: workDir,
    env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  p.endInput();
  const chunks: Buffer[] = [];
  for await (const c of p.stdout) chunks.push(typeof c === "string" ? Buffer.from(c, "binary") : Buffer.from(c));
  const exit = await p.exited;
  if ((exit.code ?? -1) !== 0) throw new GitError("engine.git_failed", "A file of the point could not be read.");
  return Buffer.concat(chunks);
}

// ---- retention ------------------------------------------------------------------------------------------------------------------------------------

const bytesOf = (p: string): number => {
  let n = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      n += e.isDirectory() ? bytesOf(f) : fs.statSync(f).size;
    }
  } catch {
    /* a file that went while counting */
  }
  return n;
};

/** Drop points past the count or age, then the oldest while the store is over its cap (the newest point is always kept). Frees the space. Never throws. */
export async function prune(o: {
  gitDir: string;
  workDir: string;
  now: number;
  keep?: number;
  maxAgeMs?: number;
  cap?: number;
}): Promise<number> {
  try {
    const all = await points({ gitDir: o.gitDir, workDir: o.workDir, limit: 10_000 });
    const keep = o.keep ?? KEEP_POINTS;
    const age = o.maxAgeMs ?? KEEP_MS;
    let drop = all.filter((p, i) => i >= keep || o.now - p.at > age);
    const left = all.filter((p) => !drop.includes(p));
    if (left.length === 0 && all[0]) {
      left.push(all[0]);
      drop = drop.filter((p) => p !== all[0]);
    }
    const cap = o.cap ?? STORE_CAP;
    // over the cap: the older half of what is left goes (the next turn looks again), and the newest stays
    if (left.length > 1 && bytesOf(o.gitDir) > cap)
      for (let n = Math.ceil((left.length - 1) / 2); n > 0; n--) drop.push(left.pop()!);
    if (drop.length === 0) return 0;
    for (const p of drop) {
      const ref = (
        await run(
          o.gitDir,
          o.workDir,
          ["for-each-ref", "--format=%(refname)", "--points-at", p.sha, REF],
          "The point could not be read",
        )
      ).trim();
      for (const r of ref.split("\n").filter(Boolean))
        await run(o.gitDir, o.workDir, ["update-ref", "-d", r], "The point could not be removed");
    }
    await git(["--git-dir", o.gitDir, "gc", "--prune=now", "--quiet"], o.workDir).catch(() => undefined);
    return drop.length;
  } catch {
    return 0;
  }
}

/** Why a folder is not kept, or null: counted without following links, skipping what a point never holds (node_modules, .git), and cut short after `ms`. */
export async function tooBig(
  workDir: string,
  o: { maxFiles?: number; maxBytes?: number; ms?: number } = {},
): Promise<string | null> {
  const maxFiles = o.maxFiles ?? MAX_FILES;
  const maxBytes = o.maxBytes ?? MAX_BYTES;
  const until = Date.now() + (o.ms ?? WALK_MS);
  let files = 0;
  let bytes = 0;
  const stack = [workDir];
  while (stack.length > 0) {
    if (Date.now() > until) return "The folder is too slow to read: no point was saved.";
    const d = stack.pop()!;
    let es: fs.Dirent[] = [];
    try {
      es = await fs.promises.readdir(d, { withFileTypes: true }); // asynchronous: a big folder never holds the thread a turn runs on
    } catch {
      continue;
    }
    for (const e of es) {
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") stack.push(path.join(d, e.name));
        continue;
      }
      files++;
      if (e.isFile()) {
        try {
          bytes += (await fs.promises.lstat(path.join(d, e.name))).size;
        } catch {
          /* gone while counting */
        }
      }
      if (files > maxFiles) return "The folder has too many files to keep: no point was saved.";
      if (bytes > maxBytes) return "The folder is too big to keep: no point was saved.";
    }
  }
  return null;
}

/** The Space's checkpoints folder. */
export const rootOf = (dataDir: string): string => path.join(fs.realpathSync(dataDir), "checkpoints");

/** Where the points of one agent's work folder live: `<dataDir>/checkpoints/<person>/<thread>/<agent>.git`, beside the work folders and never inside one (the sandbox binds only the work folder). */
export function storeOf(dataDir: string, workDir: string): string {
  const root = fs.realpathSync(path.join(dataDir, layoutRoots().work));
  const rel = path.relative(root, workDir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel))
    throw new GitError("validation.bad_input", "That folder is not one of the Space's work folders.");
  return path.join(rootOf(dataDir), `${rel}.git`);
}

/** Every store of the Space, with its size and its newest point's time (from the folder's own time). */
function stores(dataDir: string): Array<{ dir: string; bytes: number; at: number }> {
  const root = rootOf(dataDir);
  const out: Array<{ dir: string; bytes: number; at: number }> = [];
  const walk = (d: string, depth: number): void => {
    let es: fs.Dirent[] = [];
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.endsWith(".git")) out.push({ dir: f, bytes: bytesOf(f), at: fs.statSync(f).mtimeMs });
      else if (depth < 3) walk(f, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** Keep the Space's checkpoints under SPACE_CAP: the store touched longest ago loses its store first (its points go; the next turn starts a new one). Never throws. */
export function pruneSpace(dataDir: string, cap = SPACE_CAP): number {
  try {
    const all = stores(dataDir).sort((a, b) => a.at - b.at);
    let total = all.reduce((n, s) => n + s.bytes, 0);
    let n = 0;
    for (const s of all) {
      if (total <= cap) break;
      fs.rmSync(s.dir, { recursive: true, force: true });
      total -= s.bytes;
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Erase what a thread, an agent or a person owned: their points are copies of their files, so they go with them. */
export function erase(dataDir: string, what: { threadId?: string; agentId?: string; personId?: string }): number {
  const root = (() => {
    try {
      return rootOf(dataDir);
    } catch {
      return null;
    }
  })();
  if (root === null || !fs.existsSync(root)) return 0;
  let n = 0;
  const rm = (p: string): void => {
    fs.rmSync(p, { recursive: true, force: true });
    n++;
  };
  try {
    if (what.personId !== undefined) rm(path.join(root, segmentOf(dataDir, "person", what.personId)));
    for (const person of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      const pd = path.join(root, person);
      if (what.threadId !== undefined) {
        const td = path.join(pd, segmentOf(dataDir, "thread", what.threadId));
        if (fs.existsSync(td)) rm(td);
      }
      if (what.agentId !== undefined && fs.existsSync(pd)) {
        const seg = `${segmentOf(dataDir, "agent", what.agentId)}.git`;
        for (const t of fs.readdirSync(pd)) {
          const a = path.join(pd, t, seg);
          if (fs.existsSync(a)) rm(a);
        }
      }
    }
  } catch {
    /* what could not be removed is reported by the count */
  }
  return n;
}

/**
 * The point taken as an agent's turn starts, labelled with the turn. A turn waits at most WAIT_MS for it; a slower one finishes in the background (and is then pruned). Never stops a turn: a folder that
 * cannot be read, a full disk (less than MIN_FREE left) or a failing git ends as `point: null` with the reason in `why`.
 */
export async function checkpointTurn(o: {
  dataDir: string;
  person: string;
  thread: string;
  agent: string;
  turnId: string;
  /** The message that started the turn: the point is named by it, so the card says what the person had asked. */
  messageId?: string;
  now: number;
  waitMs?: number;
  maxFiles?: number;
  maxBytes?: number;
}): Promise<{ point: Point | null; why?: string; background?: boolean }> {
  try {
    const workDir = workFolder(o.dataDir, o.person, o.thread, o.agent);
    const gitDir = storeOf(o.dataDir, workDir);
    try {
      const s = fs.statfsSync(o.dataDir);
      if (s.bavail * s.bsize < MIN_FREE) return { point: null, why: "The disk is nearly full: no point was saved." };
    } catch {
      /* free space unknown: go on */
    }
    const work = Promise.resolve()
      .then(async () => {
        const why = await tooBig(workDir, {
          ...(o.maxFiles !== undefined ? { maxFiles: o.maxFiles } : {}),
          ...(o.maxBytes !== undefined ? { maxBytes: o.maxBytes } : {}),
        });
        if (why !== null) throw new GitError("validation.bad_input", why);
      })
      .then(() =>
        snapshot({ gitDir, workDir, label: `turn ${o.turnId}${o.messageId ? ` ${o.messageId}` : ""}`, now: o.now }),
      )
      .then(async (p) => {
        await prune({ gitDir, workDir, now: o.now });
        pruneSpace(o.dataDir);
        return p;
      });
    const slow = Symbol("slow");
    const got = await Promise.race([
      work,
      new Promise<typeof slow>((r) => {
        const t = setTimeout(() => r(slow), o.waitMs ?? WAIT_MS);
        (t as { unref?: () => void }).unref?.();
      }),
    ]);
    if (got === slow) {
      work.catch(() => undefined); // it finishes on its own; a failure there is nobody's turn
      return { point: null, background: true };
    }
    return { point: got };
  } catch (e) {
    return { point: null, why: e instanceof Error ? e.message : String(e) };
  }
}
