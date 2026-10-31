// google.user.*: a person's own Google sign-in for mail, for a Space that has no Workspace delegation (a Personal Space, or a person whose address the Workspace does not cover).
// The Space holds an OAuth client in a Vault item (#Google_Sign_In: client_id, and client_secret for a web client). A person signs in with OAuth (PKCE, offline access) and the module keeps:
//   - the person's refresh token SEALED in google_user_account with the Space seal. It is in no Vault item and no capability returns it; this module opens it for one call and the host
//     makes an access token from it, so a person's token is theirs alone and the poll that runs with nobody signed in (a host service) is the only other thing that uses it;
//   - a mailbox for the address, made with mail.connect carrying the account id as its connection, so the pull and the send that the delegated mailboxes use (pullMailbox, google.gmail.send_message)
//     work unchanged: they ask for the connection's token, and a gua_ connection answers with this account's.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  CONFIG_ID, GMAIL, bad, codeOf, ensure, first, needHost, newId, normalizeEmail, rowsOf, str, strOrNull, text, userAccount, userAppHandle,
} from "../projections.ts";
import type { GoogleCtx, Row, UserAccount } from "../projections.ts";
import { sendMessage } from "./gmail.ts";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE = "https://oauth2.googleapis.com/revoke";
export const USER_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"] as const;
const OAUTH_TTL_MS = 10 * 60_000;
const APP_HANDLE = /^#[A-Za-z0-9_]+$/;

const hex = (n: number): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))).toString("hex");
const actorOf = (ctx: Pick<GoogleCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(new Uint8Array(digest)).toString("base64url") };
}

const sealed = (ctx: GoogleCtx, token: string): string => JSON.stringify(ctx.seal.seal(new TextEncoder().encode(token), "google.user.refresh"));

const redirectOf = async (ctx: GoogleCtx): Promise<string | undefined> => (await needHost(ctx).userPublicUrl(ctx).catch(() => undefined))?.replace(/\/+$/, "").concat("/oauth/callback");

// ---- the app

export async function userAppStatus(ctx: GoogleCtx) {
  ensure(ctx);
  const cfg = first(ctx.db.all(`SELECT * FROM google_user_app WHERE id = ?`, CONFIG_ID));
  const redirectUri = await redirectOf(ctx);
  return {
    configured: cfg !== null, ...(cfg ? { clientId: str(cfg, "clientId"), vaultItem: str(cfg, "vaultItem") } : {}), ...(redirectUri ? { redirectUri } : {}),
  };
}

export async function userAppSet(ctx: GoogleCtx, input: unknown) {
  ensure(ctx);
  const handle = text(obj(input)["vaultItem"]) ?? "";
  if (!APP_HANDLE.test(handle)) bad(ctx, "The Vault item is not a valid handle, such as #Google_Sign_In.");
  const app = await needHost(ctx).userApp(ctx, handle);
  const now = ctx.now();
  if (first(ctx.db.all(`SELECT id FROM google_user_app WHERE id = ?`, CONFIG_ID))) ctx.db.run(`UPDATE google_user_app SET "vaultItem" = ?, "clientId" = ?, updated_at = ? WHERE id = ?`, handle, app.clientId, now, CONFIG_ID);
  else ctx.db.run(`INSERT INTO google_user_app (id, "vaultItem", "clientId", updated_at) VALUES (?, ?, ?, ?)`, CONFIG_ID, handle, app.clientId, now);
  return { configured: true, clientId: app.clientId };
}

// ---- signing in

export async function userStart(ctx: GoogleCtx, input: unknown) {
  ensure(ctx);
  userAppHandle(ctx);   // refuses with how to set it up when there is no client
  const clientId = str(first(ctx.db.all(`SELECT "clientId" FROM google_user_app WHERE id = ?`, CONFIG_ID)), "clientId");
  const base = (await needHost(ctx).userPublicUrl(ctx)).replace(/\/+$/, "");
  const redirectUri = `${base}/oauth/callback`;
  const now = ctx.now();
  for (const old of rowsOf(ctx.db.all(`SELECT state, created_at FROM google_user_oauth WHERE "startedBy" = ?`, actorOf(ctx)))) {
    if (now - Number(old["created_at"]) > OAUTH_TTL_MS) ctx.db.run(`DELETE FROM google_user_oauth WHERE state = ?`, str(old, "state"));
  }
  const state = `gos_${hex(24)}`;
  const { verifier, challenge } = await pkce();
  ctx.db.run(`INSERT INTO google_user_oauth (state, "startedBy", verifier, "redirectUri", created_at) VALUES (?, ?, ?, ?, ?)`, state, actorOf(ctx), verifier, redirectUri, now);
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", USER_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  const hint = text(obj(input)["loginHint"]);
  if (hint && /^[^\s@]+@[^\s@]+$/.test(hint)) u.searchParams.set("login_hint", hint);
  return { authUrl: u.toString(), state };
}

export async function userComplete(ctx: GoogleCtx, input: unknown) {
  ensure(ctx);
  const i = obj(input);
  const state = text(i["state"]) ?? "";
  const row = first(ctx.db.all(`SELECT * FROM google_user_oauth WHERE state = ?`, state));
  if (!row) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "This sign-in link is wrong or was already used." });
  // whose sign-in this is decided before the state is used up: someone else holding the link can neither finish it nor spend it
  if (str(row, "startedBy") !== actorOf(ctx)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "This sign-in was started by someone else. Only they can finish it." });
  ctx.db.run(`DELETE FROM google_user_oauth WHERE state = ?`, state);   // one use, whatever happens next
  if (ctx.now() - Number(row["created_at"]) > OAUTH_TTL_MS) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "This sign-in link has expired: start again." });
  if (text(i["error"])) {
    throw fail("validation.precondition_failed", ctx.trace.traceId, {
      message: i["error"] === "access_denied" ? "Google was not given access: the sign-in was declined." : "Google ended the sign-in without giving access.", details: { reason: "declined" },
    });
  }
  const code = text(i["code"]) ?? "";
  if (code === "") bad(ctx, "Google did not send a sign-in code.");

  const tokens = await needHost(ctx).userExchange(ctx, { appHandle: userAppHandle(ctx), code, verifier: str(row, "verifier"), redirectUri: str(row, "redirectUri") });
  // whose mailbox it is: the address Gmail says
  let profile: { status: number; body: string };
  try {
    const res = await ctx.http(`${GMAIL}/profile`, { method: "GET", headers: { authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" } });
    profile = { status: res.status, body: await res.text() };
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;
    throw fail("provider.network", ctx.trace.traceId, { message: "Google could not be reached." });
  }
  if (profile.status >= 300) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Google did not accept the new sign-in. Check that Gmail is allowed for the OAuth client.", details: { status: profile.status } });
  let who: Record<string, unknown> = {};
  try { who = obj(JSON.parse(profile.body)); } catch { /* answered below */ }
  const email = normalizeEmail(text(who["emailAddress"]) ?? "");
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Google did not say whose mailbox this is." });

  const owner = actorOf(ctx);
  const known = first(ctx.db.all(`SELECT * FROM google_user_account WHERE "ownerId" = ? AND email = ?`, owner, email));
  let accountId: string;
  if (known) {
    // signing in again to the same address keeps the account (and its mailbox) and replaces the token
    accountId = str(known, "accountId");
    ctx.db.run(`UPDATE google_user_account SET "refreshSealed" = ? WHERE "accountId" = ?`, sealed(ctx, tokens.refreshToken), accountId);
  } else {
    accountId = newId("gua", ctx.now());
    ctx.db.run(`INSERT INTO google_user_account ("accountId", "ownerId", email, "refreshSealed", created_at) VALUES (?, ?, ?, ?, ?)`, accountId, owner, email, sealed(ctx, tokens.refreshToken), ctx.now());
  }
  // the mailbox is the person's own, made through mail like any other; a mailbox for this address that is already there is the one to use
  let mailboxId: string | undefined;
  try {
    // a person's own mailbox is theirs: private in a Team Space (nobody else sees it unless they share it), plain in a Personal Space (one person, so mail files like any other)
    const privacy = (await spaceKind(ctx)) === "personal" ? "space" : "private";
    const made = obj(await ctx.call("mail.connect", { provider: "google", address: email, connectionId: accountId, privacy, idempotencyKey: `gua-connect:${accountId}` }));
    mailboxId = text(obj(made["mailbox"])["id"]);
  } catch (e) {
    if (codeOf(e) !== "validation.duplicate") throw e;
  }
  if (mailboxId) ctx.db.run(`UPDATE google_user_account SET "mailboxId" = ? WHERE "accountId" = ?`, mailboxId, accountId);
  const box = mailboxId ?? (known ? strOrNull(known, "mailboxId") : null) ?? undefined;
  // the person signed in again after a lost sign-in: the mailbox is well again and its Needs you task is done
  if (known) await signedInAgain(ctx, { accountId, ownerId: owner, email, refreshSealed: "", mailboxId: box ?? null, fixTaskId: strOrNull(known, "fixTaskId") });
  if (box) await ctx.call("mail.sync_now", { mailboxId: box }).catch((e: unknown) => ctx.log.warn("google first pull did not start", { code: codeOf(e) }));
  ctx.emit("google.user_connected", `entity/${accountId}`, { accountId, email });
  return { accountId, email, ...(box ? { mailboxId: box } : {}) };
}

// ---- a lost sign-in

const spaceKind = async (ctx: GoogleCtx): Promise<string> => text(obj(obj(await ctx.call("spaces.get", {}).catch(() => ({})))["space"])["kind"]) ?? "team";

/** The saved sign-in no longer works (revoked, expired, the app's secret changed). The mailbox says so and the owner gets one Needs you task, however many pulls fail. */
export async function userSigninLost(ctx: GoogleCtx, a: UserAccount): Promise<void> {
  if (a.mailboxId) {
    await ctx.call("mail.mailbox.set_sync_state", { mailboxId: a.mailboxId, state: "error", reason: "Google stopped accepting the saved sign-in. Sign in again." })
      .catch((e: unknown) => ctx.log.warn("google mailbox state was not set", { code: codeOf(e) }));
  }
  if (a.fixTaskId) return;
  try {
    const made = obj(await ctx.call("tasks.create", {
      kind: "unblock", title: `Sign in to ${a.email} again`, summary: "Google stopped accepting the saved sign-in.", why: "The mailbox does not sync until you sign in again. Mail already here stays.",
      assigned: { kind: "person", id: a.ownerId }, source: { kind: "manual", id: a.accountId },
      blocks: [{ type: "mail_signin", v: 1, data: { provider: "google", address: a.email, accountId: a.accountId } }],
      actions: [{ key: "resolved", label: "Sign in again" }],   // unblock tasks take resolved or cannot (modules/tasks/handlers/state.ts)
      idempotencyKey: `gua-fix:${a.accountId}:${ctx.now()}`,
    }));
    const taskId = text(obj(made["task"])["id"]);
    if (taskId) ctx.db.run(`UPDATE google_user_account SET "fixTaskId" = ? WHERE "accountId" = ?`, taskId, a.accountId);
  } catch (e) { ctx.log.warn("google sign-in task was not made", { code: codeOf(e) }); }
}

async function signedInAgain(ctx: GoogleCtx, a: UserAccount): Promise<void> {
  if (a.fixTaskId) {
    await ctx.call("tasks.transition", { taskId: a.fixTaskId, to: "done" }).catch((e: unknown) => ctx.log.warn("google sign-in task was not closed", { code: codeOf(e) }));
    ctx.db.run(`UPDATE google_user_account SET "fixTaskId" = ? WHERE "accountId" = ?`, null, a.accountId);
  }
  if (a.mailboxId) await ctx.call("mail.mailbox.set_sync_state", { mailboxId: a.mailboxId, state: "syncing" }).catch((e: unknown) => ctx.log.warn("google mailbox state was not set", { code: codeOf(e) }));
}

// ---- accounts

export function userList(ctx: GoogleCtx) {
  ensure(ctx);
  const me = actorOf(ctx);
  const rows: Row[] = rowsOf(ctx.db.all(`SELECT * FROM google_user_account WHERE "ownerId" = ?`, me)).sort((a, b) => Number(a["created_at"]) - Number(b["created_at"]));
  return { accounts: rows.map((r) => ({ accountId: str(r, "accountId"), email: str(r, "email") })) };
}

export async function userRemove(ctx: GoogleCtx, input: unknown) {
  return dropAccount(ctx, userAccount(ctx, text(obj(input)["accountId"]) ?? ""));
}

/** The account, its token and its mailbox row go; its Needs you item is closed. Used by the owner signing out and by the removal wizard. */
async function dropAccount(ctx: GoogleCtx, a: UserAccount): Promise<{ removed: true }> {
  // Google is told first (best effort: a token it already lost is not a reason to keep the account), then the rows, and with them the sealed token, go
  try {
    const refresh = new TextDecoder().decode(ctx.seal.unseal(JSON.parse(a.refreshSealed)));
    await ctx.http(`${REVOKE}?token=${encodeURIComponent(refresh)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
  } catch (e) { ctx.log.warn("google token was not revoked", { code: codeOf(e) }); }
  if (a.fixTaskId) await ctx.call("tasks.transition", { taskId: a.fixTaskId, to: "canceled" }).catch((e: unknown) => ctx.log.warn("google sign-in task was not closed", { code: codeOf(e) }));
  ctx.db.run(`DELETE FROM google_user_account WHERE "accountId" = ?`, a.accountId);
  ctx.db.run(`DELETE FROM google_mailbox WHERE "connectionId" = ?`, a.accountId);
  return { removed: true };
}

/** The removal wizard ends a person's mailbox connections: their sign-ins end with them (the token is gone, not left sealed for nobody). Answers how many it ended. */
export async function dropAccountsOf(ctx: GoogleCtx, person: string): Promise<number> {
  ensure(ctx);
  const rows = rowsOf(ctx.db.all(`SELECT * FROM google_user_account WHERE "ownerId" = ?`, person));
  for (const r of rows) await dropAccount(ctx, { accountId: str(r, "accountId"), ownerId: person, email: str(r, "email"), refreshSealed: str(r, "refreshSealed"), mailboxId: strOrNull(r, "mailboxId"), fixTaskId: strOrNull(r, "fixTaskId") });
  return rows.length;
}


/** Send from the signed-in account: the account answers for the address and the token, and only its owner (or the host) may use it. */
export async function userSend(ctx: GoogleCtx, input: Record<string, unknown> & { accountId: string }) {
  const a = userAccount(ctx, input.accountId);
  const { accountId: _account, ...rest } = input;
  return sendMessage(ctx, { ...(rest as Parameters<typeof sendMessage>[1]), connectionId: a.accountId, as: a.email });
}
