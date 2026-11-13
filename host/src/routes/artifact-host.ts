// The artifact host (owner ruling, 4 Nov): artifacts are served from an origin of their own, <name>-a.vyre.run for a Space reached through the relay or a.<address> for one served directly, never from the app's
// origin, so the app origin keeps its no-cookie, sandboxed public path exactly as it is (the user-content pattern).
//   /x/<code>   the one-time code the app minted for the signed-in person (sites.artifact_open, a minute, one use): traded here for the person's artifact session, an HttpOnly Secure SameSite=Lax cookie of
//               this host only (12 hours), and the browser goes on to the clean address. The code is never shown after that.
//   /<id>/...   the artifact itself, for a browser holding that session. Access is asked again on every request (the owner, and whoever it is shared with), so a person removed from the share is out at once.
//               Without a valid session: "You don't have access to this page", with the way back to Vyre, where signing in (or unlocking) mints a new code.
// The page keeps the sandbox of every public page (scripts, forms, popups, downloads, no allow-same-origin) and says who may frame it: the app's own origins and nothing else. The cookie rides along on
// navigations, which the sandbox does not touch.
import type http from "node:http";
import { cookieOf } from "./site-host.ts";
import { guard, serve } from "./public-path.ts";
import type { PublicPathDeps, ServedSite } from "./public-path.ts";

export const ARTIFACT_COOKIE = "__vyre_a";
const ID = /^\/(sit_[a-z0-9]{1,64})(\/.*)?$/;
const CODE = /^\/x\/([0-9a-f]{48})\/?$/;
/** What a server answers at this path on its artifact host so the server can tell its own host from a name that points somewhere else (daemon.ts, the artifact host's self-check). */
export const HOST_CHECK_PATH = "/.well-known/vyre-artifact-host";

export interface ArtifactHostDeps {
  /** The host artifacts are served from, or null where none is set up. */
  host(): string | null;
  /** The app's own origins, which may frame an artifact: this Space's address and the desktop app's. */
  appOrigins(): string[];
  exchange(code: string): Promise<{ siteId: string; token: string; maxAgeSeconds: number } | null>;
  artifact(siteId: string, token: string): Promise<ServedSite | null>;
  /** The Space's address, for the way back to Vyre. */
  appOrigin(): string | null;
  /** What serves the bytes: the same fetch and file reads as the public path. */
  serving: PublicPathDeps;
  /** This Space's marker for the host check: no secret, only enough that a name pointing at some other server cannot pass for this one. */
  marker(): string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createArtifactHostRoute(d: ArtifactHostDeps): {
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
} {
  const ancestors = (): string => `frame-ancestors ${d.appOrigins().join(" ")}`;
  /** The app's own origin that asked, when it may read this host's plain pages (the app checks that this host answers before it frames anything: a frame tells it nothing across origins). Never a cookie, never a credential. */
  const askedBy = (req: http.IncomingMessage): string | undefined => {
    const o = req.headers.origin;
    return typeof o === "string" && d.appOrigins().includes(o) ? o : undefined;
  };
  const framed = (req: http.IncomingMessage): boolean =>
    req.headers["sec-fetch-dest"] === "iframe" ||
    ["embed", "app"].some((k) => new URL(req.url ?? "/", "http://x").searchParams.get(k) === "1");
  const sayPage = (
    res: http.ServerResponse,
    status: number,
    title: string,
    text: string,
    link?: { href: string; label: string },
    origin?: string,
  ): void => {
    const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="vyre-artifact-host" content="1"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif}main{width:min(24rem,90vw);text-align:center}a{color:#2f6feb}</style><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p>${link ? `<p><a href="${esc(link.href)}">${esc(link.label)}</a></p>` : ""}</main></body></html>`;
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; ${ancestors()}`,
      "content-length": Buffer.byteLength(body),
      ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    });
    res.end(body);
  };
  return {
    handle(req, res) {
      const say = (
        r: http.ServerResponse,
        status: number,
        title: string,
        text: string,
        link?: { href: string; label: string },
      ): void =>
        // framed by the app, a link back to Vyre would open the app inside itself: no such link there (the app asks for a fresh address itself)
        sayPage(r, status, title, text, framed(req) ? undefined : link, askedBy(req));
      const ah = d.host();
      const asked = String(req.headers.host ?? "")
        .toLowerCase()
        .replace(/\.$/, "");
      const hostName = asked.replace(/:\d+$/, "");
      // a.localhost:<port> (a Space on this computer) is matched with its port; every other host is matched by name, as Caddy and the relay hand it over
      const local = ah !== null && /^a\.localhost(:\d+)?$/.test(ah);
      if (!ah || (local ? asked !== ah.toLowerCase() : hostName !== ah.toLowerCase())) return false;
      const url = new URL(req.url ?? "/", `https://${hostName}`);
      const method = (req.method ?? "GET").toUpperCase();
      if (url.pathname === HOST_CHECK_PATH) {
        const body = `vyre-artifact-host ${d.marker()}`;
        res.writeHead(method === "GET" || method === "HEAD" ? 200 : 405, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
          "content-length": Buffer.byteLength(body),
        });
        res.end(method === "HEAD" ? undefined : body);
        return true;
      }
      const code = CODE.exec(url.pathname);
      if (code) {
        if (method !== "GET") {
          res.writeHead(405, { allow: "GET", "content-length": "0" });
          res.end();
          return true;
        }
        const embed = url.searchParams.get("embed") === "1";
        void d
          .exchange(code[1] as string)
          .then((got) => {
            if (!got) {
              say(
                res,
                404,
                "This link has ended",
                "It was good for one use. Open the page from Vyre again.",
                d.appOrigin() ? { href: d.appOrigin() as string, label: "Open Vyre" } : undefined,
              );
              return;
            }
            // inside the desktop app's viewer the page is framed from the app's origin, where a Lax cookie is not sent: that one use is partitioned to the framing app
            const attrs = local
              ? embed
                ? "SameSite=None; Secure; Partitioned"
                : "SameSite=Lax"
              : embed
                ? "Secure; SameSite=None; Partitioned"
                : "Secure; SameSite=Lax";
            res.writeHead(302, {
              location: `/${got.siteId}/`,
              "set-cookie": `${ARTIFACT_COOKIE}=${got.token}; Path=/; HttpOnly; ${attrs}; Max-Age=${got.maxAgeSeconds}`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
              "content-length": "0",
            });
            res.end();
          })
          .catch(() => say(res, 502, "Not answering", "Try again soon."));
        return true;
      }
      const art = ID.exec(url.pathname);
      if (!art) {
        say(res, 404, "Not found", "There is nothing at this address.");
        return true;
      }
      const id = art[1] as string;
      if (art[2] === undefined) {
        res.writeHead(308, { location: `/${id}/${url.search}`, "content-length": "0" });
        res.end();
        return true;
      }
      const cookie = cookieOf(req.headers.cookie, ARTIFACT_COOKIE);
      guard(res, ancestors());
      void (async () => {
        const got = cookie ? await d.artifact(id, cookie) : null;
        if (!got || !got.live || got.blocked) {
          say(
            res,
            403,
            "You don't have access to this page",
            "Open it from Vyre. If it is not shared with you, ask the person who made it.",
            d.appOrigin() ? { href: `${d.appOrigin() as string}/a/${id}`, label: "Open it in Vyre" } : undefined,
          );
          return;
        }
        const rest = `${art[2]}${url.search}`;
        await serve(d.serving, got, rest, rest, `/${id}`, req, res);
      })().catch(() => {
        if (!res.headersSent) say(res, 502, "Not answering", "Try again soon.");
        else res.end();
      });
      return true;
    },
  };
}
