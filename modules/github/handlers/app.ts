// The GitHub App and its webhook (spec 2.10, 2.16; ARCH 8, 8.5): the manifest flow that creates the App in the organisation, the App's installations and repositories,
// installation tokens (refreshed before they lapse, and handed to git only as a filler handle), the health probe, and /hooks/github with its signature check and the
// normalising of deliveries into the events Vyre listens to.
//
// DECISION: one GitHub App per Space. The manifest flow refuses to start or finish when the Space already has one; removing it is a Console task.
// DECISION: installation_token never returns a token. It mints a fresh one (narrowed to one repository when the caller names it) and the host's filler holds it.
// Every other call uses a cached installation token, renewed when under five minutes remain or when GitHub answers 401.
// DECISION: ctx.http gives no response headers, so a page of branches or repositories is "full" when it has as many rows as asked for; the next page token is the next
// page number, and the last page can be empty. Repositories filtered by a search are filtered here, over up to ten pages of 100.
// DECISION: github.receive_webhook has no author field and no record id, but pull_request.opened and issue.opened carry both. The author is read from GitHub (a read that
// fails gives "unknown"); the record is found by repo and number among the synced pull_request and issue records, and left out when it is not there yet.
// DECISION: `action` carries "merged" for a pull_request delivery that closed with a merge, because the input has no merged flag; any other close stays "closed".
// DECISION: repo.pushed requires a `number` in the frozen contract and a push has none, so a push event carries number 0.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { mintUuid } from "../../../lib/ids.ts";
import {
  APP_EVENTS, APP_PERMISSIONS, APP_ROW, api, bad, codeOf, ensure, first, HANDLE, installationFor, intOrUndef, list, mintToken, needHost, num, obj, raw, refuse, refusal, repoPath, strOrUndef, text, WEB,
} from "../projections.ts";
import type { GithubCtx, Json } from "../projections.ts";

const STATE_TTL = 3_600_000;
const MAX_SEARCH_PAGES = 10;
const PAGE_MAX = 100;

// ---- the App

function appRow(ctx: GithubCtx) {
  return first(ctx.db.all(`SELECT * FROM github_app WHERE id = ?`, APP_ROW));
}

export async function appCreateManifest(ctx: GithubCtx, input: { org: string; name?: string }): Promise<{ manifest: Json; postUrl: string; state: string }> {
  ensure(ctx);
  if (typeof input.org !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(input.org)) bad(ctx, "The organisation is its GitHub login.");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 34)) bad(ctx, "An App name is 1 to 34 characters.");
  if (appRow(ctx)) refuse(ctx, "This Space already has a GitHub App.");
  const base = (await needHost(ctx).publicUrl(ctx)).replace(/\/+$/, "");
  const state = mintUuid(ctx.now()).replaceAll("-", "");
  ctx.db.run(`INSERT INTO github_app_state ("state", "org", "createdAt", "usedAt") VALUES (?, ?, ?, ?)`, state, input.org, ctx.now(), null);
  const manifest: Json = {
    name: input.name?.trim() || `Vyre ${state.slice(0, 6)}`,
    url: base,
    hook_attributes: { url: `${base}/hooks/github`, active: true },
    redirect_url: `${base}/integrations/github/manifest`,
    callback_urls: [`${base}/auth/github/callback`],
    public: false,
    request_oauth_on_install: false,
    default_permissions: { ...APP_PERMISSIONS },
    default_events: [...APP_EVENTS],
  };
  return { manifest, postUrl: `${WEB}/organizations/${encodeURIComponent(input.org)}/settings/apps/new?state=${state}`, state };
}

export async function appComplete(ctx: GithubCtx, input: { code: string; state: string; idempotencyKey?: string }): Promise<{ appId: number; slug: string; installUrl: string }> {
  ensure(ctx);
  if (typeof input.code !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(input.code)) bad(ctx, "That is not a GitHub manifest code.");
  if (typeof input.state !== "string" || !/^[a-f0-9]{32}$/.test(input.state)) bad(ctx, "That is not a state this server gave.");
  if (appRow(ctx)) refuse(ctx, "This Space already has a GitHub App.");
  const st = first(ctx.db.all(`SELECT * FROM github_app_state WHERE state = ?`, input.state));
  if (!st || st.usedAt !== null || ctx.now() - num(st, "createdAt") > STATE_TTL) refuse(ctx, "That setup link has expired or was already used. Start the GitHub setup again.");
  const a = await raw(ctx, { method: "POST", path: `/app-manifests/${encodeURIComponent(input.code)}/conversions`, auth: { as: "none" } });
  if (a.status === 404 || a.status === 422) refuse(ctx, "GitHub does not know that code. It may have expired. Start the GitHub setup again.");
  if (a.status >= 300) throw refusal(ctx, a.status, a.json);
  const appId = intOrUndef(a.json.id);
  const slug = strOrUndef(a.json.slug);
  const pem = strOrUndef(a.json.pem);
  const hook = strOrUndef(a.json.webhook_secret);
  if (appId === undefined || !slug || !pem || !hook) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered the App setup without the App's id, key or secret." });
  const secrets = [
    { name: "GitHub_App_Id", value: String(appId) }, { name: "GitHub_App_Key", value: pem }, { name: "GitHub_App_Webhook_Secret", value: hook },
    ...(strOrUndef(a.json.client_id) ? [{ name: "GitHub_App_Client_Id", value: text(a.json.client_id) }] : []),
    ...(strOrUndef(a.json.client_secret) ? [{ name: "GitHub_App_Client_Secret", value: text(a.json.client_secret) }] : []),
  ];
  await needHost(ctx).storeSecrets(ctx, secrets);
  const permissions = Object.fromEntries(Object.entries(obj(a.json.permissions)).filter((e): e is [string, string] => typeof e[1] === "string"));
  const events = list(a.json.events).filter((e): e is string => typeof e === "string");
  ctx.db.run(
    `INSERT INTO github_app ("id", "appId", "slug", "name", "permissions", "events", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
    APP_ROW, appId, slug, text(a.json.name) || slug, JSON.stringify(permissions), JSON.stringify(events), ctx.now(),
  );
  ctx.db.run(`UPDATE github_app_state SET "usedAt" = ? WHERE state = ?`, ctx.now(), input.state);
  ctx.emit("github.app_created", `entity/${slug}`, { appId, slug });
  return { appId, slug, installUrl: `${WEB}/apps/${encodeURIComponent(slug)}/installations/new` };
}

export async function appGet(ctx: GithubCtx): Promise<{ id: number; slug: string; name: string; permissions: Record<string, string>; events: string[] }> {
  ensure(ctx);
  const j = await api(ctx, { path: "/app", auth: { as: "app" } });
  const id = intOrUndef(j.id);
  if (id === undefined) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered the App with no id." });
  return {
    id, slug: text(j.slug), name: text(j.name) || text(j.slug),
    permissions: Object.fromEntries(Object.entries(obj(j.permissions)).filter((e): e is [string, string] => typeof e[1] === "string")),
    events: list(j.events).filter((e): e is string => typeof e === "string"),
  };
}

export async function installationsList(ctx: GithubCtx): Promise<{ installations: { id: number; account: string; repositorySelection: "all" | "selected" }[] }> {
  ensure(ctx);
  const j = await api(ctx, { path: "/app/installations", auth: { as: "app" }, query: { per_page: PAGE_MAX } });
  const installations: { id: number; account: string; repositorySelection: "all" | "selected" }[] = [];
  for (const raw of list(j.items).map(obj)) {
    const id = intOrUndef(raw.id);
    if (id === undefined) continue;
    const account = text(obj(raw.account).login);
    const repositorySelection = text(raw.repository_selection) === "all" ? "all" : "selected";
    installations.push({ id, account, repositorySelection });
    const have = first(ctx.db.all(`SELECT id FROM github_installation WHERE id = ?`, id));
    if (have) ctx.db.run(`UPDATE github_installation SET account = ?, "repositorySelection" = ?, "at" = ? WHERE id = ?`, account, repositorySelection, ctx.now(), id);
    else ctx.db.run(`INSERT INTO github_installation ("id", "account", "repositorySelection", "at") VALUES (?, ?, ?, ?)`, id, account, repositorySelection, ctx.now());
  }
  return { installations };
}

// ---- repositories and branches

interface PageIn { cursor?: string; limit?: number }

function pageOf(ctx: GithubCtx, input: PageIn): { page: number; perPage: number } {
  const perPage = input.limit ?? 30;
  if (!Number.isSafeInteger(perPage) || perPage < 1) bad(ctx, "The limit is 1 or more.");
  const page = input.cursor === undefined ? 1 : Number(input.cursor);
  if (!Number.isSafeInteger(page) || page < 1) bad(ctx, "That cursor is not one this list gave.");
  return { page, perPage: Math.min(perPage, PAGE_MAX) };
}

interface RepoOut { repo: string; private: boolean; defaultBranch: string; url: string }
const repoOut = (r: Json): RepoOut => ({ repo: text(r.full_name), private: r.private === true, defaultBranch: text(r.default_branch), url: text(r.html_url) });

export async function reposList(ctx: GithubCtx, input: PageIn & { installationId?: number; query?: string }): Promise<{ repos: RepoOut[]; next?: string; total?: number }> {
  ensure(ctx);
  if (input.query !== undefined && typeof input.query !== "string") bad(ctx, "Search text must be text.");
  const installationId = await installationFor(ctx, input.installationId === undefined ? {} : { installationId: input.installationId });
  const { page, perPage } = pageOf(ctx, input);
  const q = input.query?.trim().toLowerCase();
  if (!q) {
    const j = await api(ctx, { path: "/installation/repositories", auth: { as: "installation", installationId }, query: { per_page: perPage, page } });
    const total = intOrUndef(j.total_count);
    const repos = list(j.repositories).map(obj).map(repoOut);
    const more = total !== undefined ? page * perPage < total : repos.length === perPage;
    return { repos, ...(more ? { next: String(page + 1) } : {}), ...(total !== undefined ? { total } : {}) };
  }
  // A search reads up to ten pages of 100 and filters here; its cursor is an offset into the matches.
  const all: RepoOut[] = [];
  for (let p = 1; p <= MAX_SEARCH_PAGES; p++) {
    const j = await api(ctx, { path: "/installation/repositories", auth: { as: "installation", installationId }, query: { per_page: PAGE_MAX, page: p } });
    const rows = list(j.repositories).map(obj).map(repoOut);
    all.push(...rows.filter((r) => r.repo.toLowerCase().includes(q)));
    if (rows.length < PAGE_MAX) break;
  }
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "That cursor is not one this list gave.");
  const limit = Math.min(input.limit ?? 30, PAGE_MAX);
  const repos = all.slice(offset, offset + limit);
  return { repos, ...(offset + repos.length < all.length ? { next: String(offset + repos.length) } : {}), total: all.length };
}

export async function repoGet(ctx: GithubCtx, input: { repo: string }): Promise<RepoOut & { description?: string }> {
  ensure(ctx);
  const path = repoPath(ctx, input.repo);
  const installationId = await installationFor(ctx, { repo: input.repo });
  const j = await api(ctx, { path, auth: { as: "installation", installationId } });
  const out: RepoOut & { description?: string } = repoOut(j);
  const description = strOrUndef(j.description);
  if (description) out.description = description;
  return out;
}

export async function branchesList(ctx: GithubCtx, input: PageIn & { repo: string }): Promise<{ branches: { name: string; sha: string; protected: boolean }[]; next?: string }> {
  ensure(ctx);
  const path = repoPath(ctx, input.repo);
  const { page, perPage } = pageOf(ctx, input);
  const installationId = await installationFor(ctx, { repo: input.repo });
  const j = await api(ctx, { path: `${path}/branches`, auth: { as: "installation", installationId }, query: { per_page: perPage, page } });
  const branches = list(j.items).map(obj).map((b) => ({ name: text(b.name), sha: text(obj(b.commit).sha), protected: b.protected === true }));
  return { branches, ...(branches.length === perPage ? { next: String(page + 1) } : {}) };
}

// ---- installation token for git

export async function installationToken(ctx: GithubCtx, input: { repo?: string; installationId?: number }): Promise<{ handle: string; expiresAt: number }> {
  ensure(ctx);
  const target: { repo?: string; installationId?: number } = {};
  if (input.repo !== undefined) {
    repoPath(ctx, input.repo);
    target.repo = input.repo;
  }
  if (input.installationId !== undefined) target.installationId = input.installationId;
  const installationId = await installationFor(ctx, target);
  const name = input.repo?.split("/")[1];
  const minted = await mintToken(ctx, installationId, name ? [name] : undefined);
  const handle = await needHost(ctx).fillerHandle(ctx, { token: minted.token, expiresAt: minted.expiresAt, ...(input.repo ? { repo: input.repo } : {}) });
  return { handle, expiresAt: minted.expiresAt };
}

// ---- health

export async function health(ctx: GithubCtx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const t0 = ctx.now();
  try {
    const a = await raw(ctx, { path: "/app", auth: { as: "app" } });
    const latencyMs = Math.max(0, ctx.now() - t0);
    if (a.status < 300) return { state: "healthy", latencyMs };
    if (a.status === 401 || a.status === 403) return { state: "down", detail: "GitHub did not accept the App. Check the GitHub App key in the Vault and that the App still exists." };
    if (a.status === 429) return { state: "degraded", detail: "GitHub is asking us to slow down.", latencyMs };
    return { state: "degraded", detail: "GitHub is not answering well right now.", latencyMs };
  } catch (e) {
    if (e instanceof HostError && e.error.code === "internal.unavailable") return { state: "down", detail: "GitHub is not set up on this server." };
    if (e instanceof HostError && e.error.code === "provider.network") return { state: "down", detail: "GitHub could not be reached." };
    if (e instanceof HostError && e.error.code === "provider.auth_failed") return { state: "down", detail: "The GitHub App is not set up. Create it in Settings, Integrations." };
    throw e;
  }
}

// ---- the webhook (/hooks/github)

const utf8 = (v: string) => new TextEncoder().encode(v);

/** HMAC-SHA256 through the platform's Web Crypto (B3: product code does not import node:crypto), in hex. The key is the Vault secret handed over for this one call. */
export async function signatureOf(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, utf8(body)));
  return `sha256=${Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** True when the X-Hub-Signature-256 header is the signature of this body under the secret. The whole string is read whatever the first difference. */
export async function signatureMatches(secret: string, header: string, body: string): Promise<boolean> {
  const want = await signatureOf(secret, body);
  let diff = header.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (header.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return diff === 0;
}

export interface WebhookIn {
  deliveryId: string;
  event: "ping" | "installation" | "push" | "pull_request" | "issues" | "check_run" | "workflow_run";
  action?: string;
  repo?: string;
  installationId?: number;
  number?: number;
  sha?: string;
  branch?: string;
  conclusion?: string;
  name?: string;
}

const EVENTS: readonly string[] = ["ping", "installation", "push", "pull_request", "issues", "check_run", "workflow_run"];

/** What the host's /hooks/github route calls first: the body is GitHub's only if the signature is. Returns the input of github.receive_webhook, or null for an event Vyre does not follow. */
export async function verifyWebhook(ctx: GithubCtx, a: { signature: string | undefined; event: string | undefined; deliveryId: string | undefined; body: string }): Promise<WebhookIn | null> {
  const secret = await needHost(ctx).secret(ctx, HANDLE.webhook);
  if (!a.signature || !(await signatureMatches(secret, a.signature, a.body))) {
    throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request was not signed by GitHub." });
  }
  if (!a.event || !a.deliveryId) bad(ctx, "A GitHub delivery names its event and its id.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(a.body);
  } catch {
    return bad(ctx, "The body is not JSON.");
  }
  return parseDelivery(a.event, a.deliveryId, parsed);
}

/** A verified delivery to the input of github.receive_webhook. */
export function parseDelivery(event: string, deliveryId: string, body: unknown): WebhookIn | null {
  if (!EVENTS.includes(event) || !deliveryId) return null;
  const b = obj(body);
  const out: WebhookIn = { deliveryId, event: event as WebhookIn["event"] };
  const action = strOrUndef(b.action);
  if (action) out.action = action;
  const repo = strOrUndef(obj(b.repository).full_name);
  if (repo) out.repo = repo;
  const installationId = intOrUndef(obj(b.installation).id);
  if (installationId !== undefined) out.installationId = installationId;
  if (event === "push") {
    const ref = text(b.ref);
    if (ref.startsWith("refs/heads/")) out.branch = ref.slice("refs/heads/".length);
    const after = strOrUndef(b.after);
    if (after && !/^0+$/.test(after)) out.sha = after;   // a deleted branch has an all-zero "after"
  } else if (event === "pull_request") {
    const pr = obj(b.pull_request);
    const n = intOrUndef(b.number) ?? intOrUndef(pr.number);
    if (n !== undefined) out.number = n;
    if (action === "closed") out.action = pr.merged === true ? "merged" : "closed";
    const sha = strOrUndef(obj(pr.head).sha);
    if (sha) out.sha = sha;
    const branch = strOrUndef(obj(pr.head).ref);
    if (branch) out.branch = branch;
  } else if (event === "issues") {
    const n = intOrUndef(obj(b.issue).number);
    if (n !== undefined) out.number = n;
  } else if (event === "check_run") {
    const run = obj(b.check_run);
    const name = strOrUndef(run.name);
    if (name) out.name = name;
    const conclusion = strOrUndef(run.conclusion);
    if (conclusion) out.conclusion = conclusion;
    const sha = strOrUndef(run.head_sha);
    if (sha) out.sha = sha;
    const n = intOrUndef(obj(list(run.pull_requests)[0]).number);
    if (n !== undefined) out.number = n;
  } else if (event === "workflow_run") {
    const run = obj(b.workflow_run);
    const name = strOrUndef(run.name);
    if (name) out.name = name;
    const conclusion = strOrUndef(run.conclusion);
    if (conclusion) out.conclusion = conclusion;
    const sha = strOrUndef(run.head_sha);
    if (sha) out.sha = sha;
  }
  return out;
}

const CHECK_CONCLUSIONS = ["success", "failure", "neutral", "cancelled", "timed_out", "action_required"] as const;

export async function receiveWebhook(ctx: GithubCtx, input: WebhookIn): Promise<{ accepted: boolean }> {
  ensure(ctx);
  if (!input.deliveryId || !EVENTS.includes(input.event)) bad(ctx, "A delivery needs its id and a known event.");
  if (first(ctx.db.all(`SELECT "deliveryId" FROM github_delivery WHERE "deliveryId" = ?`, input.deliveryId))) return { accepted: true };   // redelivered: applied once
  ctx.db.run(`INSERT INTO github_delivery ("deliveryId", "event", "at") VALUES (?, ?, ?)`, input.deliveryId, input.event, ctx.now());
  const seen: Json = { deliveryId: input.deliveryId, event: input.event };
  if (input.action) seen.action = input.action;
  if (input.repo) seen.repo = input.repo;
  ctx.emit("github.event_received", `entity/${input.deliveryId}`, seen);
  const { repo, number } = input;
  if (input.event === "push" && repo && input.branch && input.sha) {
    ctx.emit("repo.pushed", `entity/${repo}`, { repo, number: 0, branch: input.branch, sha: input.sha });
  } else if (input.event === "pull_request" && repo && number !== undefined) {
    const recordId = await recordIdOf(ctx, "pull_request", repo, number);
    const refs: Json = { repo, number, ...(recordId ? { recordId } : {}) };
    if (input.action === "opened") {
      ctx.emit("pull_request.opened", `entity/${repo}`, { ...refs, author: await authorOf(ctx, input, "pulls") });
    } else if (input.action === "merged") {
      ctx.emit("pull_request.merged", `entity/${repo}`, refs);
    } else if (input.action === "closed") {
      ctx.emit("pull_request.closed", `entity/${repo}`, refs);
    }
  } else if (input.event === "issues" && input.action === "opened" && repo && number !== undefined) {
    const recordId = await recordIdOf(ctx, "issue", repo, number);
    ctx.emit("issue.opened", `entity/${repo}`, { repo, number, ...(recordId ? { recordId } : {}), author: await authorOf(ctx, input, "issues") });
  } else if (input.event === "check_run" && input.action === "completed" && repo && input.sha && input.name && input.conclusion) {
    const conclusion = CHECK_CONCLUSIONS.find((c) => c === input.conclusion);
    if (conclusion) ctx.emit("github.check_completed", `entity/${repo}`, { repo, sha: input.sha, name: input.name, conclusion, ...(number !== undefined ? { number } : {}) });
  } else if (input.event === "workflow_run" && input.action === "completed" && repo && input.sha && input.name && input.conclusion) {
    ctx.emit("workflow.completed", `entity/${repo}`, { repo, name: input.name, conclusion: input.conclusion, sha: input.sha });
  }
  return { accepted: true };
}

/** The synced record for a pull request or issue, if the sync has made it yet. A records module that is down gives none. */
async function recordIdOf(ctx: GithubCtx, type: "pull_request" | "issue", repo: string, number: number): Promise<string | undefined> {
  try {
    const res = obj(await ctx.call("records.query", { type, filter: { and: [{ field: "repo", op: "eq", value: repo }, { field: "number", op: "eq", value: number }] }, limit: 1 }));
    return strOrUndef(obj(list(res.rows)[0]).id);
  } catch (e) {
    ctx.log.warn("github: could not look up the record of a delivery", { code: codeOf(e) });
    return undefined;
  }
}

/** Who opened it, from GitHub. "unknown" when GitHub cannot be asked: the event still matters. */
async function authorOf(ctx: GithubCtx, input: WebhookIn, kind: "pulls" | "issues"): Promise<string> {
  try {
    const installationId = await installationFor(ctx, input.installationId !== undefined ? { installationId: input.installationId } : { repo: input.repo ?? "" });
    const j = await api(ctx, { path: `${repoPath(ctx, input.repo)}/${kind}/${input.number}`, auth: { as: "installation", installationId } });
    return strOrUndef(obj(j.user).login) ?? "unknown";
  } catch (e) {
    ctx.log.warn("github: could not read who opened it", { code: codeOf(e) });
    return "unknown";
  }
}

