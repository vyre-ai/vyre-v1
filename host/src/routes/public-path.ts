// The public path, /p/* (owner, 2 Nov): what a visitor with no session reaches on a phone address, name.vyre.run. The relay carries nothing else to this daemon in the clear.
//   /p/forms/<slug>        a form; its calls go to the same address with ?op=
//   /p/forms/book/<slug>   a booking page
//   /p/u/<token>           an unsubscribe link from an email
//   /p/share/project/<token>  a read-only project link for a client
//   /p/<site>/...          a public site: forwarded, whole path, to a port on a computer, or served from a folder in Files
//   /a/<id>/k/<token>/...  an artifact: the token is one person's short-lived address, and their access is checked on every request
// It shares an origin with the app, so this route is the second wall behind the relay's (relay/worker/phone.js) and also the only wall on a direct connection: Cookie and Authorization are removed before
// anything reads the request, Set-Cookie never leaves, every answer carries the sandbox policy with no allow-same-origin and noindex, and nothing under /p/ falls through to a signed-in route.
import type http from "node:http";
import type { PortRequest, PortSink } from "../seams/port-fetch.ts";

export const PUBLIC_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-downloads";
/** Who may frame an artifact: this origin (the web app, which is served from the Space) and the desktop app's own origins (tauri://localhost on a Mac, http(s)://tauri.localhost on Windows). Nothing wider. */
export const APP_FRAME_ANCESTORS = "frame-ancestors 'self' tauri://localhost http://tauri.localhost https://tauri.localhost";
const FORM = /^\/p\/forms\/(book\/)?([a-z0-9][a-z0-9-]{0,63})\/?$/;
const UNSUBSCRIBE = /^\/p(\/u\/[A-Za-z0-9_-]+\/?)$/;
const SHARE = /^\/p(\/share\/project\/[a-z0-9]+)$/;
const SITE = /^\/p\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;
const ARTIFACT = /^\/a\/(sit_[a-z0-9]{1,64})\/k\/([0-9a-f]{48})(\/.*)?$/;
const BODY_MAX = 8 * 1024 * 1024;
/** What goes to a site from a visitor: never who they are. */
const TO_SITE = ["accept", "accept-language", "content-type", "if-modified-since", "if-none-match", "range", "user-agent", "x-file-name"];
/** What comes back from a site: nothing the browser would apply to the whole origin. */
const FROM_SITE = new Set(["accept-ranges", "cache-control", "content-disposition", "content-encoding", "content-language", "content-length", "content-range", "content-security-policy", "content-type", "etag", "expires", "last-modified", "location", "retry-after", "vary"]);
/** The headers a caller may not bring into the public path: identity, and what this route sets itself. */
const DROP = ["cookie", "authorization", "x-forwarded-for", "x-real-ip", "x-vyre-public-base", "x-vyre-public-origin"];

interface Inner { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean }
export interface ServedTarget { computerId?: string; port?: number; folderId?: string; container?: string }
export interface ServedSite { siteId: string; access: string; live: boolean; blocked: boolean; target: ServedTarget }
export interface PublicPathDeps {
  forms(): Inner | null;
  /** The unsubscribe route; it answers what a direct address answers. */
  unsubscribe?(): Inner | null;
  /** The shared project route. */
  share?(): Inner | null;
  /** The Space's public origin, for a page's own connect-src. */
  origin(): string | null;
  /** The route behind /p/<slug>. */
  site?(slug: string): ServedSite | null;
  /** The route behind an artifact address, if that token is good and its person may see it now. */
  artifact?(siteId: string, token: string): Promise<ServedSite | null>;
  /** One request to the port a target names. */
  fetch?(target: ServedTarget, request: PortRequest, sink: PortSink): Promise<void>;
  /** One file of a folder target: `rel` is a path below the folder, never starting with a slash. */
  file?(folderId: string, rel: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

/** Where an op of a form's page goes: the same handlers as a direct address, or null for an op that does not exist or a wrong method. */
export function formTarget(method: string, book: boolean, slug: string, url: URL): string | null {
  const op = url.searchParams.get("op");
  const rest = new URLSearchParams(url.searchParams);
  rest.delete("op");
  const q = rest.size ? `?${rest.toString()}` : "";
  if (op === null) return method === "GET" || method === "HEAD" ? `/${book ? "book" : "f"}/${slug}${q}` : null;
  if (method === "POST" && op === "submit" && !book) return "/f/submit";
  if (method === "POST" && op === "upload" && !book) return `/f/upload/${slug}${q}`;
  if (method === "POST" && op === "create" && book) return "/book/create";
  if (method === "GET" && op === "availability" && book) return `/book/availability${q}`;
  return null;
}

function refuse(res: http.ServerResponse, status: number, text: string): void {
  const body = JSON.stringify({ error: { message: text } });
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

/** Every answer on the path leaves through here, whichever handler wrote it. */
function guard(res: http.ServerResponse, ancestors?: string): void {
  const write = res.writeHead.bind(res) as (...a: unknown[]) => http.ServerResponse;
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    const last = rest[rest.length - 1];
    const given = last !== null && typeof last === "object" && !Array.isArray(last) ? (last as Record<string, unknown>) : {};
    const headers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(given)) if (k.toLowerCase() !== "set-cookie") headers[k.toLowerCase()] = v;
    res.removeHeader("set-cookie");
    const own = headers["content-security-policy"] ?? res.getHeader("content-security-policy");
    res.removeHeader("content-security-policy");
    const sandbox = ancestors ? `${PUBLIC_SANDBOX}, ${ancestors}` : PUBLIC_SANDBOX;
    headers["content-security-policy"] = own ? `${String(own)}, ${sandbox}` : sandbox;
    headers["x-robots-tag"] = "noindex";
    headers["x-content-type-options"] = "nosniff";
    return write(status, headers);
  }) as typeof res.writeHead;
}

function page(res: http.ServerResponse, status: number, title: string, text: string): void {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif}main{max-width:26rem;padding:2rem 1.25rem;text-align:center}h1{font-size:1.25rem}</style><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function bodyOf(req: http.IncomingMessage): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > BODY_MAX) return null;
    chunks.push(c as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** A visitor's request to a site: the whole path as asked, so a site serves under its base path, and only the plain headers. */
async function serve(deps: PublicPathDeps, site: ServedSite, path: string, rest: string, prefix: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") { res.writeHead(405, { allow: "GET, HEAD, POST", "content-length": "0" }); res.end(); return; }
  res.setHeader("access-control-allow-origin", "*");
  if (site.target.folderId !== undefined) {
    if (method === "POST") { res.writeHead(405, { allow: "GET, HEAD", "content-length": "0" }); res.end(); return; }
    const rel = decodeURIComponent(rest.split("?")[0] ?? "").replace(/^\/+/, "");
    const got = deps.file ? await deps.file(site.target.folderId, rel === "" || rel.endsWith("/") ? `${rel}index.html` : rel) : null;
    if (!got) { page(res, 404, "Not found", "There is nothing at this address."); return; }
    res.writeHead(200, { "content-type": got.mime, "content-length": got.bytes.length, "cache-control": "no-cache" });
    res.end(method === "HEAD" ? undefined : Buffer.from(got.bytes));
    return;
  }
  if (!deps.fetch) { page(res, 503, "Not available", "This server cannot reach computers yet."); return; }
  const body = method === "POST" ? await bodyOf(req) : new Uint8Array(0);
  if (body === null) { res.writeHead(413, { "content-length": "0" }); res.end(); return; }
  const headers: Record<string, string> = { "x-forwarded-prefix": prefix, "x-forwarded-proto": "https" };
  for (const h of TO_SITE) { const v = req.headers[h]; if (typeof v === "string") headers[h] = v; }
  let started = false;
  await deps.fetch(site.target, { method, path, headers, body }, {
    head(status, from) {
      started = true;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(from)) if (FROM_SITE.has(k.toLowerCase())) out[k.toLowerCase()] = v;
      res.writeHead(status, out);
    },
    data: (c) => { res.write(c); },
    end: () => { res.end(); },
    fail() { if (started) res.destroy(); else page(res, 502, "Not answering", "The app behind this address is not answering. Try again soon."); },
  });
}

export function createPublicPathRoute(deps: PublicPathDeps): Inner {
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      // an artifact's plain address: the app opens it for whoever is signed in. Only a token below it serves anything
      const plain = /^\/a\/(sit_[a-z0-9]{1,64})\/?$/.exec(url.pathname);
      if (plain && (req.method ?? "GET").toUpperCase() === "GET") { res.writeHead(302, { location: `/#screen=apps.artifacts&selected=${plain[1] as string}`, "cache-control": "no-store", "content-length": "0" }); res.end(); return true; }
      const artifact = ARTIFACT.exec(url.pathname);
      if (url.pathname !== "/p" && !url.pathname.startsWith("/p/") && !artifact) return false;
      for (const h of DROP) delete req.headers[h];
      // the visitor the relay saw, for the per-visitor limits; on a direct connection the socket stands in
      const visitor = req.headers["x-vyre-visitor"];
      delete req.headers["x-vyre-visitor"];
      if (typeof visitor === "string" && visitor !== "") req.headers["x-forwarded-for"] = visitor;
      guard(res, artifact ? APP_FRAME_ANCESTORS : undefined);   // an artifact is framed by the app's artifact viewer and by nothing else
      const method = (req.method ?? "GET").toUpperCase();
      const form = FORM.exec(url.pathname);
      if (form) {
        const inner = deps.forms();
        const target = formTarget(method, form[1] !== undefined, form[2] as string, url);
        if (!inner || target === null) { refuse(res, inner ? 405 : 404, inner ? "That is not something this address does." : "That form is not open."); return true; }
        req.url = target;
        req.headers["x-vyre-public-base"] = url.pathname;
        const origin = deps.origin();
        if (origin) req.headers["x-vyre-public-origin"] = origin;
        if (!inner.handle(req, res)) refuse(res, 404, "That form is not open.");
        return true;
      }
      const unsub = UNSUBSCRIBE.exec(url.pathname);
      if (unsub) {
        req.url = unsub[1] as string;
        if (!deps.unsubscribe?.()?.handle(req, res)) page(res, 404, "Not found", "There is nothing at this address.");
        return true;
      }
      const share = SHARE.exec(url.pathname);
      if (share) {
        req.url = share[1] as string;
        delete req.headers["accept"];   // a page, never the JSON view: the path has one answer
        if (!deps.share?.()?.handle(req, res)) page(res, 404, "Not found", "There is nothing at this address.");
        return true;
      }
      const fail500 = (): void => { if (!res.headersSent) page(res, 502, "Not answering", "Try again soon."); else res.end(); };
      if (artifact) {
        const id = artifact[1] as string;
        void (async () => {
          const got = deps.artifact ? await deps.artifact(id, artifact[2] as string) : null;
          if (!got || !got.live || got.blocked) { page(res, 404, "Not available", "This link has ended, or it is not shared with you. Open it from Vyre."); return; }
          const prefix = `/a/${id}/k/${artifact[2] as string}`;
          const rest = `${artifact[3] ?? "/"}${url.search}`;
          await serve(deps, got, rest, rest, prefix, req, res);
        })().catch(fail500);
        return true;
      }
      const m = SITE.exec(url.pathname);
      const site = m && deps.site ? deps.site(m[1] as string) : null;
      if (!m || !site) { page(res, 404, "Not found", "There is nothing at this address."); return true; }
      if (site.blocked) { page(res, 451, "This page is not available", "It was taken down."); return true; }
      if (!site.live) { page(res, 404, "Not found", "There is nothing at this address."); return true; }
      if (site.access === "password") { page(res, 403, "This site has its own address", "A password needs a custom domain."); return true; }
      if (site.access !== "public") { page(res, 404, "Not found", "There is nothing at this address."); return true; }
      if (m[2] === undefined) { res.writeHead(308, { location: `${url.pathname}/${url.search}`, "content-length": "0" }); res.end(); return true; }
      void serve(deps, site, `${url.pathname}${url.search}`, `${(m[2] as string)}${url.search}`, `/p/${m[1] as string}`, req, res).catch(fail500);
      return true;
    },
  };
}
