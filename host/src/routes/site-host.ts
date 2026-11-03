// A site Vyre deploys, at an address of its own (<slug>.<sites domain> or a custom domain): Caddy sends every such name here, and this route decides who gets in before a byte reaches the app.
//   public    anyone
//   password  a visitor who typed the site's password (/__vyre/password), remembered for a day in a cookie of the site's own address
//   space     anyone signed in to this Space: the site sends them to the Space's /sites/signin, which asks the app (where they are signed in) for a two-minute link back, traded here for a day-long cookie
//   private   the owner, and whoever the site is shared with
// Access is asked again on every request, so a removed member or an ended share is out at once. The cookie (__vyre_site) and any x-vyre-* header never reach the app; x-vyre-user tells it who
// is asking on a Space or private site. On a server Caddy asks /__vyre/auth (forward auth) and proxies to the site's container itself, WebSockets included; this route answers 2xx with
// x-vyre-user to let the visitor in, or the sign-in redirect, password form or refusal Caddy sends back. Where no Caddy is in front, this route proxies the request itself (no WebSockets).
import http from "node:http";

export interface HostSite { siteId: string; name: string; access: string; live: boolean; blocked: boolean; owner: string; passwordHash: string | null; target: { container?: string; port?: number } }
export interface SiteHostDeps {
  /** names that are the Space itself: never a site */
  own(host: string): boolean;
  site(host: string): HostSite | null;
  /** who a ticket (link or cookie) belongs to, if it is good for this site now */
  ticket(siteId: string, token: string): Promise<string | null>;
  /** may this person see this site now (an active member for space; the owner or a grant for private) */
  may(principal: string, site: HostSite): boolean;
  checkPassword(given: string, hash: string): Promise<boolean>;
  newSession(siteId: string, principal: string): Promise<string>;
  address(container: string): Promise<string | null>;
  /** the Space's own origin, where its people are signed in */
  origin(): string | null;
}

const COOKIE = "__vyre_site";
const DAY_S = 24 * 60 * 60;
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"]);
const TOKEN = /^[0-9a-f]{48}$/;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: http.ServerResponse, status: number, title: string, body: string, extra: Record<string, string> = {}): void {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif;background:Canvas;color:CanvasText}main{width:min(22rem,90vw);padding:2rem 0}h1{font-size:1.15rem;font-weight:600;margin:0 0 .5rem}p{margin:.25rem 0 1rem;opacity:.75}input{width:100%;box-sizing:border-box;font:inherit;padding:.6rem .7rem;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);background:Canvas;color:CanvasText}button{margin-top:.75rem;width:100%;font:inherit;font-weight:600;padding:.6rem;border:0;border-radius:8px;background:#2f6feb;color:#fff;cursor:pointer}.e{color:#c62828;opacity:1}</style><body><main>${body}</main></body></html>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", "content-length": Buffer.byteLength(html), ...extra });
  res.end(html);
}

function passwordForm(res: http.ServerResponse, site: HostSite, next: string, wrong: boolean): void {
  page(res, wrong ? 401 : 200, site.name, `<h1>${esc(site.name)}</h1><p>This site has a password.</p>${wrong ? '<p class="e">That password is not right.</p>' : ""}<form method="post" action="/__vyre/password"><input type="hidden" name="next" value="${esc(next)}"><input name="password" type="password" autocomplete="current-password" aria-label="Password" placeholder="Password" autofocus required><button type="submit">Open</button></form>`);
}

/** Is this address inside one of these IPv4 subnets (a.b.c.d/n)? A connection that arrives on a site network's address came from a site. */
export function inSubnets(address: string | undefined, subnets: readonly string[]): boolean {
  const ip = (address ?? "").replace(/^::ffff:/, "");
  const n = (a: string): number | null => { const p = a.split(".").map(Number); return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0 : null; };
  const v = n(ip);
  if (v === null) return false;
  return subnets.some((c) => { const [base, bits] = c.split("/"); const b = n(base ?? ""); const k = Number(bits); if (b === null || !(k >= 0 && k <= 32)) return false; const mask = k === 0 ? 0 : (~0 << (32 - k)) >>> 0; return ((v & mask) >>> 0) === ((b & mask) >>> 0); });
}

export function cookieOf(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** The request's own cookies, without ours. */
function withoutOurs(header: string | undefined): string | undefined {
  const kept = (header ?? "").split(";").map((p) => p.trim()).filter((p) => p !== "" && !p.startsWith(`${COOKIE}=`));
  return kept.length ? kept.join("; ") : undefined;
}

const safeNext = (raw: string | null): string => (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/__vyre/") ? raw.slice(0, 2000) : "/");
const setCookie = (token: string, maxAge: number): string => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function body(req: http.IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return null; chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Send the request on to the site's container and its answer back, both streamed. */
function proxy(req: http.IncomingMessage, res: http.ServerResponse, address: string, port: number, hostName: string, principal: string | null): void {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase();
    if (HOP.has(key) || key.startsWith("x-vyre-") || key === "cookie") continue;
    if (v !== undefined) headers[key] = v;
  }
  const cookies = withoutOurs(req.headers.cookie);
  if (cookies) headers["cookie"] = cookies;
  const prior = req.headers["x-forwarded-for"];
  headers["x-forwarded-for"] = `${typeof prior === "string" && prior ? `${prior}, ` : ""}${req.socket.remoteAddress ?? ""}`;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = hostName;
  headers["host"] = hostName;
  if (principal && !principal.startsWith("visitor:")) headers["x-vyre-user"] = principal;
  const up = http.request({ host: address, port, method: req.method, path: req.url, headers, timeout: 120_000 }, (r) => {
    const out: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k.toLowerCase()) && v !== undefined) out[k] = v;
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
    r.on("error", () => res.destroy());
  });
  up.on("timeout", () => up.destroy(new Error("timed out")));
  up.on("error", () => {
    if (!res.headersSent) page(res, 502, "Not answering", "<h1>Not answering</h1><p>The app behind this address is not answering. Try again in a moment.</p>");
    else res.destroy();
  });
  req.pipe(up);
}

export function createSiteHostRoute(d: SiteHostDeps) {
  return {
    handle(req: http.IncomingMessage, res: http.ServerResponse): boolean {
      const hostName = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
      if (!hostName || d.own(hostName)) return false;
      const site = d.site(hostName);
      if (!site) return false;
      void (async () => {
        // forward auth from Caddy: the visitor's own method and address come in headers, and the answer is a yes or the page to send back
        const asked = new URL(req.url ?? "/", `https://${hostName}`);
        const authOnly = asked.pathname === "/__vyre/auth";
        const fwdUri = String(req.headers["x-forwarded-uri"] ?? "/");
        const url = authOnly ? new URL(fwdUri.startsWith("/") ? fwdUri : "/", `https://${hostName}`) : asked;
        const method = authOnly ? String(req.headers["x-forwarded-method"] ?? "GET").toUpperCase() : (req.method ?? "GET").toUpperCase();
        if (authOnly && url.pathname.startsWith("/__vyre/")) { page(res, 404, "Not found", "<h1>Not found</h1>"); return; }
        if (url.pathname === "/__vyre/signin" && method === "GET") {
          const t = url.searchParams.get("t") ?? "";
          const who = TOKEN.test(t) ? await d.ticket(site.siteId, t) : null;
          if (!who || !d.may(who, site)) { page(res, 403, "Link ended", "<h1>This link has ended</h1><p>Open the site again from Vyre, or ask its owner for access.</p>"); return; }
          const token = await d.newSession(site.siteId, who);
          res.writeHead(302, { location: safeNext(url.searchParams.get("next")), "set-cookie": setCookie(token, DAY_S), "cache-control": "no-store", "content-length": "0" });
          res.end();
          return;
        }
        if (url.pathname === "/__vyre/signout") {
          res.writeHead(302, { location: "/", "set-cookie": setCookie("", 0), "cache-control": "no-store", "content-length": "0" });
          res.end();
          return;
        }
        if (site.blocked) { page(res, 451, "Not available", "<h1>Not available</h1><p>This site was taken down.</p>"); return; }
        if (!site.live || site.target.container === undefined || site.target.port === undefined) { page(res, 404, "Not live", "<h1>Not live</h1><p>Nothing is published at this address right now.</p>"); return; }
        if (url.pathname === "/__vyre/password" && method === "POST" && site.access === "password") {
          const raw = await body(req, 16 * 1024);
          const form = new URLSearchParams(raw ?? "");
          const next = safeNext(form.get("next"));
          if (!site.passwordHash || !(await d.checkPassword(form.get("password") ?? "", site.passwordHash))) { passwordForm(res, site, next, true); return; }
          const token = await d.newSession(site.siteId, "visitor:password");
          res.writeHead(303, { location: next, "set-cookie": setCookie(token, DAY_S), "cache-control": "no-store", "content-length": "0" });
          res.end();
          return;
        }
        const cookie = cookieOf(req.headers.cookie, COOKIE);
        const who = cookie && TOKEN.test(cookie) ? await d.ticket(site.siteId, cookie) : null;
        let principal: string | null = null;
        if (site.access === "public") principal = who;
        else if (site.access === "password") {
          if (!site.passwordHash) { page(res, 503, site.name, `<h1>${esc(site.name)}</h1><p>Its password is not set yet.</p>`); return; }
          if (!who || (who !== "visitor:password" && !d.may(who, site))) { if (method === "GET" || method === "HEAD") passwordForm(res, site, `${url.pathname}${url.search}`, false); else page(res, 401, site.name, "<h1>Sign in again</h1>"); return; }
          principal = who;
        } else {
          if (!who || who.startsWith("visitor:") || !d.may(who, site)) {
            const origin = d.origin();
            const next = `${url.pathname}${url.search}`;
            if ((method === "GET" || method === "HEAD") && origin && !who) {
              res.writeHead(302, { location: `${origin}/sites/signin?site=${encodeURIComponent(site.siteId)}&next=${encodeURIComponent(next)}`, "cache-control": "no-store", "content-length": "0" });
              res.end();
              return;
            }
            page(res, who ? 403 : 401, site.name, who ? `<h1>${esc(site.name)}</h1><p>This site is not shared with you. Ask its owner.</p>` : `<h1>${esc(site.name)}</h1><p>Sign in to Vyre to open it.</p>`);
            return;
          }
          principal = who;
        }
        if (authOnly) {
          res.writeHead(204, { "x-vyre-user": principal && !principal.startsWith("visitor:") ? principal : "", "cache-control": "no-store" });
          res.end();
          return;
        }
        const address = await d.address(site.target.container);
        if (!address) { page(res, 503, "Starting", "<h1>Not running</h1><p>The app is not running right now. Its owner can deploy it again in Vyre.</p>"); return; }
        proxy(req, res, address, site.target.port, hostName, principal);
      })().catch(() => { if (!res.headersSent) page(res, 502, "Not answering", "<h1>Not answering</h1><p>Try again in a moment.</p>"); else res.destroy(); });
      return true;
    },
  };
}

/** /sites/signin on the Space's own address: the browser is signed in to the app here, so this page asks the Space for the person's link to the site and goes there. */
export function createSiteSigninPage() {
  const script = `(function(){var q=new URLSearchParams(location.search),site=q.get("site")||"",next=q.get("next")||"/",m=document.getElementById("m");
function say(t){m.textContent=t;}
var s=null;try{var all=JSON.parse(localStorage.getItem("vyre.session.v1")||"null");var list=all&&all.sessions?all.sessions:(all?{x:all}:{});for(var k in list){var v=list[k];if(v&&v.token&&(!v.baseUrl||v.baseUrl.replace(/\\/+$/,"")===location.origin)){s=v;break;}}}catch(e){}
if(!s){say("Sign in to Vyre first, then open the site again.");document.getElementById("a").hidden=false;return;}
fetch("/v1/sites/signin_link",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+s.token},body:JSON.stringify({siteId:site,next:next})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(x){var d=x.j&&x.j.data;if(x.ok&&d&&d.url){location.replace(d.url);}else{say((x.j&&x.j.error&&x.j.error.message)||"You cannot open this site.");document.getElementById("a").hidden=false;}}).catch(function(){say("Vyre did not answer. Try again.");});})();`;
  return {
    handle(req: http.IncomingMessage, res: http.ServerResponse): boolean {
      const url = new URL(req.url ?? "/", "http://vyred");
      if (url.pathname !== "/sites/signin" || (req.method ?? "GET").toUpperCase() !== "GET") return false;
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Opening the site</title><style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif}main{width:min(22rem,90vw);text-align:center}a{color:#2f6feb}</style><body><main><p id="m">Opening the site</p><p id="a" hidden><a href="/">Open Vyre</a></p></main><script>${script}</script></body></html>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", "content-length": Buffer.byteLength(html) });
      res.end(html);
      return true;
    },
  };
}
