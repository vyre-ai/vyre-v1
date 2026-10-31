// ms.user.*: a person's own Microsoft sign-in for mail (Outlook, Microsoft 365, outlook.com), for a Space that has no tenant consent (a Personal Space, or a person the tenant does not cover).
// The Space holds an OAuth app in a Vault item (#Microsoft_Sign_In: client_id, client_secret when the app has one, tenant when it is not "common"). A person signs in with OAuth (PKCE, offline access) and the module keeps:
//   - the person's refresh token SEALED in microsoft_user_account with the Space seal. It is in no Vault item and no capability returns it; this module opens it for one call and the host
//     makes an access token from it, so a person's token is theirs alone and the poll that runs with nobody signed in (a host service) is the only other thing that uses it;
//   - a mailbox for the address, made with mail.connect carrying the account id as its connection, so the pull and the send that the delegated mailboxes use (pullMailbox, ms.mail.send_message)
//     work unchanged: they ask for the connection's token, and a mua_ connection answers with this account's. Graph reads it as /me, which also works for a personal Microsoft account.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  CONFIG_ID, GRAPH, bad, codeOf, ensure, first, needHost, newId, normalizeEmail, rowsOf, str, text, userAccount, userAppHandle,
} from "../projections.ts";
import type { MsCtx, Row } from "../projections.ts";

const authorizeUrl = (tenant: string | undefined): string => `https://login.microsoftonline.com/${encodeURIComponent(tenant ?? "common")}/oauth2/v2.0/authorize`;
export const USER_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"] as const;
const OAUTH_TTL_MS = 10 * 60_000;
const APP_HANDLE = /^#[A-Za-z0-9_]+$/;

const hex = (n: number): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))).toString("hex");
const actorOf = (ctx: Pick<MsCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(new Uint8Array(digest)).toString("base64url") };
}

const sealed = (ctx: MsCtx, token: string): string => JSON.stringify(ctx.seal.seal(new TextEncoder().encode(token), "microsoft.user.refresh"));

const redirectOf = async (ctx: MsCtx): Promise<string | undefined> => (await needHost(ctx).userPublicUrl(ctx).catch(() => undefined))?.replace(/\/+$/, "").concat("/oauth/callback");

// ---- the app

export async function userAppStatus(ctx: MsCtx) {
  ensure(ctx);
  const cfg = first(ctx.db.all(`SELECT * FROM microsoft_user_app WHERE id = ?`, CONFIG_ID));
  const redirectUri = await redirectOf(ctx);
  return {
    configured: cfg !== null, ...(cfg ? { clientId: str(cfg, "clientId"), vaultItem: str(cfg, "vaultItem") } : {}), ...(redirectUri ? { redirectUri } : {}),
  };
}

export async function userAppSet(ctx: MsCtx, input: unknown) {
  ensure(ctx);
  const handle = text(obj(input)["vaultItem"]) ?? "";
  if (!APP_HANDLE.test(handle)) bad(ctx, "The Vault item is not a valid handle, such as #Microsoft_Sign_In.");
  const app = await needHost(ctx).userApp(ctx, handle);
  const now = ctx.now();
  if (first(ctx.db.all(`SELECT id FROM microsoft_user_app WHERE id = ?`, CONFIG_ID))) ctx.db.run(`UPDATE microsoft_user_app SET "vaultItem" = ?, "clientId" = ?, updated_at = ? WHERE id = ?`, handle, app.clientId, now, CONFIG_ID);
  else ctx.db.run(`INSERT INTO microsoft_user_app (id, "vaultItem", "clientId", updated_at) VALUES (?, ?, ?, ?)`, CONFIG_ID, handle, app.clientId, now);
  return { configured: true, clientId: app.clientId };
}

// ---- signing in

export async function userStart(ctx: MsCtx, input: unknown) {
  ensure(ctx);
  const handle = userAppHandle(ctx);   // refuses with how to set it up when there is no app
  const app = await needHost(ctx).userApp(ctx, handle);
  const base = (await needHost(ctx).userPublicUrl(ctx)).replace(/\/+$/, "");
  const redirectUri = `${base}/oauth/callback`;
  const now = ctx.now();
  for (const old of rowsOf(ctx.db.all(`SELECT state, created_at FROM microsoft_user_oauth WHERE "startedBy" = ?`, actorOf(ctx)))) {
    if (now - Number(old["created_at"]) > OAUTH_TTL_MS) ctx.db.run(`DELETE FROM microsoft_user_oauth WHERE state = ?`, str(old, "state"));
  }
  const state = `mos_${hex(24)}`;
  const { verifier, challenge } = await pkce();
  ctx.db.run(`INSERT INTO microsoft_user_oauth (state, "startedBy", verifier, "redirectUri", created_at) VALUES (?, ?, ?, ?, ?)`, state, actorOf(ctx), verifier, redirectUri, now);
  const u = new URL(authorizeUrl(app.tenant));
  u.searchParams.set("client_id", app.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", USER_SCOPES.join(" "));
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("prompt", "select_account");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  const hint = text(obj(input)["loginHint"]);
  if (hint && /^[^\s@]+@[^\s@]+$/.test(hint)) u.searchParams.set("login_hint", hint);
  return { authUrl: u.toString(), state };
}

export async function userComplete(ctx: MsCtx, input: unknown) {
  ensure(ctx);
  const i = obj(input);
  const state = text(i["state"]) ?? "";
  const row = first(ctx.db.all(`SELECT * FROM microsoft_user_oauth WHERE state = ?`, state));
  if (!row) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "This sign-in link is wrong or was already used." });
  // whose sign-in this is decided before the state is used up: someone else holding the link can neither finish it nor spend it
  if (str(row, "startedBy") !== actorOf(ctx)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "This sign-in was started by someone else. Only they can finish it." });
  ctx.db.run(`DELETE FROM microsoft_user_oauth WHERE state = ?`, state);   // one use, whatever happens next
  if (ctx.now() - Number(row["created_at"]) > OAUTH_TTL_MS) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "This sign-in link has expired: start again." });
  if (text(i["error"])) {
    throw fail("validation.precondition_failed", ctx.trace.traceId, {
      message: i["error"] === "access_denied" ? "Microsoft was not given access: the sign-in was declined." : "Microsoft ended the sign-in without giving access.", details: { reason: "declined" },
    });
  }
  const code = text(i["code"]) ?? "";
  if (code === "") bad(ctx, "Microsoft did not send a sign-in code.");

  const tokens = await needHost(ctx).userExchange(ctx, { appHandle: userAppHandle(ctx), code, verifier: str(row, "verifier"), redirectUri: str(row, "redirectUri") });
  // whose mailbox it is: the address Graph says
  let profile: { status: number; body: string };
  try {
    const res = await ctx.http(`${GRAPH}/me?$select=mail,userPrincipalName`, { method: "GET", headers: { authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" } });
    profile = { status: res.status, body: await res.text() };
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;
    throw fail("provider.network", ctx.trace.traceId, { message: "Microsoft could not be reached." });
  }
  if (profile.status >= 300) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Microsoft did not accept the new sign-in. Check that the app may read mail.", details: { status: profile.status } });
  let who: Record<string, unknown> = {};
  try { who = obj(JSON.parse(profile.body)); } catch { /* answered below */ }
  const email = normalizeEmail(text(who["mail"]) ?? text(who["userPrincipalName"]) ?? "");
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft did not say whose mailbox this is." });

  const owner = actorOf(ctx);
  const known = first(ctx.db.all(`SELECT * FROM microsoft_user_account WHERE "ownerId" = ? AND email = ?`, owner, email));
  let accountId: string;
  if (known) {
    // signing in again to the same address keeps the account (and its mailbox) and replaces the token
    accountId = str(known, "accountId");
    ctx.db.run(`UPDATE microsoft_user_account SET "refreshSealed" = ? WHERE "accountId" = ?`, sealed(ctx, tokens.refreshToken), accountId);
  } else {
    accountId = newId("mua", ctx.now());
    ctx.db.run(`INSERT INTO microsoft_user_account ("accountId", "ownerId", email, "refreshSealed", created_at) VALUES (?, ?, ?, ?, ?)`, accountId, owner, email, sealed(ctx, tokens.refreshToken), ctx.now());
  }
  // the mailbox is the person's own, made through mail like any other; a mailbox for this address that is already there is the one to use
  let mailboxId: string | undefined;
  try {
    const made = obj(await ctx.call("mail.connect", { provider: "microsoft", address: email, connectionId: accountId, idempotencyKey: `mua-connect:${accountId}` }));
    mailboxId = text(obj(made["mailbox"])["id"]);
  } catch (e) {
    if (codeOf(e) !== "validation.duplicate") throw e;
  }
  if (mailboxId) await ctx.call("mail.sync_now", { mailboxId }).catch((e: unknown) => ctx.log.warn("microsoft first pull did not start", { code: codeOf(e) }));
  ctx.emit("microsoft.user_connected", `entity/${accountId}`, { accountId, email });
  return { accountId, email, ...(mailboxId ? { mailboxId } : {}) };
}

// ---- accounts

export function userList(ctx: MsCtx) {
  ensure(ctx);
  const me = actorOf(ctx);
  const rows: Row[] = rowsOf(ctx.db.all(`SELECT * FROM microsoft_user_account WHERE "ownerId" = ?`, me)).sort((a, b) => Number(a["created_at"]) - Number(b["created_at"]));
  return { accounts: rows.map((r) => ({ accountId: str(r, "accountId"), email: str(r, "email") })) };
}

export async function userRemove(ctx: MsCtx, input: unknown) {
  const a = userAccount(ctx, text(obj(input)["accountId"]) ?? "");
  // Microsoft has no revoke address for a person's token: the rows, and with them the sealed token, go, and the person removes the app's access in their account if they want it gone there too
  ctx.db.run(`DELETE FROM microsoft_user_account WHERE "accountId" = ?`, a.accountId);
  ctx.db.run(`DELETE FROM microsoft_mailbox WHERE "connectionId" = ?`, a.accountId);
  return { removed: true };
}

