// GitHub for a CLI engine's session (lane l-ci-runners): Claude Code, Codex and Grok get GH_TOKEN, GITHUB_TOKEN and a git credential helper for the turn that starts them, and for that process only. The token comes from the
// one broker (github.session_env), as the person whose turn it is, narrowed to the repositories of the chat's project and to the kinds of use the person lets run without asking. It reaches the process in its environment
// (never a file, never the command line, never a Vault item) and is gone when the process ends. A person with no connected GitHub, a chat with no linked repository, or a policy that asks first gets nothing.
// DECISION: git reads the helper from GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n, so nothing is written to the work folder's config and nothing outlives the process.
import type { LaunchSpec } from "../../agent/src/drivers/cli/types.ts";

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
