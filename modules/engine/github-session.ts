// GitHub for a CLI engine's session (lane l-ci-runners): Claude Code, Codex and Grok get GH_TOKEN, GITHUB_TOKEN and a git credential helper for the turn that starts them, and for that process only. The token comes from the
// one broker (github.session_env), as the person whose turn it is, narrowed to the repositories of the chat's project and to the kinds of use the person lets run without asking. It reaches the process in its environment
// (never a file, never the command line, never a Vault item) and is gone when the process ends. A person with no connected GitHub, a chat with no linked repository, or a policy that asks first gets nothing.
// DECISION: git reads the helper from GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n, so nothing is written to the work folder's config and nothing outlives the process.
import type { LaunchSpec } from "../../agent/src/drivers/cli/types.ts";
import fs from "node:fs";
import path from "node:path";
import { heldSecrets, holdSecret } from "../../agent/src/drivers/cli/redact.ts";

export interface GithubSessionPort {
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** The token behind a filler handle, once; null when it is gone. The host owns the filler. */
  fill(handle: string): string | null;
  log?(msg: string, attrs?: Record<string, unknown>): void;
}

const REMOTE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;

/** The GitHub repositories of the project a chat belongs to (the remotes of its Files folder), or none. */
export async function reposOfThread(call: GithubSessionPort["call"], person: string, threadId: string): Promise<string[]> {
  try {
    const t = (await call("threads.get", { threadId }, person)) as { thread?: { scopeType?: string; scopeId?: string } };
    if (t.thread?.scopeType !== "project" || !t.thread.scopeId) return [];
    const folderId = ((await call("projects.get", { projectId: t.thread.scopeId }, person)) as { project?: { folderId?: string } }).project?.folderId;
    if (!folderId) return [];
    const remotes = ((await call("git.status", { folderId }, person)) as { remotes?: Array<{ url: string }> }).remotes ?? [];
    return [...new Set(remotes.map((r) => REMOTE.exec(r.url)).filter((m): m is RegExpExecArray => m !== null).map((m) => `${m[1]}/${m[2]}`))].slice(0, 20);
  } catch { return []; }
}

/** The environment a session gets, or empty. Never throws: GitHub missing never stops a turn. */
export async function githubEnv(port: GithubSessionPort, person: string, threadId: string): Promise<Record<string, string>> {
  const repos = await reposOfThread(port.call, person, threadId);
  if (repos.length === 0) return {};
  let got: { env?: Record<string, string>; gitConfig?: string[] };
  try { got = (await port.call("github.session_env", { repos, consumer: "session.engine" }, person)) as typeof got; }
  catch (e) { port.log?.("github: a session gets no GitHub token", { code: (e as { error?: { code?: string } })?.error?.code ?? "error" }); return {}; }
  const handle = got.env?.["GH_TOKEN"];
  const token = handle ? port.fill(handle) : null;
  if (!token) return {};
  // whatever the process writes back is cleaned of this token, until the token ends (agent/src/drivers/cli/redact.ts)
  holdSecret(token, Number((got as { expiresAt?: number }).expiresAt ?? 0) + 5 * 60_000 || Date.now() + 65 * 60_000);
  const out: Record<string, string> = { GH_TOKEN: token, GITHUB_TOKEN: token };
  const pairs = (got.gitConfig ?? []).map((l) => { const i = l.indexOf("="); return i > 0 ? [l.slice(0, i), l.slice(i + 1)] as const : null; }).filter((p): p is readonly [string, string] => p !== null);
  out["GIT_CONFIG_COUNT"] = String(pairs.length);
  pairs.forEach(([k, v], n) => { out[`GIT_CONFIG_KEY_${n}`] = k; out[`GIT_CONFIG_VALUE_${n}`] = v; });
  return out;
}

/** The spawn with GitHub in its environment, set last so nothing filled before it can name another. */
export function withGithub(spec: LaunchSpec, env: Record<string, string>): LaunchSpec {
  return Object.keys(env).length === 0 ? spec : { ...spec, env: { ...spec.env, ...env } };
}

const SKIP = new Set(["node_modules", ".cache"]);
const MAX_FILE = 2 * 1024 * 1024;

/**
 * Take every held secret (the GitHub token a session was handed) out of the files a session wrote: a script that saved its environment, a remote added with the token in its address (.git/config), a log. It
 * walks the folder, text files up to 2 MB, and replaces the token with [token]. Run when the engine's process ends and before a crew teammate's leftovers are committed, so a token can never be committed or pushed.
 * Returns the files it changed. Never throws: a folder that is gone has nothing to clean.
 */
export function redactTree(dir: string, secrets: readonly string[] = heldSecrets()): string[] {
  const changed: string[] = [];
  if (secrets.length === 0) return changed;
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 12 && !SKIP.has(e.name)) walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      try {
        if (fs.statSync(full).size > MAX_FILE) continue;
        const buf = fs.readFileSync(full);
        if (buf.includes(0)) continue;   // binary
        let text = buf.toString("utf8");
        let hit = false;
        for (const s of secrets) if (text.includes(s)) { text = text.split(s).join("[token]"); hit = true; }
        if (hit) { fs.writeFileSync(full, text); changed.push(full); }
      } catch { /* a file that cannot be read or written is left */ }
    }
  };
  walk(dir, 0);
  return changed;
}
