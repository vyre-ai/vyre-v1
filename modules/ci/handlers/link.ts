// Which project a repository belongs to (lane l-ci-runners): a project's Files folder is a git repository whose remote is the GitHub address. Read through the projects and git modules, as the caller
// (so a person sees only the projects they are in) or as the host (which sees every project of the Space).
import type { CiCtx, Row } from "../projections.ts";

const REMOTE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;
export const repoFromUrl = (url: string): string | null => { const m = REMOTE.exec(url); return m ? `${m[1]}/${m[2]}`.toLowerCase() : null; };

/** The GitHub repository a project's folder points to (lower case), or null. Throws what projects.get throws when the caller may not see the project. */
export async function repoOfProject(ctx: CiCtx, projectId: string): Promise<string | null> {
  const folderId = ((await ctx.call("projects.get", { projectId })) as { project?: { folderId?: string } }).project?.folderId;
  if (!folderId) return null;
  try {
    const remotes = ((await ctx.call("git.status", { folderId })) as { remotes?: Array<{ name: string; url: string }> }).remotes ?? [];
    for (const r of [...remotes].sort((a, b) => (a.name === "origin" ? -1 : b.name === "origin" ? 1 : 0))) { const repo = repoFromUrl(r.url); if (repo) return repo; }
  } catch { /* a folder that is not a repository has no remote */ }
  return null;
}

const cache = new WeakMap<object, { at: number; byRepo: Map<string, string> }>();
const TTL = 60_000;

/** The project of a repository among the projects the caller sees. Scanned at most once a minute. */
export async function projectOfRepo(ctx: CiCtx, repo: string): Promise<string | null> {
  const want = repo.toLowerCase();
  let c = cache.get(ctx.db);
  if (!c || ctx.now() - c.at > TTL || !c.byRepo.has(want)) {
    const byRepo = new Map<string, string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      let res: { projects?: Row[]; next?: string };
      try { res = (await ctx.call("projects.list", { limit: 100, ...(cursor ? { cursor } : {}) })) as { projects?: Row[]; next?: string }; } catch { break; }
      for (const p of res.projects ?? []) {
        const projectId = String(p["projectId"] ?? "");
        if (!projectId) continue;
        try { const r = await repoOfProject(ctx, projectId); if (r && !byRepo.has(r)) byRepo.set(r, projectId); } catch { /* not readable */ }
      }
      cursor = res.next;
      if (!cursor) break;
    }
    c = { at: ctx.now(), byRepo };
    cache.set(ctx.db, c);
  }
  return c.byRepo.get(want) ?? null;
}
