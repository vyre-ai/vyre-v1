// OAuth 2 for connectors: the sign-in code exchange (with PKCE), where tokens live, refresh and revoke. Tokens exist only in Vault items, made and changed through the original caller's own Vault
// capabilities; the connection keeps their handles and this module's tables keep the item ids and the expiry, never a value. Every message and log passes the scrubber with the code, the PKCE
// verifier, the client secret and the tokens in it.
import { sha256b64 } from "../../../kernel/src/seal/index.ts";
import { checkEgress, mintShort, nowOf, refuse, scrubber } from "../projections.ts";
import type { ConnectionDb, ConnectorDef, ConnectorsCtx, ConnectorsDeps } from "../projections.ts";

export const OAUTH_TTL_MS = 10 * 60_000;
/** A token this close to its end is refreshed before the call that would use it. */
export const REFRESH_SKEW_MS = 60_000;
const MAX_TOKEN = 8192;
const MAX_EXPIRES_S = 366 * 24 * 3600;

export const refreshSlot = (def: ConnectorDef): string | undefined => {
  const name = def.auth.secret ? `${def.auth.secret}_refresh` : undefined;
  return name && def.secrets.some((s) => s.name === name) ? name : undefined;
};

/** A PKCE pair (RFC 7636, S256): the challenge goes to the provider, the verifier stays here until the code is exchanged. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  return { verifier, challenge: sha256b64(verifier).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") };
}

export interface TokenSet { access: string; refresh?: string; expiresInS?: number }
type Row = Record<string, unknown>;
const secretsOf = (c: ConnectionDb): Record<string, string> => JSON.parse(c.secrets) as Record<string, string>;
const codeOf = (e: unknown): string => (e as { error?: { code?: string } })?.error?.code ?? "";

/** Refreshes in flight, by connection. Module wide, because every call builds its own handlers: a second caller must find the first one's refresh. */
const refreshing = new Map<string, Promise<boolean>>();

export function createOauth(deps: ConnectorsDeps) {
  const { tx } = deps;

  /** The client secret, by its declared slot, read through the Vault like any other secret of the connection. */
  const clientSecretOf = async (ctx: ConnectorsCtx, def: ConnectorDef, conn: ConnectionDb): Promise<string | undefined> => {
    const slot = def.auth.clientSecret;
    const handle = slot ? secretsOf(conn)[slot] : undefined;
    if (!slot || !handle || !deps.resolveSecret) return undefined;
    try { return await deps.resolveSecret(handle, { connector: def.key, connectionId: conn.connection_id, slot }); }
    catch (e) { return vaultFailure(ctx, e, conn); }
  };

  /** POST to the token address (a declared domain, https) and read the tokens. Never throws a message with a code, token or secret in it. */
  async function tokenCall(ctx: ConnectorsCtx, def: ConnectorDef, conn: ConnectionDb, form: URLSearchParams, hide: string[]): Promise<TokenSet> {
    const eg = def.auth.tokenUrl ? checkEgress(def.auth.tokenUrl, def.domains) : { ok: false as const, reason: "no token address is declared" };
    if (!eg.ok) return refuse(ctx, "permission.no_grant", `Egress refused: ${eg.reason}.`);
    const clientSecret = await clientSecretOf(ctx, def, conn);
    if (def.auth.clientId) form.set("client_id", def.auth.clientId);
    if (clientSecret) form.set("client_secret", clientSecret);
    const scrub = scrubber([...hide, ...(clientSecret ? [clientSecret] : [])]);
    let res: { status: number; text(): Promise<string> };
    try {
      res = await ctx.http(eg.url.toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
    } catch (e) {
      return refuse(ctx, "provider.network", scrub.text(`The app could not be reached: ${e instanceof Error ? e.message : String(e)}`));
    }
    const text = await res.text();
    if (res.status >= 500) return refuse(ctx, "provider.unavailable", `The app answered ${res.status}.`, { status: res.status });
    if (res.status === 429) return refuse(ctx, "provider.rate_limited", "The app is rate limiting sign-ins. Wait a moment and try again.", { status: res.status });
    if (res.status >= 400) return refuse(ctx, "provider.auth_failed", "The app did not accept the sign-in.", { status: res.status });
    let body: Row;
    try { body = JSON.parse(text) as Row; } catch { return refuse(ctx, "provider.bad_response", "The app answered the sign-in in an unexpected way."); }
    const access = body["access_token"], refresh = body["refresh_token"], type = body["token_type"], expires = body["expires_in"];
    if (typeof access !== "string" || access === "" || access.length > MAX_TOKEN) return refuse(ctx, "provider.bad_response", "The app did not return an access token.");
    if (typeof type === "string" && type.toLowerCase() !== "bearer") return refuse(ctx, "provider.bad_response", `The app issued a ${type} token; only bearer tokens are supported.`);
    if (refresh !== undefined && (typeof refresh !== "string" || refresh.length > MAX_TOKEN)) return refuse(ctx, "provider.bad_response", "The app returned a refresh token in an unexpected form.");
    if (expires !== undefined && !(typeof expires === "number" && Number.isFinite(expires) && expires > 0 && expires <= MAX_EXPIRES_S)) return refuse(ctx, "provider.bad_response", "The app returned a token lifetime that cannot be used.");
    return { access, ...(typeof refresh === "string" ? { refresh } : {}), ...(typeof expires === "number" ? { expiresInS: expires } : {}) };
  }

  /** Where a connection's tokens are kept: a Vault folder of the owner's own (Mine, for a person) or of the Space (Shared), called Connections. */
  async function folderFor(ctx: ConnectorsCtx, conn: ConnectionDb): Promise<string> {
    const scope = conn.owner_kind === "person" ? "mine" : "shared";
    try {
      const listed = (await ctx.call("vault.folders.list", { scope })) as { folders: { id: string; name: string }[] };
      const have = listed.folders.find((f) => f.name === "Connections");
      if (have) return have.id;
      return ((await ctx.call("vault.folders.create", { name: "Connections", scope, idempotencyKey: `connections-folder:${scope}:${conn.owner_id}` })) as { folder: { id: string } }).folder.id;
    } catch (e) { return vaultFailure(ctx, e, conn); }
  }
  function vaultFailure(ctx: ConnectorsCtx, e: unknown, conn: ConnectionDb): never {
    if (codeOf(e) === "auth.unauthenticated" || /key is locked/i.test((e as { error?: { message?: string } })?.error?.message ?? "")) {
      return refuse(ctx, "auth.unauthenticated", conn.owner_kind === "person"
        ? "Your vault is locked on this computer. Unlock it (sign in on the computer that runs this server), then connect again: a personal account's tokens are kept in your own vault and are never put anywhere shared."
        : "The Vault is locked, so the sign-in cannot be kept. Try again from a signed-in session.");
    }
    throw e;
  }

  /** Save tokens: one Vault item per slot, created the first time and updated after, with the item ids and the expiry recorded here. Returns the handle of each slot. */
  async function saveTokens(ctx: ConnectorsCtx, def: ConnectorDef, conn: ConnectionDb, tokens: TokenSet): Promise<Record<string, string>> {
    const now = nowOf(deps);
    const slots: [string, string][] = [[def.auth.secret!, tokens.access]];
    const rs = refreshSlot(def);
    if (tokens.refresh && rs) slots.push([rs, tokens.refresh]);
    const expiresAt = tokens.expiresInS === undefined ? null : now + tokens.expiresInS * 1000;
    const handles: Record<string, string> = {};
    let folder: string | undefined;
    for (const [slot, value] of slots) {
      const have = tx.get<{ item_id: string }>("SELECT item_id FROM cn_oauth_tokens WHERE connection_id = ? AND slot = ?", conn.connection_id, slot);
      try {
        if (have) {
          await ctx.call("vault.item.update", { itemId: have.item_id, fieldsSet: [{ key: "token", value, secret: true }] });
          const kept = secretsOf(conn)[slot];
          if (kept) handles[slot] = kept;
        } else {
          folder ??= await folderFor(ctx, conn);
          const made = (await ctx.call("vault.item.put", { folderId: folder, name: `${conn.title} ${slot} ${conn.connection_id.slice(-6)}`, kind: "other", fields: [{ key: "token", value, secret: true }], idempotencyKey: `oauth-token:${conn.connection_id}:${slot}:${now}` })) as { item: { id: string; handle: string } };
          tx.run("INSERT OR REPLACE INTO cn_oauth_tokens (connection_id, slot, item_id, expires_at) VALUES (?, ?, ?, NULL)", conn.connection_id, slot, made.item.id);
          handles[slot] = made.item.handle;
        }
      } catch (e) { return vaultFailure(ctx, e, conn); }
    }
    tx.run("UPDATE cn_oauth_tokens SET expires_at = ? WHERE connection_id = ? AND slot = ?", expiresAt, conn.connection_id, def.auth.secret!);
    return handles;
  }

  /** Turn an authorization code into tokens and keep them. */
  async function exchangeCode(ctx: ConnectorsCtx, def: ConnectorDef, conn: ConnectionDb, code: string, verifier: string, redirectUri: string): Promise<Record<string, string>> {
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
    const tokens = await tokenCall(ctx, def, conn, form, [code, verifier]);
    return saveTokens(ctx, def, conn, tokens);
  }

  /** The access token ends soon (or has ended). */
  const dueSoon = (conn: ConnectionDb, def: ConnectorDef): boolean => {
    const row = tx.get<{ expires_at: number | null }>("SELECT expires_at FROM cn_oauth_tokens WHERE connection_id = ? AND slot = ?", conn.connection_id, def.auth.secret ?? "");
    return row?.expires_at != null && row.expires_at - nowOf(deps) <= REFRESH_SKEW_MS;
  };

  /**
   * Refresh the access token with the refresh token. Calls for one connection are serialized: a second caller waits for the first and shares its result, so a rotating refresh token is
   * spent once. Returns false when there is nothing to refresh with or the app refused; the caller then asks the person to reconnect.
   */
  function refresh(ctx: ConnectorsCtx, def: ConnectorDef, conn: ConnectionDb): Promise<boolean> {
    const running = refreshing.get(conn.connection_id);
    if (running) return running;
    const job = (async (): Promise<boolean> => {
      const rs = refreshSlot(def), handle = rs ? secretsOf(conn)[rs] : undefined;
      if (!rs || !handle || !deps.resolveSecret) return false;
      const token = await deps.resolveSecret(handle, { connector: def.key, connectionId: conn.connection_id, slot: rs }).catch(() => undefined);
      if (!token) return false;
      try {
        const tokens = await tokenCall(ctx, def, conn, new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }), [token]);
        const handles = await saveTokens(ctx, def, conn, { ...tokens, refresh: tokens.refresh ?? token });
        const secrets = { ...secretsOf(conn), ...handles };
        tx.run("UPDATE cn_connections SET secrets = ? WHERE connection_id = ?", JSON.stringify(secrets), conn.connection_id);
        return true;
      } catch (e) {
        ctx.log?.warn("oauth refresh failed", { connectionId: conn.connection_id, code: codeOf(e) });
        return false;
      }
    })().finally(() => { refreshing.delete(conn.connection_id); });
    refreshing.set(conn.connection_id, job);
    return job;
  }

  /** On delete: ask the app to revoke (best effort, a declared revoke address only), then remove the Vault items. */
  async function revoke(ctx: ConnectorsCtx, def: ConnectorDef | undefined, conn: ConnectionDb): Promise<void> {
    const items = tx.all<{ slot: string; item_id: string }>("SELECT slot, item_id FROM cn_oauth_tokens WHERE connection_id = ?", conn.connection_id);
    if (def?.auth.revokeUrl && deps.resolveSecret) {
      const eg = checkEgress(def.auth.revokeUrl, def.domains);
      if (eg.ok) for (const it of items) {
        const handle = secretsOf(conn)[it.slot];
        const token = handle ? await deps.resolveSecret(handle, { connector: def.key, connectionId: conn.connection_id, slot: it.slot }).catch(() => undefined) : undefined;
        if (!token) continue;
        const form = new URLSearchParams({ token, token_type_hint: it.slot === def.auth.secret ? "access_token" : "refresh_token" });
        if (def.auth.clientId) form.set("client_id", def.auth.clientId);
        const clientSecret = await clientSecretOf(ctx, def, conn).catch(() => undefined);
        if (clientSecret) form.set("client_secret", clientSecret);
        try { await ctx.http(eg.url.toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }); }
        catch (e) { ctx.log?.warn("oauth revoke did not reach the app", { connectionId: conn.connection_id, error: scrubber([token, ...(clientSecret ? [clientSecret] : [])]).text(e instanceof Error ? e.message : String(e)) }); }
      }
    }
    for (const it of items) await ctx.call("vault.item.delete", { itemId: it.item_id }).catch((e: unknown) => ctx.log?.warn("oauth token item was not removed", { connectionId: conn.connection_id, code: codeOf(e) }));
    tx.run("DELETE FROM cn_oauth_tokens WHERE connection_id = ?", conn.connection_id);
  }

  return { tokenCall, exchangeCode, refresh, dueSoon, revoke, mintState: (): string => mintShort("oas", nowOf(deps)) };
}

export const oauthOf = (deps: ConnectorsDeps): ReturnType<typeof createOauth> => createOauth(deps);
