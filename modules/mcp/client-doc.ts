// Client metadata documents (MCP 2026-07-28, lane r42-mcp, 19 Nov 2026): an app can name itself by an https address, its client_id, whose page says who it is and where it may be sent back. Vyre reads that page once,
// the way a browser would from a stranger: only a public https address, never a private one (lib/net-guard.ts), small, quick, one try, and the page must name the address it was read from. What it says is kept as
// an ordinary registered client, trusted no more than a registered one: nothing happens until a person presses Allow. Dynamic registration stays.
import { getDomain } from "tldts";
import type { Db } from "./projections.ts";
import { cleanClientName, redirectKind, MAX_CLIENTS, MAX_REDIRECTS, UNUSED_CLIENT_MS } from "./oauth.ts";

export const MAX_DOC_BYTES = 5 * 1024;
export const DOC_TIMEOUT_MS = 3000;
/** The most pages one registered domain may have kept as clients. */
export const MAX_DOCS_PER_HOST = 10;

/** The name a person or company registered, from the public suffix list (ICANN and private suffixes, so alice.github.io and example.co.uk are each their own): one source cannot spread over subdomains and a shared host's users stay apart. An address with no registrable name keeps its whole host. */
export function registeredDomain(hostname: string): string {
  const h = hostname.toLowerCase();
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

/** Is this client_id an address that names a document? https, no user name, no fragment, a real path (so that it names one thing), a short address. */
export function isDocId(id: string): boolean {
  if (id.length > 512) return false;
  let u: URL;
  try {
    u = new URL(id);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.username === "" && u.password === "" && u.hash === "" && u.pathname.length > 1 && u.hostname.includes(".");
}

export type DocRead = { clientId: string; name: string; redirectUris: string[] } | { refused: string };

/** What the page said, checked. Pure. */
export function readDoc(id: string, text: string): DocRead {
  if (Buffer.byteLength(text) > MAX_DOC_BYTES) return { refused: "The app's page is too large." };
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return { refused: "The app's page is not JSON." };
  }
  if (d === null || typeof d !== "object" || Array.isArray(d)) return { refused: "The app's page is not an object." };
  const o = d as Record<string, unknown>;
  if (o["client_id"] !== id) return { refused: "The app's page names a different address than the one it was read from." };
  const raw = o["redirect_uris"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REDIRECTS || raw.some((u) => typeof u !== "string"))
    return { refused: "The app's page must name between one and five redirect addresses." };
  const uris = raw as string[];
  if (uris.some((u) => redirectKind(u) === null)) return { refused: "A redirect address must be https or a loopback address." };
  const method = o["token_endpoint_auth_method"];
  if (method !== undefined && method !== "none") return { refused: "Only apps with no secret are accepted." };
  const name = cleanClientName(o["client_name"]);
  return { clientId: id, name, redirectUris: uris };
}

/** One read of the page: the fetch is the guarded one, so a private or loopback address is refused before anything connects. A failure of any kind is a refusal with words, never a throw. */
export async function fetchDoc(
  id: string,
  get: (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
    ok: boolean;
    status: number;
    body: AsyncIterable<Uint8Array> | null;
  }>,
): Promise<DocRead> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DOC_TIMEOUT_MS);
  try {
    const res = await get(id, { method: "GET", headers: { accept: "application/json" }, signal: ctl.signal });
    if (!res.ok || !res.body) return { refused: "The app's page could not be read." };
    const parts: Buffer[] = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.byteLength;
      if (size > MAX_DOC_BYTES) {
        ctl.abort();
        return { refused: "The app's page is too large." };
      }
      parts.push(Buffer.from(c));
    }
    return readDoc(id, Buffer.concat(parts).toString("utf8"));
  } catch {
    return { refused: "The app's page could not be read." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep what the page said as a registered client (or refresh it: the page is the source of truth for an app that names itself this way). Unused clients older than a day go first; a full table drops the oldest unused page
 * to make room, and refuses only when every place is an app in use. Answers whether it was kept.
 */
export function keepDoc(db: Db, doc: { clientId: string; name: string; redirectUris: string[] }, now: number): boolean {
  const known = (db.all("SELECT 1 AS x FROM mcp_oauth_clients WHERE client_id = ?", doc.clientId) as unknown[]).length > 0;
  if (!known) {
    db.run("DELETE FROM mcp_oauth_clients WHERE used_at IS NULL AND created_at < ?", now - UNUSED_CLIENT_MS);
    // one host cannot fill the table: a few pages per host
    // counted per registered domain, compared on the parsed host (never on a pattern over the whole address, which a path or a port could match or dodge); half the table is kept for clients that have been used
    const domain = registeredDomain(new URL(doc.clientId).hostname);
    const ids = db.all("SELECT client_id FROM mcp_oauth_clients WHERE client_id LIKE 'https://%'") as Array<Record<string, unknown>>;
    let mine = 0;
    for (const r of ids) {
      try {
        if (registeredDomain(new URL(String(r["client_id"])).hostname) === domain) mine += 1;
      } catch {
        /* an id that is not an address is not counted */
      }
    }
    if (mine >= MAX_DOCS_PER_HOST) return false;
    const n = Number((db.all("SELECT COUNT(*) AS n FROM mcp_oauth_clients") as Array<Record<string, unknown>>)[0]?.["n"] ?? 0);
    // a full table makes room: the oldest page that nobody has ever used goes (never an app in use), so no actor can lock the others out by filling it; how fast one actor can add pages is the per-source limit in impl.ts
    if (n >= MAX_CLIENTS) {
      const gone = db.all(
        "SELECT client_id FROM mcp_oauth_clients WHERE used_at IS NULL AND client_id LIKE 'https://%' ORDER BY created_at ASC LIMIT 1",
      ) as Array<Record<string, unknown>>;
      if (gone.length === 0) return false;
      db.run("DELETE FROM mcp_oauth_clients WHERE client_id = ?", String(gone[0]!["client_id"]));
    }
  }
  db.run(
    "INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris",
    doc.clientId,
    doc.name,
    JSON.stringify(doc.redirectUris),
    now,
  );
  return true;
}
