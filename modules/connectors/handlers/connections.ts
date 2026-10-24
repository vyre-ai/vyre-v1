// Connections (spec 2.10, 4.18): one account plugged into a connector, owned by a person or the Space. The owner can pause it. It starts Pending until the sign-in or the first good
// probe, and a provider that rejects the key sends it to needs_reconnect. A connection holds the NAME of the Vault item for each secret, never a value.
import { checkEgress, ensureTables, mintShort, nowOf, PAGE, refuse, scrubber, seedBuiltins } from "../projections.ts";
import type { ConnectionDb, ConnectionState, ConnectorDef, ConnectorsCtx, ConnectorsDeps } from "../projections.ts";
import { executeAction } from "./runtime.ts";

export interface ConnectionRow {
  connectionId: string; connector: string; title: string; owner: { kind: "person" | "space"; id: string }; state: ConnectionState; pausedBy?: string; scopes: string[]; lastSyncAt?: number; createdAt: number;
}
type Health = { state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number };

export interface ConnectionsHandlers {
  "connections.list"(ctx: ConnectorsCtx, input: { connector?: string; whose?: "mine" | "space" | "all"; cursor?: string; limit?: number }): Promise<{ connections: ConnectionRow[]; next?: string; total?: number }>;
  "connections.get"(ctx: ConnectorsCtx, input: { connectionId: string }): Promise<{ connection: ConnectionRow }>;
  "connections.create"(ctx: ConnectorsCtx, input: { connector: string; title: string; ownerKind: "person" | "space"; secrets?: Record<string, string>; scopes?: string[] }): Promise<{ connection: ConnectionRow; authUrl?: string }>;
  "connections.update"(ctx: ConnectorsCtx, input: { connectionId: string; title?: string; scopes?: string[] }): Promise<{ connection: ConnectionRow }>;
  "connections.pause"(ctx: ConnectorsCtx, input: { connectionId: string }): Promise<{ ok: boolean }>;
  "connections.resume"(ctx: ConnectorsCtx, input: { connectionId: string }): Promise<{ ok: boolean }>;
  "connections.reconnect"(ctx: ConnectorsCtx, input: { connectionId: string }): Promise<{ authUrl?: string }>;
  "connections.complete_auth"(ctx: ConnectorsCtx, input: { state: string; code: string }): Promise<{ connectionId: string }>;
  "connections.test"(ctx: ConnectorsCtx, input: { connectionId: string }): Promise<Health>;
  "connections.delete"(ctx: ConnectorsCtx, input: { connectionId: string }): Promise<{ deleted: boolean }>;
}

const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const OAUTH_TTL_MS = 10 * 60_000;

export function createConnectionsHandlers(deps: ConnectorsDeps): ConnectionsHandlers {
  const { tx } = deps;
  const ready = (): void => { ensureTables(tx); seedBuiltins(deps); };
  const actorOf = (ctx: ConnectorsCtx): string => ctx.actor ?? "system";

  const rowOf = (r: ConnectionDb): ConnectionRow => ({
    connectionId: r.connection_id, connector: r.connector, title: r.title, owner: { kind: r.owner_kind, id: r.owner_id }, state: r.state,
    ...(r.paused_by ? { pausedBy: r.paused_by } : {}), scopes: JSON.parse(r.scopes) as string[], ...(r.last_sync_at !== null ? { lastSyncAt: r.last_sync_at } : {}), createdAt: r.created_at,
  });
  /** A person sees their own connections and the Space's; nobody sees another person's. */
  const visible = (ctx: ConnectorsCtx, r: ConnectionDb): boolean => r.owner_kind === "space" || r.owner_id === actorOf(ctx);
  const need = (ctx: ConnectorsCtx, id: string): ConnectionDb => {
    ready();
    const r = tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", id);
    if (!r || !visible(ctx, r)) return refuse(ctx, "validation.not_found", "There is no such connection.");
    return r;
  };
  /** Only the owner pauses or changes a person's connection; a Space connection is open to whoever manages it (the host checks level manage). */
  const owned = (ctx: ConnectorsCtx, r: ConnectionDb): void => {
    if (r.owner_kind === "person" && r.owner_id !== actorOf(ctx)) refuse(ctx, "permission.no_grant", "Only the owner of this connection can change it.");
  };
  const defOf = (ctx: ConnectorsCtx, key: string): ConnectorDef => {
    const c = tx.get<{ def: string; state: string }>("SELECT def, state FROM cn_connectors WHERE key = ?", key);
    if (!c) return refuse(ctx, "validation.not_found", `There is no connector ${key}.`);
    return JSON.parse(c.def) as ConnectorDef;
  };
  const secretsOf = (r: ConnectionDb): Record<string, string> => JSON.parse(r.secrets) as Record<string, string>;

  /** Pending until the thing that makes it usable has happened. */
  const initialState = (def: ConnectorDef, secrets: Record<string, string>): ConnectionState => {
    if (def.mode === "webhook_only") return "active";
    if (def.mode === "api") return def.secrets.every((s) => secrets[s.name] !== undefined) ? "active" : "pending";
    return "pending";
  };

  const authUrlFor = (def: ConnectorDef, conn: ConnectionDb, scopes: string[], reconnect: boolean, ctx: ConnectorsCtx): string | undefined => {
    if (def.auth.type !== "oauth2" || !def.auth.authUrl) return undefined;
    const eg = checkEgress(def.auth.authUrl, def.domains);
    if (!eg.ok) return refuse(ctx, "permission.no_grant", `Egress refused: ${eg.reason}.`);
    const now = nowOf(deps);
    const state = mintShort("oas", now);
    tx.run("INSERT INTO cn_oauth (state, connection_id, created_at, reconnect) VALUES (?, ?, ?, ?)", state, conn.connection_id, now, reconnect ? 1 : 0);
    const u = new URL(eg.url.toString());
    u.searchParams.set("response_type", "code");
    if (def.auth.clientId) u.searchParams.set("client_id", def.auth.clientId);
    u.searchParams.set("redirect_uri", `${deps.publicBase ?? ""}/oauth/callback`);
    const sc = scopes.length ? scopes : (def.auth.scopes ?? []);
    if (sc.length) u.searchParams.set("scope", sc.join(" "));
    u.searchParams.set("state", state);
    return u.toString();
  };

  return {
    "connections.list": async (ctx, input) => {
      ready();
      const me = actorOf(ctx);
      const whose = input.whose ?? "all";
      let rows = tx.all<ConnectionDb>(`SELECT * FROM cn_connections ${input.connector !== undefined ? "WHERE connector = ?" : ""} ORDER BY created_at, connection_id`, ...(input.connector !== undefined ? [input.connector] : []));
      rows = rows.filter((r) => (whose === "mine" ? r.owner_kind === "person" && r.owner_id === me : whose === "space" ? r.owner_kind === "space" : visible(ctx, r)));
      const { start, limit } = PAGE(input);
      return { connections: rows.slice(start, start + limit).map(rowOf), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "connections.get": async (ctx, input) => ({ connection: rowOf(need(ctx, input.connectionId)) }),

    "connections.create": async (ctx, input) => {
      ready();
      const def = defOf(ctx, input.connector);
      const c = tx.get<{ state: string }>("SELECT state FROM cn_connectors WHERE key = ?", input.connector)!;
      if (c.state === "draft") refuse(ctx, "validation.precondition_failed", `${input.connector} is a draft: publish it before connecting an account.`);
      if (!input.title.trim()) refuse(ctx, "validation.bad_input", "A connection needs a title.");
      if (def.scope === "space" && input.ownerKind !== "space") refuse(ctx, "validation.precondition_failed", `${def.title} connects to the Space, not to a person.`);
      if (def.scope === "person" && input.ownerKind !== "person") refuse(ctx, "validation.precondition_failed", `${def.title} connects to a person's own account.`);
      if (def.auth.type === "oauth2" && def.auth.authUrl) {
        const eg = checkEgress(def.auth.authUrl, def.domains);
        if (!eg.ok) refuse(ctx, "permission.no_grant", `Egress refused: ${eg.reason}.`);
      }
      const secrets = input.secrets ?? {};
      for (const [name, handle] of Object.entries(secrets)) {
        if (!def.secrets.some((s) => s.name === name)) refuse(ctx, "validation.bad_input", `${def.title} has no secret called ${name}.`);
        if (!HANDLE.test(handle)) refuse(ctx, "validation.bad_input", `${name} must be the name of a Vault item such as #Name, not a value.`);
      }
      const now = nowOf(deps);
      const id = mintShort("con", now);
      const state = initialState(def, secrets);
      tx.run(
        "INSERT INTO cn_connections (connection_id, connector, title, owner_kind, owner_id, state, scopes, secrets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, input.connector, input.title, input.ownerKind, input.ownerKind === "space" ? "space" : actorOf(ctx), state, JSON.stringify(input.scopes ?? []), JSON.stringify(secrets), now,
      );
      const row = tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", id)!;
      const authUrl = authUrlFor(def, row, input.scopes ?? [], false, ctx);
      // An OAuth connection is made when the sign-in comes back (complete_auth announces it); every other kind exists now.
      if (!authUrl) ctx.emit("connection.created", `connection/${id}`, { connectionId: id, connector: input.connector, ownerKind: input.ownerKind });
      return { connection: rowOf(row), ...(authUrl ? { authUrl } : {}) };
    },

    "connections.update": async (ctx, input) => {
      const r = need(ctx, input.connectionId);
      owned(ctx, r);
      if (input.title !== undefined && !input.title.trim()) refuse(ctx, "validation.bad_input", "A connection needs a title.");
      tx.run("UPDATE cn_connections SET title = ?, scopes = ? WHERE connection_id = ?", input.title ?? r.title, JSON.stringify(input.scopes ?? JSON.parse(r.scopes)), r.connection_id);
      return { connection: rowOf(need(ctx, r.connection_id)) };
    },

    "connections.pause": async (ctx, input) => {
      const r = need(ctx, input.connectionId);
      owned(ctx, r);
      if (r.state === "paused") return { ok: true };
      tx.run("UPDATE cn_connections SET state = 'paused', paused_by = ?, paused_from = ? WHERE connection_id = ?", actorOf(ctx), r.state, r.connection_id);
      ctx.emit("connection.paused", `connection/${r.connection_id}`, { connectionId: r.connection_id });
      return { ok: true };
    },

    "connections.resume": async (ctx, input) => {
      const r = need(ctx, input.connectionId);
      owned(ctx, r);
      if (r.state !== "paused") return { ok: true };
      tx.run("UPDATE cn_connections SET state = ?, paused_by = NULL, paused_from = NULL WHERE connection_id = ?", r.paused_from ?? "active", r.connection_id);
      ctx.emit("connection.resumed", `connection/${r.connection_id}`, { connectionId: r.connection_id });
      return { ok: true };
    },

    "connections.reconnect": async (ctx, input) => {
      const r = need(ctx, input.connectionId);
      owned(ctx, r);
      const def = defOf(ctx, r.connector);
      tx.run("UPDATE cn_connections SET state = 'pending', paused_by = NULL, paused_from = NULL WHERE connection_id = ?", r.connection_id);
      tx.run("DELETE FROM cn_oauth WHERE connection_id = ?", r.connection_id);
      const authUrl = authUrlFor(def, need(ctx, r.connection_id), JSON.parse(r.scopes) as string[], true, ctx);
      // Without a provider sign-in the person puts the key back in the Vault; the next test makes the connection active again.
      return authUrl ? { authUrl } : {};
    },

    "connections.complete_auth": async (ctx, input) => {
      ready();
      const row = tx.get<{ connection_id: string; created_at: number; reconnect: number }>("SELECT connection_id, created_at, reconnect FROM cn_oauth WHERE state = ?", input.state);
      if (!row) return refuse(ctx, "auth.invalid_code", "This sign-in link is wrong or was already used.");
      tx.run("DELETE FROM cn_oauth WHERE state = ?", input.state);
      if (nowOf(deps) - row.created_at > OAUTH_TTL_MS) return refuse(ctx, "auth.invalid_code", "This sign-in link has expired: start again.");
      const conn = tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", row.connection_id);
      if (!conn) return refuse(ctx, "validation.not_found", "The connection was removed while you signed in.");
      const def = defOf(ctx, conn.connector);
      if (def.auth.type !== "oauth2" || !def.auth.tokenUrl || !def.auth.secret) return refuse(ctx, "validation.precondition_failed", `${def.title} does not sign in with OAuth.`);
      const eg = checkEgress(def.auth.tokenUrl, def.domains);
      if (!eg.ok) return refuse(ctx, "permission.no_grant", `Egress refused: ${eg.reason}.`);
      const secrets = secretsOf(conn);
      const clientSecret = def.auth.clientSecret && secrets[def.auth.clientSecret] && deps.resolveSecret ? await deps.resolveSecret(secrets[def.auth.clientSecret]!) : undefined;
      const scrub = scrubber(clientSecret ? [clientSecret, input.code] : [input.code]);
      const form = new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: `${deps.publicBase ?? ""}/oauth/callback` });
      if (def.auth.clientId) form.set("client_id", def.auth.clientId);
      if (clientSecret) form.set("client_secret", clientSecret);
      let res: { status: number; text(): Promise<string> };
      try {
        res = await ctx.http(eg.url.toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
      } catch (e) {
        return refuse(ctx, "provider.network", scrub.text(`The app could not be reached: ${e instanceof Error ? e.message : String(e)}`));
      }
      const text = await res.text();
      if (res.status >= 400) return refuse(ctx, "provider.auth_failed", "The app did not accept the sign-in.", { status: res.status });
      let tokens: { access_token?: string; refresh_token?: string };
      try { tokens = JSON.parse(text) as typeof tokens; } catch { return refuse(ctx, "provider.bad_response", "The app answered the sign-in in an unexpected way."); }
      if (!tokens.access_token) return refuse(ctx, "provider.bad_response", "The app did not return an access token.");
      if (!deps.storeSecret) return refuse(ctx, "internal.unavailable", "The Vault is not available to keep the sign-in.");
      secrets[def.auth.secret] = await deps.storeSecret(`${conn.title}_${def.auth.secret}`, tokens.access_token);
      const refreshName = `${def.auth.secret}_refresh`;
      if (tokens.refresh_token && def.secrets.some((s) => s.name === refreshName)) secrets[refreshName] = await deps.storeSecret(`${conn.title}_${refreshName}`, tokens.refresh_token);
      tx.run("UPDATE cn_connections SET state = 'active', secrets = ? WHERE connection_id = ?", JSON.stringify(secrets), conn.connection_id);
      if (row.reconnect === 1) ctx.emit("connection.reconnected", `connection/${conn.connection_id}`, { connectionId: conn.connection_id });
      else ctx.emit("connection.created", `connection/${conn.connection_id}`, { connectionId: conn.connection_id, connector: conn.connector, ownerKind: conn.owner_kind });
      return { connectionId: conn.connection_id };
    },

    "connections.test": async (ctx, input) => {
      const r = need(ctx, input.connectionId);
      if (r.state === "paused") return { state: "down" as const, detail: `Paused${r.paused_by ? ` by ${r.paused_by}` : ""}.` };
      const def = defOf(ctx, r.connector);
      if (!def.health) return { state: "healthy" as const, detail: "This connector has no health call; nothing to probe." };
      const started = nowOf(deps);
      try {
        // a pending connection is probed too: the first good answer is what makes it active
        await executeAction(deps, ctx, def, def.health, { connection: r.state === "pending" ? { ...r, state: "active" } : r, input: {} });
      } catch (e) {
        const code = (e as { error?: { code?: string; message?: string } }).error?.code;
        const message = (e as { error?: { message?: string } }).error?.message ?? (e instanceof Error ? e.message : String(e));
        if (code === "provider.auth_failed") return { state: "down" as const, detail: message };
        if (code === "provider.rate_limited" || code === "rate_limit.exceeded") return { state: "degraded" as const, detail: message };
        if (code === "permission.no_grant" || code === "validation.precondition_failed" || code === "validation.bad_input") throw e;
        if (r.state === "active") tx.run("UPDATE cn_connections SET state = 'failing' WHERE connection_id = ?", r.connection_id);
        return { state: "down" as const, detail: message };
      }
      if (r.state === "pending" || r.state === "failing") tx.run("UPDATE cn_connections SET state = 'active' WHERE connection_id = ?", r.connection_id);
      return { state: "healthy" as const, latencyMs: nowOf(deps) - started };
    },

    "connections.delete": async (ctx, input) => {
      const r = need(ctx, input.connectionId);
      owned(ctx, r);
      tx.run("DELETE FROM cn_oauth WHERE connection_id = ?", r.connection_id);
      tx.run("DELETE FROM cn_connections WHERE connection_id = ?", r.connection_id);
      ctx.emit("connection.deleted", `connection/${r.connection_id}`, { connectionId: r.connection_id, connector: r.connector });
      return { deleted: true };
    },
  };
}
