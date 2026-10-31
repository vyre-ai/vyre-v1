// dropbox.app.*, dropbox.connect.*, dropbox.account.* and dropbox.health: the Dropbox app, and signing a person (or the Space) in to a Dropbox account.
// The app is a Vault item (#Dropbox_App, fields app_key and, for a webhook, app_secret). A sign-in is OAuth with PKCE and offline access:
//   connect.start     makes the state and the PKCE pair, keeps the verifier here, and answers the Dropbox address the person approves at
//   connect.complete  the callback page hands back the state and code; only the person who started it can finish it. The tokens are exchanged by the host, the refresh token goes into a Vault item
//                     (Mine for a person's own Dropbox, Shared for the Space's), and the access token is dropped: it is made again from the refresh token for every stretch of work.
// DECISION: a person's connection is theirs alone (the host's own services act for it, as Google and Microsoft do), a Space connection is open to every member and takes the connectors.manage grant.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  accountOf, accountsFor, actorOf, APP_HANDLE, AUTHORIZE, bad, codeOf, config, CONFIG_ID, ensure, first, FOLDER_NAME, intOrUndef, needConfig, needHost, obj, parseBody, rowsOf, SCOPES, sendJson,
  str, strOrUndef, text, tokenFor,
} from "../projections.ts";
import type { Account, DropboxCtx } from "../projections.ts";

const OAUTH_TTL_MS = 10 * 60_000;

const hex = (n: number): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))).toString("hex");

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(new Uint8Array(digest)).toString("base64url") };
}

const accountRow = (a: Account) => ({ connectionId: a.connectionId, ownerKind: a.ownerKind, accountId: a.accountId, ...(a.email ? { email: a.email } : {}), ...(a.name ? { name: a.name } : {}) });

// ---- the app

export async function appStatus(ctx: DropboxCtx) {
  const cfg = config(ctx);
  if (!cfg) return { configured: false };
  const base = await needHost(ctx).publicUrl(ctx).catch(() => undefined);
  return { configured: true, appKey: str(cfg, "appKey"), vaultItem: str(cfg, "vaultItem"), ...(base ? { redirectUri: `${base.replace(/\/+$/, "")}/oauth/callback` } : {}) };
}

export async function appSet(ctx: DropboxCtx, input: unknown) {
  ensure(ctx);
  const handle = text(obj(input)["vaultItem"]);
  if (!APP_HANDLE.test(handle)) bad(ctx, "The Vault item is not a valid handle, such as #Dropbox_App.");
  const app = await needHost(ctx).app(ctx, handle);
  const now = ctx.now();
  if (config(ctx)) ctx.db.run(`UPDATE dropbox_config SET "vaultItem" = ?, "appKey" = ?, "updated_at" = ? WHERE "id" = ?`, handle, app.appKey, now, CONFIG_ID);
  else ctx.db.run(`INSERT INTO dropbox_config ("id", "vaultItem", "appKey", "updated_at") VALUES (?, ?, ?, ?)`, CONFIG_ID, handle, app.appKey, now);
  return { configured: true, appKey: app.appKey, webhooks: app.hasSecret };
}

// ---- signing in

export async function connectStart(ctx: DropboxCtx, input: unknown) {
  ensure(ctx);
  const ownerKind = obj(input)["ownerKind"] === "space" ? "space" : "person";
  if (ownerKind === "space" && ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "space", id: ctx.space }).effect !== "allow") {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only an admin can connect a Dropbox for the whole Space." });
  }
  const { appKey } = needConfig(ctx);
  const base = (await needHost(ctx).publicUrl(ctx)).replace(/\/+$/, "");
  const redirectUri = `${base}/oauth/callback`;
  const now = ctx.now();
  // a sign-in that was started and never finished is not kept past its ten minutes
  ctx.db.run(`DELETE FROM dropbox_oauth WHERE "startedBy" = ? AND "created_at" < ?`, actorOf(ctx), now - OAUTH_TTL_MS);
  const state = `dbs_${hex(24)}`;
  const { verifier, challenge } = await pkce();
  ctx.db.run(`INSERT INTO dropbox_oauth ("state", "ownerKind", "startedBy", "verifier", "redirectUri", "created_at") VALUES (?, ?, ?, ?, ?, ?)`, state, ownerKind, actorOf(ctx), verifier, redirectUri, now);
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", appKey);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("token_access_type", "offline");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return { authUrl: u.toString(), state };
}

interface Folders { folders: { id: string; name: string }[] }

/** The Vault folder the refresh token goes in: Connections, in Mine for a person and Shared for the Space. */
async function folderFor(ctx: DropboxCtx, ownerKind: "person" | "space", ownerId: string): Promise<string> {
  const scope = ownerKind === "person" ? "mine" : "shared";
  const have = (obj(await ctx.call("vault.folders.list", { scope })) as unknown as Folders).folders.find((f) => f.name === FOLDER_NAME);
  if (have) return have.id;
  return text(obj(obj(await ctx.call("vault.folders.create", { name: FOLDER_NAME, scope, idempotencyKey: `connections-folder:${scope}:${ownerId}` }))["folder"])["id"]);
}

export async function connectComplete(ctx: DropboxCtx, input: unknown) {
  ensure(ctx);
  const i = obj(input);
  const state = text(i["state"]);
  const row = first(ctx.db.all(`SELECT * FROM dropbox_oauth WHERE "state" = ?`, state));
  if (!row) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "This sign-in link is wrong or was already used." });
  // whose sign-in this is decided before the state is used up: someone else holding the link can neither finish it nor spend it
  if (str(row, "startedBy") !== actorOf(ctx)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "This sign-in was started by someone else. Only they can finish it." });
  ctx.db.run(`DELETE FROM dropbox_oauth WHERE "state" = ?`, state);   // one use, whatever happens next
  if (ctx.now() - Number(row["created_at"]) > OAUTH_TTL_MS) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "This sign-in link has expired: start again." });
  if (strOrUndef(i["error"]) !== undefined) {
    throw fail("validation.precondition_failed", ctx.trace.traceId, {
      message: i["error"] === "access_denied" ? "Dropbox was not given access: the sign-in was declined." : "Dropbox ended the sign-in without giving access.", details: { reason: "declined" },
    });
  }
  const code = text(i["code"]);
  if (code === "") bad(ctx, "Dropbox did not send a sign-in code.");

  const { vaultItem } = needConfig(ctx);
  const tokens = await needHost(ctx).exchange(ctx, { appHandle: vaultItem, code, verifier: str(row, "verifier"), redirectUri: str(row, "redirectUri") });
  // who the account is: its id, address and name
  const me = await sendJson(ctx, tokens.accessToken, { path: "/users/get_current_account" });
  if (me.status >= 300) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Dropbox did not accept the new sign-in.", details: { status: me.status } });
  const who = parseBody(me.raw);
  const accountId = text(who["account_id"]) || tokens.accountId || "";
  if (accountId === "") throw fail("provider.bad_response", ctx.trace.traceId, { message: "Dropbox did not say whose account this is." });
  const email = strOrUndef(who["email"]);
  const name = strOrUndef(obj(who["name"])["display_name"]);

  const ownerKind = str(row, "ownerKind") === "space" ? "space" : "person";
  const ownerId = ownerKind === "space" ? "space" : actorOf(ctx);
  const known = first(ctx.db.all(`SELECT * FROM dropbox_account WHERE "ownerKind" = ? AND "ownerId" = ? AND "accountId" = ?`, ownerKind, ownerId, accountId));
  let connectionId: string;
  if (known) {
    // signing in again to the same Dropbox account keeps the connection (and every mount on it) and replaces the token
    connectionId = str(known, "connectionId");
    await ctx.call("vault.item.update", { itemId: str(known, "refreshItem"), fieldsSet: [{ key: "token", value: tokens.refreshToken, secret: true }] });
    ctx.db.run(`UPDATE dropbox_account SET "email" = ?, "name" = ? WHERE "connectionId" = ?`, email ?? null, name ?? null, connectionId);
  } else {
    connectionId = `con_${hex(12)}`;
    const folderId = await folderFor(ctx, ownerKind, ownerId);
    const made = obj(obj(await ctx.call("vault.item.put", {
      folderId, name: `Dropbox ${email ?? accountId.slice(-8)} ${connectionId.slice(-6)}`, kind: "other", fields: [{ key: "token", value: tokens.refreshToken, secret: true }], idempotencyKey: `dropbox-token:${connectionId}`,
    }))["item"]);
    const itemId = text(made["id"]), handle = text(made["handle"]);
    if (itemId === "" || handle === "") throw fail("provider.bad_response", ctx.trace.traceId, { message: "The Vault did not keep the Dropbox sign-in." });
    ctx.db.run(
      `INSERT INTO dropbox_account ("connectionId", "ownerKind", "ownerId", "accountId", "email", "name", "refreshHandle", "refreshItem", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      connectionId, ownerKind, ownerId, accountId, email ?? null, name ?? null, handle, itemId, ctx.now(),
    );
  }
  ctx.emit("dropbox.connected", `entity/${connectionId}`, { connectionId, accountId, ownerKind, ...(email ? { email } : {}) });
  return { connectionId, accountId, ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

// ---- accounts

export function accountList(ctx: DropboxCtx) {
  return { connections: accountsFor(ctx).map(accountRow) };
}

export async function accountRemove(ctx: DropboxCtx, input: unknown) {
  const a = accountOf(ctx, text(obj(input)["connectionId"]));
  if (a.ownerKind === "space" && ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "space", id: ctx.space }).effect !== "allow") {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only an admin can remove the Space's Dropbox." });
  }
  // Dropbox is told first (best effort: a token it already lost is not a reason to keep the connection), then the Vault item and the rows go
  try { await sendJson(ctx, await tokenFor(ctx, a), { path: "/auth/token/revoke" }); } catch (e) { ctx.log.warn("dropbox token was not revoked", { code: codeOf(e) }); }
  await ctx.call("vault.item.delete", { itemId: a.refreshItem }).catch((e: unknown) => ctx.log.warn("dropbox token item was not removed", { code: codeOf(e) }));
  ctx.db.run(`DELETE FROM dropbox_account WHERE "connectionId" = ?`, a.connectionId);
  ctx.db.run(`DELETE FROM dropbox_node WHERE "connectionId" = ?`, a.connectionId);
  return { removed: true };
}

/** Probe: the first connection answers get_current_account. A server with no app, or no connection yet, is not unhealthy. */
export async function health(ctx: DropboxCtx) {
  ensure(ctx);
  if (!config(ctx)) return { state: "healthy" as const, detail: "Dropbox is not set up." };
  const a = rowsOf(ctx.db.all(`SELECT * FROM dropbox_account ORDER BY "created_at"`))[0];
  if (!a) return { state: "healthy" as const, detail: "No Dropbox is connected." };
  const started = ctx.now();
  try {
    const acct = accountOf(ctx, str(a, "connectionId"));
    const res = await sendJson(ctx, await tokenFor(ctx, acct), { path: "/users/get_current_account" });
    if (res.status === 401 || res.status === 403) return { state: "down" as const, detail: "Dropbox no longer accepts the connection. Connect it again." };
    if (res.status >= 300) return { state: "degraded" as const, detail: `Dropbox answered ${res.status}.` };
  } catch (e) {
    return { state: "down" as const, detail: codeOf(e) === "provider.auth_failed" ? "Dropbox no longer accepts the connection. Connect it again." : "Dropbox could not be reached." };
  }
  const ms = ctx.now() - started;
  return { state: ms > 2000 ? ("degraded" as const) : ("healthy" as const), latencyMs: intOrUndef(ms) ?? 0 };
}
