// A person's own GitHub connection and the one token broker (lane l-ci-runners).
//   connect / complete   user-to-server OAuth (PKCE) through the Space's own GitHub App when an admin set one up, else the default Vyre app; the refresh token is kept in the person's own Vault (Mine)
//   reach                the repositories and organisations the person reaches through the app, each organisation's install state and where to install or ask
//   policy               per kind of use: Always, Ask me first (through the Gate) or Never
//   token                the only way anything in Vyre gets a GitHub token: short-lived, narrowed to one repository and to what the kind of use needs, as a filler handle (never the token)
//   usage                the last use per consumer, for the "Used by" list
// DECISION: a person's connection proves who they are and what they can reach; the token handed out is the app's installation token narrowed to that one repository and that kind of use, minted only after the person's
//   own token shows they reach the repository. No personal access token is stored anywhere; the refresh token is a Vault (Mine) item of the person and GitHub rotates it on every refresh.
// DECISION: an agent uses a person's GitHub only on that person's own turns: the caller is the person, or an agent acting for them (ctx.actingFor). Any other caller is refused.
// DECISION: Ask me first is the Gate's: github.me.approve is an outward call, so the Gate holds it and makes the Approve task; once released, the approval is good for ten minutes for that repository and kind of use.
import { sha256b64 } from "../../../kernel/src/seal/wire.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, codeOf, ensure, ensureMe, first, installationFor, intOrUndef, list, mintToken, needHost, obj, refuse, repoPath, rowsOf, strOrUndef, text } from "../projections.ts";
import type { GithubCtx, UserHost } from "../projections.ts";

export const ACTIONS = ["read", "push_branch", "open_pr", "comment", "merge", "push_default"] as const;
export type Action = (typeof ACTIONS)[number];
export type Mode = "always" | "ask" | "never";
export const DEFAULT_POLICY: Record<Action, Mode> = { read: "always", push_branch: "always", open_pr: "always", comment: "always", merge: "ask", push_default: "ask" };
const WORDS: Record<Action, string> = { read: "read", push_branch: "push a branch", open_pr: "open a pull request", comment: "comment", merge: "merge", push_default: "push to the default branch" };
/** What the installation token is allowed to do for each kind of use. */
export const PERMISSIONS: Record<Action, Record<string, string>> = {
  read: { contents: "read", pull_requests: "read", issues: "read", checks: "read", metadata: "read" },
  push_branch: { contents: "write", metadata: "read" },
  open_pr: { pull_requests: "write", contents: "read", metadata: "read" },
  comment: { pull_requests: "write", issues: "write", metadata: "read" },
  merge: { pull_requests: "write", contents: "write", metadata: "read" },
  push_default: { contents: "write", metadata: "read" },
};
const STATE_TTL = 10 * 60_000, GRANT_MS = 10 * 60_000, EARLY = 60_000, ONCE_MS = 2 * 60_000;

/** Insert the row, or change the one with the same key: a select then an update or an insert (the same statements the test database understands). */
function put(ctx: GithubCtx, table: string, keys: Record<string, string | number>, values: Record<string, string | number>): void {
  const where = Object.keys(keys).map((k) => `"${k}" = ?`).join(" AND ");
  if (ctx.db.all(`SELECT "${Object.keys(keys)[0]}" FROM ${table} WHERE ${where}`, ...Object.values(keys)).length) {
    if (Object.keys(values).length) ctx.db.run(`UPDATE ${table} SET ${Object.keys(values).map((k) => `"${k}" = ?`).join(", ")} WHERE ${where}`, ...Object.values(values), ...Object.values(keys));
    return;
  }
  const all = { ...keys, ...values };
  ctx.db.run(`INSERT INTO ${table} (${Object.keys(all).map((k) => `"${k}"`).join(", ")}) VALUES (${Object.keys(all).map(() => "?").join(", ")})`, ...Object.values(all));
}

const personOf = (ctx: GithubCtx): string => {
  if (ctx.principal.kind !== "person") throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only a person connects their own GitHub." });
  return ctx.principal.id;
};
function userHost(ctx: GithubCtx): UserHost {
  const u = needHost(ctx).user;
  if (!u) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Connecting a personal GitHub is not set up on this server." });
  return u;
}
const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---- the person's access token

const tokens = new WeakMap<object, Map<string, { token: string; expiresAt: number }>>();
const cacheOf = (db: object): Map<string, { token: string; expiresAt: number }> => { let m = tokens.get(db); if (!m) { m = new Map(); tokens.set(db, m); } return m; };

/** The person's access token: from memory while it has more than a minute, else made from their refresh token (which GitHub replaces each time). A connection GitHub no longer honours is marked, and the person is asked to connect again. */
export async function userToken(ctx: GithubCtx, person: string): Promise<string> {
  ensureMe(ctx);
  const hit = cacheOf(ctx.db).get(person);
  if (hit && hit.expiresAt - ctx.now() > EARLY) return hit.token;
  const me = first(ctx.db.all(`SELECT * FROM github_me WHERE "person" = ?`, person));
  const again = (): never => { ctx.db.run(`UPDATE github_me SET "needsReconnect" = ? WHERE "person" = ?`, 1, person); throw fail("provider.auth_failed", ctx.trace.traceId, { message: "GitHub needs to be connected again. Connect it in Settings." }); };
  if (!me) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Connect your GitHub first, in Settings." });
  const u = userHost(ctx);
  const refresh = await u.recall(ctx, person);
  if (!refresh) return again();
  let fresh;
  try { fresh = await u.refresh(ctx, { refreshToken: refresh }); } catch (e) { if (codeOf(e) === "provider.auth_failed") return again(); throw e; }
  await u.keep(ctx, person, { refreshToken: fresh.refreshToken });
  cacheOf(ctx.db).set(person, { token: fresh.accessToken, expiresAt: fresh.expiresAt });
  ctx.db.run(`UPDATE github_me SET "needsReconnect" = ? WHERE "person" = ?`, 0, person);
  return fresh.accessToken;
}

// ---- connect

export async function meConnect(ctx: GithubCtx, input: { return?: string } = {}): Promise<{ authUrl: string; state: string; source: "space" | "vyre" }> {
  ensure(ctx); ensureMe(ctx);
  const person = personOf(ctx), u = userHost(ctx), app = await u.app(ctx);
  // "<random>.<where to go back to>": the route at /hooks/github/connect reads the return address from it and refuses one that is not this Space's or a loopback address
  const ret = typeof input.return === "string" && input.return.length > 0 && input.return.length <= 400 ? input.return : null;
  const state = b64url(randomBytes(18)) + (ret ? `.${Buffer.from(ret, "utf8").toString("base64url")}` : `.${b64url(new TextEncoder().encode("/"))}`), verifier = b64url(randomBytes(32));
  ctx.db.run(`DELETE FROM github_me_state WHERE "createdAt" < ?`, ctx.now() - STATE_TTL);
  ctx.db.run(`INSERT INTO github_me_state ("state", "person", "verifier", "createdAt") VALUES (?, ?, ?, ?)`, state, person, verifier, ctx.now());
  const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: await u.redirectUri(ctx), state, code_challenge: sha256b64(verifier), code_challenge_method: "S256" });
  return { authUrl: `https://github.com/login/oauth/authorize?${q.toString()}`, state, source: app.source };
}

export async function meComplete(ctx: GithubCtx, input: { code: string; state: string }): Promise<{ login: string; source: "space" | "vyre" }> {
  ensure(ctx); ensureMe(ctx);
  const person = personOf(ctx), u = userHost(ctx);
  const row = first(ctx.db.all(`SELECT * FROM github_me_state WHERE "state" = ?`, input.state));
  if (!row || row.person !== person || row.usedAt != null || ctx.now() - Number(row.createdAt) > STATE_TTL) bad(ctx, "That sign-in link is not valid any more. Connect GitHub again.");
  ctx.db.run(`UPDATE github_me_state SET "usedAt" = ? WHERE "state" = ?`, ctx.now(), input.state);
  const got = await u.exchange(ctx, { code: input.code, verifier: String(row!.verifier), redirectUri: await u.redirectUri(ctx) });
  const who = await api(ctx, { path: "/user", auth: { as: "user", token: got.accessToken } });
  const login = text(who.login), githubId = intOrUndef(who.id);
  if (!login || githubId === undefined) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub did not say who connected." });
  await u.keep(ctx, person, { refreshToken: got.refreshToken });
  cacheOf(ctx.db).set(person, { token: got.accessToken, expiresAt: got.expiresAt });
  const source = (await u.app(ctx)).source;
  put(ctx, "github_me", { person }, { login, githubId, source, connectedAt: ctx.now(), needsReconnect: 0 });
  for (const a of ACTIONS) ctx.db.run(`INSERT OR IGNORE INTO github_policy ("person", "action", "mode") VALUES (?, ?, ?)`, person, a, DEFAULT_POLICY[a]);
  ctx.emit("github.me_connected", `entity/${person}`, { person, login, source });
  // one connection: it also lets them sign in to Vyre with this GitHub. Best effort and silent: an account already linked to another GitHub, or a server with no GitHub sign-in, is left as it is.
  if (got.linkTicket) await ctx.call("identity.github_link", { code: got.linkTicket }).catch((e) => ctx.log.warn("github: could not link the sign-in", { code: codeOf(e) }));
  return { login, source };
}

/**
 * The host, after someone signed in with GitHub: the tokens that sign-in left connect their GitHub too (host call github.adopt_sign_in). A GitHub app that issues no expiring tokens leaves none, and nothing happens.
 * A person already connected is left as they are.
 */
export async function adoptSignIn(ctx: GithubCtx, input: { githubId: string; person: string }): Promise<{ adopted: boolean }> {
  ensure(ctx); ensureMe(ctx);
  if (first(ctx.db.all(`SELECT "person" FROM github_me WHERE "person" = ?`, input.person))) return { adopted: false };
  const u = userHost(ctx), got = await u.adopt(ctx, { githubId: input.githubId });
  if (!got) return { adopted: false };
  await u.keep(ctx, input.person, { refreshToken: got.refreshToken });
  cacheOf(ctx.db).set(input.person, { token: got.accessToken, expiresAt: got.expiresAt });
  const source = (await u.app(ctx)).source;
  put(ctx, "github_me", { person: input.person }, { login: got.login, githubId: Number(input.githubId) || 0, source, connectedAt: ctx.now(), needsReconnect: 0 });
  for (const a of ACTIONS) ctx.db.run(`INSERT OR IGNORE INTO github_policy ("person", "action", "mode") VALUES (?, ?, ?)`, input.person, a, DEFAULT_POLICY[a]);
  ctx.emit("github.me_connected", `entity/${input.person}`, { person: input.person, login: got.login, source });
  return { adopted: true };
}

export async function meStatus(ctx: GithubCtx): Promise<{ connected: boolean; login?: string; source?: "space" | "vyre"; connectedAt?: number; needsReconnect: boolean }> {
  ensureMe(ctx);
  const me = first(ctx.db.all(`SELECT * FROM github_me WHERE "person" = ?`, personOf(ctx)));
  // not connected yet: the member is told which app the sign-in will use, the same fact github.me.connect hands them (source only: no client id, no app id, no secret, no installation)
  if (!me) { const source = await userHost(ctx).app(ctx).then((a) => a.source, () => undefined); return { connected: false, ...(source ? { source } : {}), needsReconnect: false }; }
  return { connected: true, login: String(me.login), source: me.source as "space" | "vyre", connectedAt: Number(me.connectedAt), needsReconnect: me.needsReconnect === 1 };
}

export async function meDisconnect(ctx: GithubCtx): Promise<{ disconnected: boolean }> {
  ensureMe(ctx);
  const person = personOf(ctx), u = userHost(ctx);
  const me = first(ctx.db.all(`SELECT "login" FROM github_me WHERE "person" = ?`, person));
  if (!me) return { disconnected: false };
  try { await u.revoke(ctx, { accessToken: await userToken(ctx, person) }); } catch (e) { ctx.log.warn("github: could not revoke a personal token", { code: codeOf(e) }); }
  await u.forget(ctx, person).catch((e) => ctx.log.warn("github: could not clear a personal Vault item", { code: codeOf(e) }));
  cacheOf(ctx.db).delete(person);
  for (const t of ["github_me", "github_grant"]) ctx.db.run(`DELETE FROM ${t} WHERE "person" = ?`, person);
  ctx.emit("github.me_disconnected", `entity/${person}`, { person, login: String(me.login) });
  return { disconnected: true };
}

// ---- reach

interface Install { id: number; account: string; selection: "all" | "selected" }
async function installsOf(ctx: GithubCtx, token: string): Promise<Install[]> {
  const j = await api(ctx, { path: "/user/installations", query: { per_page: 100 }, auth: { as: "user", token } });
  return list(j.installations).map(obj).map((i) => ({ id: intOrUndef(i.id) ?? 0, account: text(obj(i.account).login), selection: i.repository_selection === "selected" ? "selected" as const : "all" as const })).filter((i) => i.id && i.account);
}
async function reposOf(ctx: GithubCtx, token: string, inst: Install): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const j = await api(ctx, { path: `/user/installations/${inst.id}/repositories`, query: { per_page: 100, page }, auth: { as: "user", token } });
    const rows = list(j.repositories).map(obj);
    for (const r of rows) { const n = text(r.full_name); if (n) out.push(n); }
    if (rows.length < 100) break;
  }
  return out;
}

export async function meReach(ctx: GithubCtx): Promise<{ login: string; orgs: Array<{ login: string; install: "all" | "selected" | "none"; url: string | null }>; repos: Array<{ repo: string; installationId: number }> }> {
  ensure(ctx); ensureMe(ctx);
  const person = personOf(ctx), token = await userToken(ctx, person);
  const me = first(ctx.db.all(`SELECT "login" FROM github_me WHERE "person" = ?`, person));
  const [installs, orgsRaw] = await Promise.all([installsOf(ctx, token), api(ctx, { path: "/user/orgs", query: { per_page: 100 }, auth: { as: "user", token } })]);
  const slug = text(first(ctx.db.all(`SELECT "slug" FROM github_app WHERE "id" = ?`, "app"))?.slug) || "";
  const orgs = list(orgsRaw.items).map(obj).map((o) => {
    const login = text(o.login), id = intOrUndef(o.id);
    const hit = installs.find((i) => i.account.toLowerCase() === login.toLowerCase());
    return { login, install: hit ? hit.selection : ("none" as const), url: hit ? `https://github.com/organizations/${encodeURIComponent(login)}/settings/installations/${hit.id}` : slug && id !== undefined ? `https://github.com/apps/${slug}/installations/new/permissions?target_id=${id}` : null };
  }).filter((o) => o.login);
  const repos: Array<{ repo: string; installationId: number }> = [];
  for (const i of installs) for (const repo of await reposOf(ctx, token, i)) repos.push({ repo, installationId: i.id });
  return { login: String(me?.login ?? ""), orgs, repos };
}

// ---- policy

export function policyOf(ctx: GithubCtx, person: string): Record<Action, Mode> {
  ensureMe(ctx);
  const out = { ...DEFAULT_POLICY };
  for (const r of rowsOf(ctx.db.all(`SELECT "action", "mode" FROM github_policy WHERE "person" = ?`, person))) if ((ACTIONS as readonly string[]).includes(String(r.action))) out[r.action as Action] = r.mode as Mode;
  return out;
}
export const policyGet = (ctx: GithubCtx): { policy: Record<Action, Mode> } => ({ policy: policyOf(ctx, personOf(ctx)) });
export function policySet(ctx: GithubCtx, input: { policy: Partial<Record<Action, Mode>> }): { policy: Record<Action, Mode> } {
  const person = personOf(ctx);
  for (const [a, m] of Object.entries(input.policy)) {
    if (!(ACTIONS as readonly string[]).includes(a)) bad(ctx, `${a} is not a kind of use.`);
    if (m !== "always" && m !== "ask" && m !== "never") bad(ctx, "A kind of use is Always, Ask me first or Never.");
    put(ctx, "github_policy", { person, action: a }, { mode: m });
    if (m !== "ask") ctx.db.run(`DELETE FROM github_grant WHERE "person" = ? AND "action" = ?`, person, a);
  }
  return { policy: policyOf(ctx, person) };
}

// ---- the broker

/** Who the token is for. A person asks for their own; an agent asks on that person's own turn (actingFor). Nothing else. */
function forWhom(ctx: GithubCtx, asked: string | undefined): string {
  const person = ctx.principal.kind === "person" ? ctx.principal.id : ctx.actingFor;
  if (!person || (asked !== undefined && asked !== person)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "An agent uses a person's GitHub only on that person's own turns." });
  return person;
}

function note(ctx: GithubCtx, person: string, consumer: string, repo: string, action: string): void {
  put(ctx, "github_use", { person, consumer }, { repo, action, at: ctx.now() });
}

/** Is the repository one the person reaches through the app, and which installation holds it? */
async function installationOfRepo(ctx: GithubCtx, person: string, repo: string): Promise<number> {
  const token = await userToken(ctx, person), want = repo.toLowerCase();
  for (const i of await installsOf(ctx, token)) {
    if (i.account.toLowerCase() !== want.split("/")[0]) continue;
    if (i.selection === "all" || (await reposOf(ctx, token, i)).some((r) => r.toLowerCase() === want)) return i.id;
  }
  throw fail("validation.not_found", ctx.trace.traceId, { message: "GitHub does not show you that repository through the Vyre app. Install the app on its owner, or ask the owner to." });
}

/**
 * A push to the default branch asks for exactly that push (repo, ref, old and new object), once: the consumer carries a 192-bit fingerprint of it (host/src/seams/git-proxy.ts). A delete of the default
 * branch carries its own prefix, git.del, and needs that approval whatever the person's settings say.
 */
const ONCE = /^git\.(push|del):[0-9a-f]{48}$/;

/** Check the person's policy for the use; Always passes, Never refuses, Ask me first goes to the Gate and passes once approved. A consumer that names one push is approved for that push alone and the approval is used up by it. */
async function allowed(ctx: GithubCtx, person: string, repo: string, action: Action, consumer: string): Promise<void> {
  const mode = policyOf(ctx, person)[action];
  if (mode === "never") refuse(ctx, `You set GitHub to never let anything ${WORDS[action]}. Change it in Settings, GitHub.`);
  const once = ONCE.test(consumer), forced = consumer.startsWith("git.del:") && ONCE.test(consumer);
  const key = once ? `${repo}#${consumer.slice(consumer.indexOf(":") + 1)}` : repo;
  const g = first(ctx.db.all(`SELECT "until" FROM github_grant WHERE "person" = ? AND "repo" = ? AND "action" = ?`, person, key, action));
  if (once && g) ctx.db.run(`DELETE FROM github_grant WHERE "person" = ? AND "repo" = ? AND "action" = ?`, person, key, action);   // used up, whether or not the settings needed it
  if ((mode === "ask" || forced) && (!g || Number(g.until) < ctx.now())) await ctx.call("github.me.approve", { repo, action, consumer, idempotencyKey: `gha-${ctx.now()}-${Math.random().toString(36).slice(2, 10)}` });   // the Gate holds this; it throws until the person approves, and the approval records the grant
}

/**
 * A read made for a person (the caller, or the person an agent acts for) goes through the same rules as a token: the person's policy for reading, whether they reach the repository, and the Used by note.
 * A caller with no connected GitHub keeps the Space app's read as before. The read itself uses the app's installation, so no token is handed out here.
 */
export async function checkRead(ctx: GithubCtx, repo: string, consumer: string): Promise<void> {
  ensureMe(ctx);
  const person = ctx.principal.kind === "person" ? ctx.principal.id : ctx.actingFor;
  if (!person || !first(ctx.db.all(`SELECT "person" FROM github_me WHERE "person" = ?`, person))) return;
  await allowed(ctx, person, repo, "read", consumer);
  await installationOfRepo(ctx, person, repo);
  note(ctx, person, consumer, repo, "read");
}

export async function token(ctx: GithubCtx, input: { person?: string; repo: string; action: Action; consumer: string }): Promise<{ handle: string; expiresAt: number; repo: string; permissions: Record<string, string> }> {
  ensure(ctx); ensureMe(ctx);
  repoPath(ctx, input.repo);
  if (!(ACTIONS as readonly string[]).includes(input.action)) bad(ctx, "That is not a kind of use.");
  if (!/^[a-z][a-z0-9_.:-]{1,60}$/.test(input.consumer)) bad(ctx, "Name the consumer, such as crew, ci or agent.github.");
  const person = forWhom(ctx, input.person);
  await allowed(ctx, person, input.repo, input.action, input.consumer);
  const installationId = await installationOfRepo(ctx, person, input.repo);
  const name = input.repo.split("/")[1]!;
  const minted = await mintToken(ctx, installationId, [name], PERMISSIONS[input.action]);
  const handle = await needHost(ctx).fillerHandle(ctx, { token: minted.token, expiresAt: minted.expiresAt, repo: input.repo });
  note(ctx, person, input.consumer, input.repo, input.action);
  return { handle, expiresAt: minted.expiresAt, repo: input.repo, permissions: PERMISSIONS[input.action] };
}

/** The Gate released an "Ask me first": remember it for ten minutes. */
export async function meApprove(ctx: GithubCtx, input: { repo: string; action: Action; consumer: string }): Promise<{ approved: boolean }> {
  ensureMe(ctx);
  const person = ctx.principal.kind === "person" ? ctx.principal.id : ctx.actingFor;
  if (!person) throw fail("permission.no_grant", ctx.trace.traceId, { message: "An approval belongs to a person." });
  // Defence in depth: the handler runs only after the Gate released it, and an agent's call is released only by the person. If the Gate would not hold this act for the agent any more (a rule change, a new
  // way to lift it), refuse here, so an approval can never be recorded by an agent that nobody was asked for.
  if (ctx.principal.kind === "agent") {
    let hold: unknown;
    try { hold = ((await ctx.call("gate.effective_rule", { principal: { kind: "agent", id: ctx.principal.id }, act: "github_approval" })) as { hold?: unknown } | null)?.hold; } catch { hold = undefined; }
    if (hold !== true) throw fail("permission.no_grant", ctx.trace.traceId, { message: "A GitHub approval is the person's to give. It was not recorded." });
  }
  // one push: the grant is for that push alone (repo#fingerprint), is not the ten-minute window of the repository, and is used up by the push (allowed)
  const key = ONCE.test(input.consumer) ? `${input.repo}#${input.consumer.slice(input.consumer.indexOf(":") + 1)}` : input.repo;
  put(ctx, "github_grant", { person, repo: key, action: input.action }, { until: ctx.now() + (ONCE.test(input.consumer) ? ONCE_MS : GRANT_MS) });
  return { approved: true };
}

/**
 * Gone: a session no longer gets a GitHub token of any kind. A Claude Code, Codex or Grok session pushes and fetches through the Space's own git address with a proxy token (host/src/seams/git-proxy.ts),
 * and the Space makes a GitHub token for one request at a time under the person's settings. Kept as a capability that refuses, so nothing that still calls it is handed a token.
 */
export async function sessionEnv(ctx: GithubCtx, _input: { repos: string[]; consumer: string }): Promise<{ env: Record<string, string>; gitConfig: string[]; repos: string[]; skipped: string[]; expiresAt: number }> {
  ensure(ctx); ensureMe(ctx);
  return refuse(ctx, "A session no longer gets a GitHub token. It pushes and fetches through Vyre's git address, and opens pull requests and comments through Vyre's GitHub tool.");
}

export function meUsage(ctx: GithubCtx): { uses: Array<{ consumer: string; repo: string; action: string; at: number }> } {
  ensureMe(ctx);
  return { uses: rowsOf(ctx.db.all(`SELECT "consumer", "repo", "action", "at" FROM github_use WHERE "person" = ? ORDER BY "at" DESC`, personOf(ctx))).map((r) => ({ consumer: String(r.consumer), repo: String(r.repo), action: String(r.action), at: Number(r.at) })) };
}
export { strOrUndef, installationFor };
