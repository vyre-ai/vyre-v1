// Fake GitHub App behind api.github.com (ARCH 8.5, 10.1). Health is GET /app.
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface GithubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
}

export interface GithubProvider {
  readonly name: "github";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  getApp(): Promise<{ id: number; slug: string; name: string }>;
  listIssues(repo: string): Promise<GithubIssue[]>;
}

export function fakeGithub(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): GithubProvider {
  const calls: SeenCall[] = [];
  const issues = new Map<string, GithubIssue[]>();
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "github.com") && u.pathname === "/app",
      run: () => ({ body: { id: 1, slug: "vyre-fake", name: "Vyre Fake" } }),
    },
    {
      method: "GET",
      match: (u) => hostIs(u, "github.com") && /^\/repos\/[^/]+\/[^/]+\/issues$/.test(u.pathname),
      run: (u) => {
        const repo = u.pathname.split("/").slice(2, 4).join("/");
        return { body: issues.get(repo) ?? [] };
      },
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "github",
    calls,
    fetch,
    async getApp() {
      const res = await fetch("https://api.github.com/app");
      if (res.status !== 200) throw new Error(`github app returned ${res.status}`);
      return JSON.parse(await res.text()) as { id: number; slug: string; name: string };
    },
    async listIssues(repo) {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`);
      if (res.status !== 200) throw new Error(`github issues returned ${res.status}`);
      const body = JSON.parse(await res.text()) as unknown;
      return Array.isArray(body) ? body as GithubIssue[] : [];
    },
  };
}
