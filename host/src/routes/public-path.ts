// The public path, /p/* (owner, 2 Nov): what a visitor with no session reaches on a phone address, name.vyre.run. The relay carries nothing else to this daemon in the clear.
//   /p/forms/<slug>        a form; its calls go to the same address with ?op=
//   /p/forms/book/<slug>   a booking page
// It shares an origin with the app, so this route is the second wall behind the relay's (relay/worker/phone.js) and also the only wall on a direct connection: Cookie and Authorization are removed before
// anything reads the request, Set-Cookie never leaves, every answer carries the sandbox policy with no allow-same-origin and noindex, and nothing under /p/ falls through to a signed-in route.
import type http from "node:http";

export const PUBLIC_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-downloads";
const FORM = /^\/p\/forms\/(book\/)?([a-z0-9][a-z0-9-]{0,63})\/?$/;
/** The headers a caller may not bring into the public path: identity, and what this route sets itself. */
const DROP = ["cookie", "authorization", "x-forwarded-for", "x-real-ip", "x-vyre-public-base", "x-vyre-public-origin"];

interface Inner { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean }
export interface PublicPathDeps {
  forms(): Inner | null;
  /** The Space's public origin, for a page's own connect-src. */
  origin(): string | null;
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
function guard(res: http.ServerResponse): void {
  const write = res.writeHead.bind(res) as (...a: unknown[]) => http.ServerResponse;
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    const last = rest[rest.length - 1];
    const given = last !== null && typeof last === "object" && !Array.isArray(last) ? (last as Record<string, unknown>) : {};
    const headers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(given)) if (k.toLowerCase() !== "set-cookie") headers[k.toLowerCase()] = v;
    res.removeHeader("set-cookie");
    const own = headers["content-security-policy"] ?? res.getHeader("content-security-policy");
    res.removeHeader("content-security-policy");
    headers["content-security-policy"] = own ? `${String(own)}, ${PUBLIC_SANDBOX}` : PUBLIC_SANDBOX;
    headers["x-robots-tag"] = "noindex";
    headers["x-content-type-options"] = "nosniff";
    return write(status, headers);
  }) as typeof res.writeHead;
}

export function createPublicPathRoute(deps: PublicPathDeps): Inner {
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      if (url.pathname !== "/p" && !url.pathname.startsWith("/p/")) return false;
      for (const h of DROP) delete req.headers[h];
      // the visitor the relay saw, for the per-visitor limits; on a direct connection the socket stands in
      const visitor = req.headers["x-vyre-visitor"];
      delete req.headers["x-vyre-visitor"];
      if (typeof visitor === "string" && visitor !== "") req.headers["x-forwarded-for"] = visitor;
      guard(res);
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
      refuse(res, 404, "There is nothing at this address.");
      return true;
    },
  };
}
