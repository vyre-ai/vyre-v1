// GitHub for a CLI engine's session (lane l-ci-runners, then l-hooks-gitproxy): Claude Code, Codex and Grok push and fetch through the Space's own git address, with a proxy token that lives in the process's environment
// and ends with it. No GitHub token ever reaches the process. The Space decides each push under the person's own settings: a branch goes through, the default branch waits for the person's OK. A person with no connected
// GitHub, or a chat with no linked repository, gets nothing.
// DECISION: git reads the helper from GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n, so nothing is written to the work folder's config and nothing outlives the process.
import type { LaunchSpec } from "../../agent/src/drivers/cli/types.ts";
import fs from "node:fs";
import path from "node:path";
import { heldSecrets, holdSecret } from "../../agent/src/drivers/cli/redact.ts";

export interface GithubSessionPort {
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
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

/** What a session gets to push and fetch through the Space (host/src/seams/git-proxy.ts). */
export interface GitProxyPort {
  mint(s: { person: string; agentId?: string; threadId: string; repos: readonly string[]; via?: "address" | "socket" }): { token: string; expiresAt: number };
  revoke(token: string): void;
  /** The address the session reaches this Space at, no trailing slash. */
  base(): string;
  /** The git address answered inside a walled engine's egress proxy, so a Space that is reachable only on its own loopback works the same as any other. */
  serve(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean;
}

/** The name a walled engine's git uses for the Space: the egress proxy answers it itself (sandbox/src/egress.ts LocalRoute) and it is never looked up. */
export const GIT_LOCAL_HOST = "vyre-git.invalid";

/**
 * The environment a session gets, or empty. Never throws: GitHub missing never stops a turn.
 * DECISION: the session holds no GitHub token, not in its environment, not in a file. It holds a proxy token that only the Space's git address honours (git-proxy.ts); the Space makes a GitHub token for
 *   one request at a time, under the person's own settings. git is sent there by url.<space>/git/github/.insteadOf and reads the proxy token from VYRE_GIT_TOKEN through a credential helper.
 * `end` revokes the proxy token; call it when the process ends.
 */
export async function githubEnv(port: GithubSessionPort & { git?: GitProxyPort }, person: string, threadId: string, agentId?: string, via: "address" | "socket" = "address"): Promise<{ env: Record<string, string>; end(): void }> {
  const none = { env: {}, end: () => undefined };
  if (!port.git || (via === "address" && !/^https?:\/\//.test(port.git.base()))) return none;
  const repos = await reposOfThread(port.call, person, threadId);
  if (repos.length === 0) return none;
  try {
    const me = (await port.call("github.me.status", {}, person)) as { connected?: boolean; needsReconnect?: boolean };
    if (!me.connected || me.needsReconnect) return none;
  } catch { return none; }
  let minted: { token: string; expiresAt: number };
  try { minted = port.git.mint({ person, ...(agentId ? { agentId } : {}), threadId, repos, via }); }
  catch (e) { port.log?.("github: a session gets no git address", { error: e instanceof Error ? e.message : String(e) }); return none; }
  // whatever the process writes back is cleaned of this token, until the token ends (agent/src/drivers/cli/redact.ts)
  holdSecret(minted.token, minted.expiresAt + 5 * 60_000);
  // "socket": the engine is behind the wall and reaches the Space only through the wall's proxy, which answers this name itself; "address": the engine can reach the Space's own address
  const base = via === "socket" ? `http://${GIT_LOCAL_HOST}/git/github/` : `${port.git.base()}/git/github/`;
  const pairs: Array<[string, string]> = [
    [`url.${base}.insteadOf`, "https://github.com/"],
    [`credential.${base}.helper`, ""],
    [`credential.${base}.helper`, '!f() { echo username=vyre; echo "password=$VYRE_GIT_TOKEN"; }; f'],
  ];
  const env: Record<string, string> = { VYRE_GIT_TOKEN: minted.token, GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], n) => { env[`GIT_CONFIG_KEY_${n}`] = k; env[`GIT_CONFIG_VALUE_${n}`] = v; });
  return { env, end: () => port.git!.revoke(minted.token) };
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
