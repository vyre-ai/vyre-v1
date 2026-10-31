// OAuth for remote MCP servers (the MCP authorization spec, 2025-06-18): a server that answers 401 names its protected-resource metadata, which names an authorization server, whose metadata
// gives the authorize, token and registration addresses. Vyre registers itself there as a public client (RFC 7591), sends the person to the authorize address with a PKCE challenge (S256) and the
// resource, takes the code back on /oauth/callback, and trades it for tokens. The tokens are sealed in engine_mcp_oauth (ctx.seal, scope mcp.oauth); the runtime asks for an access token per
// connection, which is refreshed a minute early and again on a 401. Every request goes through the network guard's fetch, so a private address is refused. No message or log holds a token, a code
// or a verifier.
import { sha256b64 } from "../../kernel/src/seal/index.ts";
import type { FetchPort } from "../../agent/src/mcp-client/index.ts";
import type { Sealed } from "../../packages/contracts/src/ctx.ts";

export interface OauthStore {
  db: { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): unknown };
  seal: { seal(v: Uint8Array, scope: string): Sealed; unseal(s: Sealed): Uint8Array };
  now(): number;
}

const SCOPE = "mcp.oauth";
const SKEW_MS = 60_000;
const START_TTL_MS = 10 * 60_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
type Row = Record<string, unknown>;
type Json = Record<string, unknown>;

let bound: OauthStore | null = null;
/** The engine's handlers hand over their ctx (db, seal, clock) so the runtime, which has no ctx of its own, can read and write tokens. */
export function bindOauthStore(ctx: { db: OauthStore["db"]; seal?: OauthStore["seal"]; now?: () => number } | null): void {
  bound = ctx && ctx.seal ? { db: ctx.db, seal: ctx.seal, now: ctx.now ?? Date.now } : bound;
}
export const oauthBound = (): boolean => bound !== null;

export class OauthError extends Error {
  readonly code: "provider.unavailable" | "validation.bad_input" | "auth.invalid_code" | "permission.no_grant";
  constructor(code: OauthError["code"], message: string) { super(message); this.name = "OauthError"; this.code = code; }
}

const obj = (v: unknown): Json => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  return { verifier, challenge: sha256b64(verifier).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") };
};
const sealJson = (s: OauthStore, v: unknown): string => JSON.stringify(s.seal.seal(enc.encode(JSON.stringify(v)), SCOPE));
const openJson = <T,>(s: OauthStore, raw: unknown): T | null => { try { return JSON.parse(dec.decode(s.seal.unseal(JSON.parse(String(raw)) as Sealed))) as T; } catch { return null; } };

export interface OauthDeps { fetch: FetchPort }
export interface Tokens { access: string; refresh?: string; expiresAt?: number }

export function createMcpOauth(d: OauthDeps) {
  const store = (): OauthStore => bound ?? (() => { throw new OauthError("provider.unavailable", "This server cannot keep a sign-in yet."); })();

  async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: Json; header: (n: string) => string | null }> {
    const res = await d.fetch(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(10_000) });
    const body = await res.text().catch(() => "");
    let json: Json = {};
    try { json = obj(JSON.parse(body)); } catch { /* not JSON */ }
    return { status: res.status, json, header: (n) => res.headers.get(n) };
  }
  async function postForm(url: string, form: URLSearchParams): Promise<{ status: number; json: Json }> {
    const res = await d.fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString(), signal: AbortSignal.timeout(15_000) });
    const body = await res.text().catch(() => "");
    let json: Json = {};
    try { json = obj(JSON.parse(body)); } catch { /* not JSON */ }
    return { status: res.status, json };
  }

  /** The authorization server's addresses, found from the MCP server's own 401 (or the well-known address when it sends none). */
  async function discover(serverUrl: string): Promise<{ authorize: string; token: string; register?: string; issuer: string; scopes?: string }> {
    const u = new URL(serverUrl);
    let metadataUrl = "";
    try {
      const probe = await d.fetch(serverUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vyre", version: "1" } } }), signal: AbortSignal.timeout(10_000) });
      void probe.text().catch(() => undefined);
      const www = probe.headers.get("www-authenticate") ?? "";
      metadataUrl = /resource_metadata="([^"]+)"/.exec(www)?.[1] ?? "";
    } catch { /* the well-known address below is tried */ }
    const candidates = [metadataUrl, `${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`, `${u.origin}/.well-known/oauth-protected-resource`].filter((x) => x !== "");
    let issuer = u.origin;
    for (const c of candidates) {
      try { const r = await getJson(c); const first = (Array.isArray(r.json["authorization_servers"]) ? (r.json["authorization_servers"] as unknown[]) : []).find((x) => typeof x === "string"); if (r.status === 200 && typeof first === "string") { issuer = first; break; } } catch { /* next */ }
    }
    const iu = new URL(issuer);
    const path = iu.pathname === "/" ? "" : iu.pathname.replace(/\/$/, "");
    for (const m of [`${iu.origin}/.well-known/oauth-authorization-server${path}`, `${iu.origin}/.well-known/openid-configuration${path}`]) {
      try {
        const r = await getJson(m);
        const a = text(r.json["authorization_endpoint"]), t = text(r.json["token_endpoint"]);
        if (r.status === 200 && a !== "" && t !== "") return { authorize: a, token: t, issuer, ...(text(r.json["registration_endpoint"]) !== "" ? { register: text(r.json["registration_endpoint"]) } : {}), ...(Array.isArray(r.json["scopes_supported"]) ? { scopes: (r.json["scopes_supported"] as unknown[]).filter((x) => typeof x === "string").join(" ") } : {}) };
      } catch { /* next */ }
    }
    throw new OauthError("provider.unavailable", "That server does not say where to sign in. It may not support signing in this way.");
  }

  async function register(endpoint: string, redirectUri: string): Promise<string> {
    const res = await d.fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ client_name: "Vyre", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
    const body = await res.text().catch(() => "");
    let json: Json = {};
    try { json = obj(JSON.parse(body)); } catch { /* not JSON */ }
    if (!res.ok || text(json["client_id"]) === "") throw new OauthError("provider.unavailable", "That server did not accept Vyre as an app to sign in with.");
    return text(json["client_id"]);
  }

  return {
    /** Begin a sign-in for one connection: discover, register once, and answer the address to send the person to. */
    async start(a: { connectionId: string; url: string; redirectUri: string; by: string }): Promise<{ authUrl: string; state: string }> {
      const s = store();
      const found = await discover(a.url);
      const row = s.db.all("SELECT * FROM engine_mcp_oauth WHERE connection_id = ?", a.connectionId)[0] as Row | undefined;
      const clientId = row && text(row["client_id"]) !== "" && text(row["url"]) === a.url ? text(row["client_id"]) : found.register ? await register(found.register, a.redirectUri) : "";
      if (clientId === "") throw new OauthError("provider.unavailable", "That server needs a client id Vyre does not have, and it does not offer to register one.");
      const { verifier, challenge } = pkce();
      const state = `mcs_${Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`;
      s.db.run("INSERT INTO engine_mcp_oauth (connection_id, url, token_endpoint, client_id, pending_state, pending_verifier_sealed, redirect_uri, started_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET url = excluded.url, token_endpoint = excluded.token_endpoint, client_id = excluded.client_id, pending_state = excluded.pending_state, pending_verifier_sealed = excluded.pending_verifier_sealed, redirect_uri = excluded.redirect_uri, started_by = excluded.started_by, updated_at = excluded.updated_at",
        a.connectionId, a.url, found.token, clientId, state, sealJson(s, { verifier }), a.redirectUri, a.by, s.now());
      const au = new URL(found.authorize);
      au.searchParams.set("response_type", "code"); au.searchParams.set("client_id", clientId); au.searchParams.set("redirect_uri", a.redirectUri);
      au.searchParams.set("code_challenge", challenge); au.searchParams.set("code_challenge_method", "S256"); au.searchParams.set("state", state); au.searchParams.set("resource", a.url);
      if (found.scopes) au.searchParams.set("scope", found.scopes);
      return { authUrl: au.toString(), state };
    },

    /** The person came back with a code: trade it for tokens and seal them. Only the person who started it may finish it. */
    async complete(a: { state: string; code?: string; error?: string; by: string }): Promise<{ connectionId: string }> {
      const s = store();
      const row = s.db.all("SELECT * FROM engine_mcp_oauth WHERE pending_state = ?", a.state)[0] as Row | undefined;
      if (!row || s.now() - Number(row["updated_at"]) > START_TTL_MS) throw new OauthError("auth.invalid_code", "This sign-in link has expired or was already used.");
      if (text(row["started_by"]) !== a.by) throw new OauthError("permission.no_grant", "Only the person who started this sign-in can finish it.");
      const connectionId = text(row["connection_id"]);
      const clear = (): void => { s.db.run("UPDATE engine_mcp_oauth SET pending_state = NULL, pending_verifier_sealed = NULL WHERE connection_id = ?", connectionId); };
      if (a.error || !a.code) { clear(); throw new OauthError("validation.bad_input", "The sign-in was declined."); }
      const verifier = openJson<{ verifier: string }>(s, row["pending_verifier_sealed"])?.verifier;
      if (!verifier) { clear(); throw new OauthError("auth.invalid_code", "This sign-in cannot be finished. Start it again."); }
      const r = await postForm(text(row["token_endpoint"]), new URLSearchParams({ grant_type: "authorization_code", code: a.code, redirect_uri: text(row["redirect_uri"]), client_id: text(row["client_id"]), code_verifier: verifier, resource: text(row["url"]) }));
      clear();
      const access = text(r.json["access_token"]);
      if (r.status !== 200 || access === "") throw new OauthError("provider.unavailable", "The server did not accept the sign-in.");
      const expiresIn = Number(r.json["expires_in"]);
      const tokens: Tokens = { access, ...(text(r.json["refresh_token"]) !== "" ? { refresh: text(r.json["refresh_token"]) } : {}), ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: s.now() + expiresIn * 1000 } : {}) };
      s.db.run("UPDATE engine_mcp_oauth SET tokens_sealed = ?, expires_at = ?, updated_at = ? WHERE connection_id = ?", sealJson(s, tokens), tokens.expiresAt ?? null, s.now(), connectionId);
      return { connectionId };
    },

    /** An access token for the connection, refreshed when it is about to end or when the caller says the server refused it. Undefined when nobody has signed in. */
    async token(connectionId: string, fresh = false): Promise<string | undefined> {
      const s = store();
      const row = s.db.all("SELECT * FROM engine_mcp_oauth WHERE connection_id = ?", connectionId)[0] as Row | undefined;
      if (!row || row["tokens_sealed"] === null || row["tokens_sealed"] === undefined) return undefined;
      const t = openJson<Tokens>(s, row["tokens_sealed"]);
      if (!t) return undefined;
      const ending = t.expiresAt !== undefined && t.expiresAt - SKEW_MS <= s.now();
      if (!fresh && !ending) return t.access;
      if (!t.refresh) return fresh ? undefined : t.access;
      const r = await postForm(text(row["token_endpoint"]), new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: text(row["client_id"]), resource: text(row["url"]) }));
      const access = text(r.json["access_token"]);
      if (r.status !== 200 || access === "") return undefined;
      const expiresIn = Number(r.json["expires_in"]);
      const next: Tokens = { access, refresh: text(r.json["refresh_token"]) || t.refresh, ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: s.now() + expiresIn * 1000 } : {}) };
      s.db.run("UPDATE engine_mcp_oauth SET tokens_sealed = ?, expires_at = ?, updated_at = ? WHERE connection_id = ?", sealJson(s, next), next.expiresAt ?? null, s.now(), connectionId);
      return next.access;
    },

    /** Has this connection signed in? (A boolean for a screen; never the token.) */
    signedIn(connectionId: string): boolean {
      const row = store().db.all("SELECT tokens_sealed FROM engine_mcp_oauth WHERE connection_id = ?", connectionId)[0] as Row | undefined;
      return !!row && row["tokens_sealed"] !== null && row["tokens_sealed"] !== undefined;
    },
    forget(connectionId: string): void { store().db.run("DELETE FROM engine_mcp_oauth WHERE connection_id = ?", connectionId); },
  };
}
export type McpOauth = ReturnType<typeof createMcpOauth>;
