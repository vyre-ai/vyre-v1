// Test harness for the github handlers: an in-memory database, a recording ctx, a scripted GitHub (recorded responses matched by method and path, no socket is opened), a fake
// host seam (the App JWT is a counter, the filler remembers what it was given) and scripted stand-ins for the capabilities this module calls (records.get, records.query,
// records.update, tasks.create). Every call to another capability is checked against its frozen input schema, as the invoke pipeline would. The recorded bodies follow GitHub's
// REST documentation as of the recording; live-account proof waits on the owner's accounts (lead ruling 15), until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { API, setGithubHost } from "../projections.ts";
import type { GithubCtx, GithubHost, Json } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;                    // 2025-10-09T08:53:20Z
export const WEBHOOK_SECRET = "whsec_gh_not_real";
export const HOUR = 3_600_000;
export const MIN = 60_000;
export const INSTALL = 9001;
const hourLater = (from: number): string => new Date(from + HOUR).toISOString();

export const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const pr = (over: Json = {}): Json => ({
  number: 7, state: "open", title: "Fix the intake form", draft: false, merged_at: null, html_url: "https://github.com/vyre-ai/website/pull/7", body: "Fixes the spacing.",
  user: { login: "agent-scout" }, head: { ref: "fix/intake", sha: SHA }, base: { ref: "main", repo: { full_name: "vyre-ai/website" } },
  labels: [{ name: "bug" }, { name: "needs-review" }], assignees: [{ login: "omar" }], additions: 12, deletions: 3, changed_files: 2, ...over,
});

export const RECORDED = {
  conversion: {
    id: 424242, slug: "vyre-abc123", name: "Vyre abc123", client_id: "Iv1.clientid", client_secret: "client_secret_not_real", webhook_secret: "hook_secret_from_github",
    pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAnotarealkey\n-----END RSA PRIVATE KEY-----\n", permissions: { contents: "write", issues: "write", metadata: "read", pull_requests: "write", checks: "read" },
    events: ["push", "pull_request", "issues", "check_run", "workflow_run"], html_url: "https://github.com/apps/vyre-abc123",
  },
  app: { id: 424242, slug: "vyre-abc123", name: "Vyre abc123", permissions: { contents: "write", metadata: "read", pull_requests: "write" }, events: ["push", "pull_request"] },
  installations: [{ id: INSTALL, account: { login: "vyre-ai" }, repository_selection: "all" }],
  installationsTwo: [{ id: INSTALL, account: { login: "vyre-ai" }, repository_selection: "all" }, { id: 9002, account: { login: "other-org" }, repository_selection: "selected" }],
  repoInstallation: { id: INSTALL, account: { login: "vyre-ai" } },
  repos: {
    total_count: 3,
    repositories: [
      { full_name: "vyre-ai/website", private: false, default_branch: "main", html_url: "https://github.com/vyre-ai/website" },
      { full_name: "vyre-ai/vyre", private: true, default_branch: "trunk", html_url: "https://github.com/vyre-ai/vyre" },
      { full_name: "vyre-ai/docs", private: false, default_branch: "main", html_url: "https://github.com/vyre-ai/docs" },
    ],
  },
  repo: { full_name: "vyre-ai/website", private: false, default_branch: "main", html_url: "https://github.com/vyre-ai/website", description: "The firm site" },
  branches: [{ name: "main", commit: { sha: SHA }, protected: true }, { name: "fix/intake", commit: { sha: "ffffffffffffffffffffffffffffffffffffffff" }, protected: false }],
  pr: pr(),
  prMerged: pr({ state: "closed", merged_at: "2025-10-09T08:00:00Z" }),
  prClosed: pr({ state: "closed" }),
  runsPassing: { total_count: 2, check_runs: [{ id: 1, name: "build", status: "completed", conclusion: "success", html_url: "https://github.com/x/runs/1", check_suite: { id: 55 } }, { id: 2, name: "lint", status: "completed", conclusion: "neutral", check_suite: { id: 55 } }] },
  runsFailing: { total_count: 2, check_runs: [{ id: 1, name: "build", status: "completed", conclusion: "failure", html_url: "https://github.com/x/runs/1", check_suite: { id: 55 } }, { id: 2, name: "lint", status: "completed", conclusion: "success", check_suite: { id: 56 } }] },
  runsPending: { total_count: 2, check_runs: [{ id: 1, name: "build", status: "in_progress", conclusion: null, check_suite: { id: 55 } }, { id: 2, name: "lint", status: "completed", conclusion: "success", check_suite: { id: 56 } }] },
  runsNone: { total_count: 0, check_runs: [] },
  files: [
    { filename: "src/form.ts", status: "modified", additions: 10, deletions: 3, patch: "@@ -1 +1 @@\n-a\n+b" },
    { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
  ],
  diff: "diff --git a/src/form.ts b/src/form.ts\n--- a/src/form.ts\n+++ b/src/form.ts\n@@ -1 +1 @@\n-a\n+b\n",
  issue: {
    number: 12, state: "open", title: "The intake form loses the phone number", body: "Steps: ...", html_url: "https://github.com/vyre-ai/website/issues/12", user: { login: "pat" },
    labels: [{ name: "bug" }], assignees: [],
  },
  issueIsPr: { number: 7, state: "open", title: "A pull request", html_url: "https://github.com/vyre-ai/website/pull/7", user: { login: "pat" }, labels: [], assignees: [], pull_request: { url: "x" } },
  comment: { id: 98765, body: "ok" },
  merged: { sha: "9999999999999999999999999999999999999999", merged: true, message: "Pull Request successfully merged" },
  notMergeable: { message: "Pull Request is not mergeable" },
  rateLimited: { message: "API rate limit exceeded for installation ID 9001." },
  forbidden: { message: "Resource not accessible by integration" },
} as const;

export interface Reply { status: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: Json | null; text: string }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }

export interface FakeRecord { type: string; id: string; fields: Record<string, unknown> }

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const stored: { name: string; value: string }[][] = [];
  const fillers: { token: string; expiresAt: number; repo?: string }[] = [];
  const scripted = new Map<string, Reply[]>();
  const records = new Map<string, FakeRecord>();
  let clock = NOW;
  let jwts = 0;
  let tokenSeq = 0;
  let tasks = 0;
  const down = new Set<string>();

  const host: GithubHost = {
    async secret(_ctx, handle) {
      if (handle === "#GitHub_App_Webhook_Secret") return WEBHOOK_SECRET;
      throw new Error(`unexpected secret ${handle}`);
    },
    async appJwt() {
      return `jwt_${++jwts}`;
    },
    async storeSecrets(_ctx, items) {
      stored.push(items.map((i) => ({ ...i })));
    },
    async fillerHandle(_ctx, a) {
      fillers.push({ ...a });
      return `#GitHub_Filler_${fillers.length}`;
    },
    async publicUrl() {
      return "https://space.vyre.test/";
    },
  };
  setGithubHost(host);

  const ctx: GithubCtx = {
    space: "spc_github",
    principal: { kind: "person", id: "usr_maya01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      if (down.has(cap)) throw fail("internal.unavailable", ctx.trace.traceId);
      switch (cap) {
        case "records.get": {
          const r = records.get(String(body.recordId));
          if (!r || r.type !== body.type) throw fail("validation.not_found", ctx.trace.traceId);
          return { record: { id: r.id, type: r.type, version: 1, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 } };
        }
        case "records.query": {
          const terms = ((body.filter as { and?: { field: string; value: unknown }[] } | undefined)?.and ?? []);
          const rows = [...records.values()].filter((r) => r.type === body.type && terms.every((t) => r.fields[t.field] === t.value));
          return { rows: rows.map((r) => ({ id: r.id, type: r.type, version: 1, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 })) };
        }
        case "records.update": {
          const r = records.get(String(body.recordId));
          if (!r) throw fail("validation.not_found", ctx.trace.traceId);
          Object.assign(r.fields, body.patch as Record<string, unknown>);
          return { record: { id: r.id, type: r.type, version: 2, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 } };
        }
        case "tasks.create": {
          const id = `tsk_gh${++tasks}`;
          return { task: { id, kind: "work", title: body.title, state: "todo", blocked: false, blocks: [], actions: [], assigned: body.assigned, fileIds: [], dependsOn: [], followers: [], workingNotes: {}, reviewLoops: 0, createdBy: ctx.principal.id, createdAt: NOW, updatedAt: NOW } };
        }
        default: throw new Error(`unexpected capability ${cap}`);
      }
    },
    async http(url, init) {
      const method = init?.method ?? "GET";
      const [path = "", qs = ""] = (url.startsWith(API) ? url.slice(API.length) : url).split("?");
      let parsed: Json | null = null;
      try { parsed = init?.body ? (JSON.parse(init.body) as Json) : null; } catch { parsed = null; }
      requests.push({ method, path, query: Object.fromEntries(new URLSearchParams(qs)), headers: init?.headers ?? {}, body: parsed, text: init?.body ?? "" });
      const queue = scripted.get(`${method} ${path}`);
      if (!queue || queue.length === 0) throw new Error(`unscripted request ${method} ${path}`);
      const reply = queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
      if (reply.throws) throw new Error("socket hang up");
      const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { status: reply.status, text: async () => text };
    },
    log: { info() {}, warn() {} },
  };

  /** Script the installation token endpoint so each mint gets a different token that lasts an hour from the clock now. */
  const tokenEndpoint = (id = INSTALL) => {
    const key = `POST /app/installations/${id}/access_tokens`;
    const mint = (): Reply => ({ status: 201, body: { token: `ghs_token_${++tokenSeq}`, expires_at: hourLater(clock) } });
    scripted.set(key, [mint()]);
    return { next(): void { scripted.set(key, [mint()]); } };
  };

  return {
    ctx, emitted, called, requests, stored, fillers, records, host,
    /** Script what GitHub answers to `METHOD /path` (no query); several replies for one request are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    tokenEndpoint,
    /** Everything a handler needs to reach one repository: the installation lookup and the token endpoint. */
    reach(repo = "vyre-ai/website", id = INSTALL) {
      scripted.set(`GET /repos/${repo}/installation`, [{ status: 200, body: { id } }]);
      return tokenEndpoint(id);
    },
    advance(ms: number) { clock += ms; },
    failCap(cap: string, on = true) { if (on) down.add(cap); else down.delete(cap); },
    addRecord(r: FakeRecord) { records.set(r.id, r); },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    withPath(method: string, path: string): Seen[] { return requests.filter((r) => r.method === method && r.path === path); },
    jwtCount: () => jwts,
  };
}

export type Harness = ReturnType<typeof harness>;

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** Errors of an event payload against the frozen schema of the event. */
export function payloadErrors(name: string, payload: unknown): string[] {
  const def = registry.events.filter((e) => e.name === name).sort((a, b) => b.sv - a.sv)[0];
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** The error code of a thrown HostError, or "" for anything else. */
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
