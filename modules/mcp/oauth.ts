// Sign-in for outside agents: Vyre is the OAuth 2.1 authorization server of its own /mcp, the way MCP clients expect (MCP authorization, draft of 2026): a 401 with WWW-Authenticate names the protected resource
// metadata (RFC 9728), which names this server, whose metadata (RFC 8414) gives the addresses. A client registers itself (RFC 7591), sends the person to /oauth/authorize with a PKCE challenge (S256 only) and the
// resource (RFC 8707), and trades the code for a 15 minute access token and a refresh token that rotates at every use.
//   No secret kept   codes and tokens are stored as SHA-256, a client has no secret, and a code exists only from the moment the tab that asked collects it.
//   Exact redirects  https, or loopback with any port (RFC 8252 7.3: a native app picks its port when it runs). Everything else about the address must match what was registered, or no redirect happens at all.
//   One sign-in      a grant is one client, one person, one agent, one address. Every code and token hangs off it: replaying a used code or refresh token ends the whole grant, because one of the two holders is a thief.
//   The press        /oauth/authorize draws no Allow button. It keeps the request and shows the tab that asked; the press happens in Vyre as a signed-in person's capability call with a Bearer session (mcp.oauth.allow),
//                    which no cross-site form can make. The tab then collects the code with a proof only it holds.
// Everything here takes a Db and plain values, so the route, the capabilities and the tests share one set of rules.
import { sameMac, sha256b64 } from "../../kernel/src/seal/index.ts";
import { mintId, secret } from "./projections.ts";
import type { Db } from "./projections.ts";

export const CODE_MS = 60_000;
export const ACCESS_MS = 15 * 60_000;
export const REFRESH_MS = 30 * 86_400_000;
export const REQUEST_MS = 5 * 60_000;
const MAX_REDIRECTS = 5;
const MAX_NAME = 60;
const MAX_CLIENTS = 5000;
const MAX_OPEN_REQUESTS = 500;
const MAX_STATE = 1024;
const UNUSED_CLIENT_MS = 86_400_000;

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const hash = (token: string): string => sha256b64(token);

/** What a page may safely show of a name a client gave itself: no control or direction characters, one line, at most 60 characters. */
export function cleanClientName(raw: unknown): string {
  const text = str(raw).replace(/[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, MAX_NAME).trim();
  // Claude Code calls itself "Claude Code (<the name it gave this server>)": the last part says nothing to a person in Vyre
  const name = text.replace(/\s*\(vyre\)$/i, "");
  return name === "" ? "An MCP app" : name;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** What kind of redirect this is: loopback (an app on this computer), https (somewhere on the internet), or null when it may not be used at all. */
export function redirectKind(uri: string): "loopback" | "https" | null {
  let u: URL;
  try { u = new URL(uri); } catch { return null; }
  if (uri.length > 2048 || u.hash !== "" || uri.includes("#") || u.username !== "" || u.password !== "") return null;
  if (u.protocol === "https:") return LOOPBACK_HOSTS.has(u.hostname) ? "loopback" : "https";
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return "loopback";
  return null;
}

/** The registered address, exactly; a loopback address may change only its port. */
export function sameRedirect(registered: string, asked: string): boolean {
  if (registered === asked) return true;
  if (redirectKind(registered) !== "loopback" || redirectKind(asked) !== "loopback") return false;
  const a = new URL(registered), b = new URL(asked);
  return a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

export const redirectHostOf = (uri: string): string | undefined => (redirectKind(uri) === "https" ? new URL(uri).host : undefined);

/** The S256 challenge of a verifier (RFC 7636): the kernel's sha-256 as base64url, no padding. */
export const challengeOf = (verifier: string): string => sha256b64(verifier);
const verifierOk = (v: string): boolean => /^[A-Za-z0-9._~-]{43,128}$/.test(v);

/** Numbers the person compares between the tab and Vyre, so a request they did not start stands out. */
function matchCode(): string {
  const n = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] as number;
  return String(1000 + (n % 9000));
}

// ---- metadata ---------------------------------------------------------------------------------------------------------------------------------------

export const resourceOf = (origin: string): string => `${origin}/mcp`;
export const metadataUrl = (origin: string): string => `${origin}/.well-known/oauth-protected-resource/mcp`;
export const challenge = (origin: string | undefined, error?: "invalid_token"): string => (origin ? `Bearer resource_metadata="${metadataUrl(origin)}"` : "Bearer") + (error ? `, error="${error}"` : "");

export const protectedResource = (origin: string): Record<string, unknown> => ({
  resource: resourceOf(origin), authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Vyre",
});

export const serverMetadata = (origin: string): Record<string, unknown> => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  authorization_response_iss_parameter_supported: true,
});

// ---- clients ----------------------------------------------------------------------------------------------------------------------------------------

export interface ClientRow { clientId: string; name: string; redirectUris: string[] }
function clientOf(r: Row): ClientRow {
  let uris: string[] = [];
  try { uris = (JSON.parse(str(r["redirect_uris"])) as unknown[]).filter((u): u is string => typeof u === "string"); } catch { /* a broken row matches nothing */ }
  return { clientId: str(r["client_id"]), name: str(r["name"]), redirectUris: uris };
}
export function clientBy(db: Db, clientId: string): ClientRow | null {
  const r = (db.all("SELECT * FROM mcp_oauth_clients WHERE client_id = ?", clientId) as Row[])[0];
  return r ? clientOf(r) : null;
}

export type OauthFail = { error: string; description: string };

/** Dynamic client registration (RFC 7591). A public client only: nothing here is a secret, and nothing here is trusted until a person presses Allow. */
export function registerClient(db: Db, body: unknown, now: number): { client: Record<string, unknown> } | OauthFail {
  const b = (body !== null && typeof body === "object" && !Array.isArray(body) ? body : {}) as Row;
  const uris = Array.isArray(b["redirect_uris"]) ? (b["redirect_uris"] as unknown[]).filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > MAX_REDIRECTS || uris.length !== (b["redirect_uris"] as unknown[]).length) return { error: "invalid_redirect_uri", description: "Name between one and five redirect addresses." };
  if (uris.some((u) => redirectKind(u) === null)) return { error: "invalid_redirect_uri", description: "A redirect address must be https or a loopback address, with no fragment and no user name." };
  const grants = b["grant_types"];
  if (Array.isArray(grants) && !grants.includes("authorization_code")) return { error: "invalid_client_metadata", description: "This server does the authorization code grant." };
  db.run("DELETE FROM mcp_oauth_clients WHERE used_at IS NULL AND created_at < ?", now - UNUSED_CLIENT_MS);
  if (Number((db.all("SELECT COUNT(*) AS n FROM mcp_oauth_clients") as Row[])[0]?.["n"] ?? 0) >= MAX_CLIENTS) return { error: "temporarily_unavailable", description: "Too many apps have registered here. Try again later." };
  const clientId = mintId("mcl", now);
  const name = cleanClientName(b["client_name"]);
  db.run("INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)", clientId, name, JSON.stringify(uris), now);
  return { client: {
    client_id: clientId, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  } };
}

// ---- the authorization request ------------------------------------------------------------------------------------------------------------------------

export interface RequestRow {
  requestId: string; clientId: string; redirectUri: string; codeChallenge: string; state?: string; resource: string; proofHash: string; match: string; createdAt: number; expiresAt: number;
  status: "open" | "taken" | "allowed" | "declined"; person?: string; agentId?: string; grantId?: string; deliveredAt?: number;
}
function requestOf(r: Row): RequestRow {
  const out: RequestRow = {
    requestId: str(r["request_id"]), clientId: str(r["client_id"]), redirectUri: str(r["redirect_uri"]), codeChallenge: str(r["code_challenge"]), resource: str(r["resource"]), proofHash: str(r["proof_hash"]), match: str(r["match"]),
    createdAt: Number(r["created_at"]), expiresAt: Number(r["expires_at"]), status: str(r["status"]) as RequestRow["status"],
  };
  if (typeof r["state"] === "string") out.state = r["state"];
  if (typeof r["person"] === "string") out.person = r["person"];
  if (typeof r["agent_id"] === "string") out.agentId = r["agent_id"];
  if (typeof r["grant_id"] === "string") out.grantId = r["grant_id"];
  if (typeof r["delivered_at"] === "number") out.deliveredAt = r["delivered_at"];
  return out;
}
export function requestBy(db: Db, requestId: string): RequestRow | null {
  const r = (db.all("SELECT * FROM mcp_oauth_requests WHERE request_id = ?", requestId) as Row[])[0];
  return r ? requestOf(r) : null;
}

/** Back to the client with an error, as the spec says, once the redirect is known to be the client's own. */
export function errorRedirect(redirectUri: string, issuer: string, error: string, state?: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (state !== undefined) u.searchParams.set("state", state);
  u.searchParams.set("iss", issuer);
  return u.href;
}

export type Begin =
  | { kind: "refuse"; title: string; text: string }
  | { kind: "redirect"; to: string }
  | { kind: "page"; request: RequestRow; proof: string; client: ClientRow; redirectHost?: string };

/**
 * GET /oauth/authorize. Who the client is and where it wants to go are checked first, and a wrong answer to either is a page and never a redirect (an open redirector is how a code gets stolen). Every other mistake goes back
 * to the client. A request is kept for five minutes; nothing else happens until a person presses Allow.
 */
export function beginAuthorize(db: Db, q: Readonly<Record<string, string | undefined>>, origin: string, now: number): Begin {
  const client = clientBy(db, str(q["client_id"]));
  if (!client) return { kind: "refuse", title: "This link is not from an app Vyre knows", text: "Start again from the app you are connecting." };
  const redirectUri = str(q["redirect_uri"]);
  if (!client.redirectUris.some((r) => sameRedirect(r, redirectUri))) return { kind: "refuse", title: "This link goes somewhere it should not", text: "The address it wants to return to is not the one the app registered. Nothing was sent." };
  const state = q["state"];
  const back = (error: string): Begin => ({ kind: "redirect", to: errorRedirect(redirectUri, origin, error, state) });
  if (q["response_type"] !== "code") return back("unsupported_response_type");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(str(q["code_challenge"])) || q["code_challenge_method"] !== "S256") return back("invalid_request");
  if (state !== undefined && state.length > MAX_STATE) return back("invalid_request");
  const resource = resourceOf(origin);
  if (q["resource"] !== undefined && q["resource"] !== resource) return back("invalid_target");
  db.run("DELETE FROM mcp_oauth_requests WHERE expires_at < ?", now - REQUEST_MS);
  if (Number((db.all("SELECT COUNT(*) AS n FROM mcp_oauth_requests WHERE status = 'open'") as Row[])[0]?.["n"] ?? 0) >= MAX_OPEN_REQUESTS) return back("temporarily_unavailable");
  const requestId = mintId("oar", now);
  const proof = secret("vyp");
  const request: RequestRow = {
    requestId, clientId: client.clientId, redirectUri, codeChallenge: str(q["code_challenge"]), ...(state === undefined ? {} : { state }), resource, proofHash: hash(proof), match: matchCode(), createdAt: now, expiresAt: now + REQUEST_MS, status: "open",
  };
  db.run(
    "INSERT INTO mcp_oauth_requests (request_id, client_id, redirect_uri, code_challenge, state, resource, proof_hash, match, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')",
    requestId, client.clientId, redirectUri, request.codeChallenge, state ?? null, resource, request.proofHash, request.match, now, request.expiresAt,
  );
  const redirectHost = redirectHostOf(redirectUri);
  return { kind: "page", request, proof, client, ...(redirectHost ? { redirectHost } : {}) };
}

export type Wait = { status: "waiting" | "expired" | "declined"; redirect?: string } | { status: "allowed"; redirect: string } | { status: "done" };

/** What the tab that asked gets when it looks again. The code is made here, once, for the holder of the proof: a person's press alone produces nothing anyone can take. */
export function collect(db: Db, requestId: string, proof: string, issuer: string, now: number): Wait | null {
  const r = requestBy(db, requestId);
  if (!r || !sameMac(hash(proof), r.proofHash)) return null;
  if (r.status === "declined") return { status: "declined", redirect: errorRedirect(r.redirectUri, issuer, "access_denied", r.state) };
  if (r.status === "allowed") {
    if (r.deliveredAt !== undefined) return { status: "done" };
    if (r.expiresAt <= now || !r.grantId) return { status: "expired", redirect: errorRedirect(r.redirectUri, issuer, "access_denied", r.state) };
    const taken = db.run("UPDATE mcp_oauth_requests SET delivered_at = ? WHERE request_id = ? AND delivered_at IS NULL", now, requestId);
    if (taken.changes !== 1) return { status: "done" };
    const code = secret("vyc");
    db.run("INSERT INTO mcp_oauth_tokens (token_hash, kind, grant_id, client_id, redirect_uri, code_challenge, created_at, expires_at) VALUES (?, 'code', ?, ?, ?, ?, ?, ?)", hash(code), r.grantId, r.clientId, r.redirectUri, r.codeChallenge, now, now + CODE_MS);
    const u = new URL(r.redirectUri);
    u.searchParams.set("code", code);
    if (r.state !== undefined) u.searchParams.set("state", r.state);
    u.searchParams.set("iss", issuer);
    return { status: "allowed", redirect: u.href };
  }
  if (r.expiresAt <= now) return { status: "expired", redirect: errorRedirect(r.redirectUri, issuer, "access_denied", r.state) };
  return { status: "waiting" };
}

// ---- grants -----------------------------------------------------------------------------------------------------------------------------------------

export interface GrantRow { grantId: string; clientId: string; clientName: string; person: string; agentId: string; resource: string; redirectHost?: string; sessionId?: string; createdAt: number; revokedAt?: number }
function grantOf(r: Row): GrantRow {
  const out: GrantRow = { grantId: str(r["grant_id"]), clientId: str(r["client_id"]), clientName: str(r["client_name"]), person: str(r["person"]), agentId: str(r["agent_id"]), resource: str(r["resource"]), createdAt: Number(r["created_at"]) };
  if (typeof r["redirect_host"] === "string") out.redirectHost = r["redirect_host"];
  if (typeof r["session_id"] === "string") out.sessionId = r["session_id"];
  if (typeof r["revoked_at"] === "number") out.revokedAt = r["revoked_at"];
  return out;
}
export function grantBy(db: Db, grantId: string): GrantRow | null {
  const r = (db.all("SELECT * FROM mcp_oauth_grants WHERE grant_id = ?", grantId) as Row[])[0];
  return r ? grantOf(r) : null;
}
export const grantsOfAgent = (db: Db, agentId: string): GrantRow[] => (db.all("SELECT * FROM mcp_oauth_grants WHERE agent_id = ? AND revoked_at IS NULL", agentId) as Row[]).map(grantOf);
export const grantsOfPerson = (db: Db, person: string): GrantRow[] => (db.all("SELECT * FROM mcp_oauth_grants WHERE person = ? AND revoked_at IS NULL ORDER BY created_at DESC", person) as Row[]).map(grantOf);
/** The live sign-in of this client for this person: the same app signing in again is the same agent. */
export const liveGrant = (db: Db, clientId: string, person: string, resource: string): GrantRow | null => {
  const r = (db.all("SELECT * FROM mcp_oauth_grants WHERE client_id = ? AND person = ? AND resource = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1", clientId, person, resource) as Row[])[0];
  return r ? grantOf(r) : null;
};

export function insertGrant(db: Db, g: GrantRow): void {
  db.run(
    "INSERT INTO mcp_oauth_grants (grant_id, client_id, client_name, person, agent_id, resource, redirect_host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    g.grantId, g.clientId, g.clientName, g.person, g.agentId, g.resource, g.redirectHost ?? null, g.createdAt,
  );
}

/** Ends a sign-in: every code and token under it stops at once, and the session it had goes too. Returns the session to end on the live server. */
export function revokeGrant(db: Db, grantId: string, why: string, now: number): string | undefined {
  const g = grantBy(db, grantId);
  if (!g || g.revokedAt !== undefined) return undefined;
  db.run("UPDATE mcp_oauth_grants SET revoked_at = ?, revoked_why = ? WHERE grant_id = ? AND revoked_at IS NULL", now, why, grantId);
  db.run("DELETE FROM mcp_oauth_tokens WHERE grant_id = ?", grantId);
  if (g.sessionId) db.run("UPDATE mcp_sessions SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL", now, g.sessionId);
  return g.sessionId;
}

// ---- the token endpoint -------------------------------------------------------------------------------------------------------------------------------

export interface TokenRow { hash: string; kind: "code" | "access" | "refresh"; grantId: string; clientId: string; redirectUri?: string; codeChallenge?: string; expiresAt: number; usedAt?: number }
function tokenRowBy(db: Db, token: string): TokenRow | null {
  const r = (db.all("SELECT * FROM mcp_oauth_tokens WHERE token_hash = ?", hash(token)) as Row[])[0];
  if (!r) return null;
  const out: TokenRow = { hash: str(r["token_hash"]), kind: str(r["kind"]) as TokenRow["kind"], grantId: str(r["grant_id"]), clientId: str(r["client_id"]), expiresAt: Number(r["expires_at"]) };
  if (typeof r["redirect_uri"] === "string") out.redirectUri = r["redirect_uri"];
  if (typeof r["code_challenge"] === "string") out.codeChallenge = r["code_challenge"];
  if (typeof r["used_at"] === "number") out.usedAt = r["used_at"];
  return out;
}

export interface TokenAnswer { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string }
export type TokenResult = { tokens: TokenAnswer } | (OauthFail & { replayed?: GrantRow; ended?: string });

function issue(db: Db, grant: GrantRow, now: number): TokenAnswer {
  const access = secret("vya");
  const refresh = secret("vyf");
  db.run("DELETE FROM mcp_oauth_tokens WHERE grant_id = ? AND expires_at <= ?", grant.grantId, now);
  const put = "INSERT INTO mcp_oauth_tokens (token_hash, kind, grant_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)";
  db.run(put, hash(access), "access", grant.grantId, grant.clientId, now, now + ACCESS_MS);
  db.run(put, hash(refresh), "refresh", grant.grantId, grant.clientId, now, now + REFRESH_MS);
  db.run("UPDATE mcp_oauth_clients SET used_at = ? WHERE client_id = ?", now, grant.clientId);
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_MS / 1000), refresh_token: refresh };
}

const invalid = (description: string): OauthFail => ({ error: "invalid_grant", description });

/** POST /oauth/token. A client that is known, a grant that is alive, one use of every code and refresh token, and the same answer for every way of being wrong. */
export function exchange(db: Db, form: Readonly<Record<string, string | undefined>>, origin: string, now: number): TokenResult {
  const clientId = str(form["client_id"]);
  if (form["resource"] !== undefined && form["resource"] !== resourceOf(origin)) return { error: "invalid_target", description: "That token would not be for this address." };
  const grantType = form["grant_type"];
  if (grantType !== "authorization_code" && grantType !== "refresh_token") return { error: "unsupported_grant_type", description: "This server trades codes and refresh tokens." };
  const presented = str(grantType === "authorization_code" ? form["code"] : form["refresh_token"]);
  if (clientId === "" || !clientBy(db, clientId)) return { error: "invalid_client", description: "This server does not know that client." };
  const wanted = grantType === "authorization_code" ? "code" : "refresh";
  const row = presented === "" ? null : tokenRowBy(db, presented);
  const wrong = invalid("That code or token is not valid.");
  if (!row || row.kind !== wanted || row.clientId !== clientId) return wrong;
  const grant = grantBy(db, row.grantId);
  if (!grant || grant.revokedAt !== undefined || grant.resource !== resourceOf(origin)) return wrong;
  if (row.usedAt !== undefined) {
    // somebody else has this code or token: whichever of the two is real, the sign-in ends here
    const ended = revokeGrant(db, grant.grantId, grantType === "authorization_code" ? "code replayed" : "refresh replayed", now);
    return { ...wrong, replayed: grant, ...(ended ? { ended } : {}) };
  }
  if (row.expiresAt <= now) return wrong;
  // one use, whether or not what follows passes: a wrong verifier burns the code
  if (db.run("UPDATE mcp_oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", now, row.hash).changes !== 1) return wrong;
  if (grantType === "authorization_code") {
    const verifier = str(form["code_verifier"]);
    if (!verifierOk(verifier) || !row.codeChallenge || !sameMac(challengeOf(verifier), row.codeChallenge)) return invalid("That verifier does not match.");
    if (form["redirect_uri"] !== row.redirectUri) return invalid("That redirect address is not the one this code was made for.");
  }
  return { tokens: issue(db, grant, now) };
}

/** A live access token: its grant, for the address this request came in on. Null for anything else: expired, revoked, a refresh token, a token for another address. */
export function grantForAccess(db: Db, token: string, origin: string | undefined, now: number): GrantRow | null {
  const row = tokenRowBy(db, token);
  if (!row || row.kind !== "access" || row.expiresAt <= now) return null;
  const grant = grantBy(db, row.grantId);
  if (!grant || grant.revokedAt !== undefined) return null;
  return origin !== undefined && grant.resource === resourceOf(origin) ? grant : null;
}

// ---- rate limits ----------------------------------------------------------------------------------------------------------------------------------------

/** Per address, so one visitor cannot fill the tables. The relay limits the same paths per address too; a direct connection meets only this one. */
export function createLimiter(perMinute: number, now: () => number): (key: string) => boolean {
  const seen = new Map<string, { n: number; at: number }>();
  return (key) => {
    const t = now();
    if (seen.size > 2048) for (const [k, v] of seen) if (t - v.at > 60_000) seen.delete(k);
    const cur = seen.get(key);
    if (!cur || t - cur.at > 60_000) { seen.set(key, { n: 1, at: t }); return true; }
    cur.n += 1;
    return cur.n <= perMinute;
  };
}
