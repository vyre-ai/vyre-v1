// The portal landing page (P-L8_17): GET /portal/<siteId>/link/<token>, the address in a portal invitation or sign-in email. Sites is deferred, so the Space host serves it.
//   1. the token is looked up without being used (the portal module's peekLink); an unknown, used, expired or wrong-site link is a plain 404 page, the same for every cause
//   2. a good link shows who it is for, what is shared with them (linked record, record types, file links), and one step: open the portal (a link account) or choose a password (a password account)
//   3. the step is the existing public call POST /portal/sign-in with the token; the page keeps the session it gets in this tab only (sessionStorage), never a cookie
// The page runs one inline script under a nonce and loads nothing from outside. Nothing about the token is logged here, the address is not cached, and the Referer is not sent.
import type http from "node:http";

export interface PeekedLinkView {
  accountId: string; siteId: string; email: string; method: "magic_link" | "password"; state: "invited" | "active"; purpose: string; expiresAt: number;
  shared: { linked: boolean; recordTypes: string[]; fileLinks: number };
}

export interface PortalLinkRouteDeps {
  /** The portal module's peekLink, bound to the module's tables. */
  peek(siteId: string, token: string): Promise<PeekedLinkView | null>;
  /** portal.sign_in for the account the link belongs to. The email comes from the link, never from the page. Resolves to the call's output or throws the pipeline's error. */
  signIn(a: { siteId: string; email: string; token: string; password?: string }): Promise<{ session: string }>;
}

const PATH = /^\/portal\/([A-Za-z0-9_.-]{1,100})\/link\/([A-Za-z0-9_-]{1,200})$/;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } as const;

function sharedLines(v: PeekedLinkView): string {
  const items: string[] = [];
  if (v.shared.linked) items.push("Your records");
  for (const t of v.shared.recordTypes) items.push(`Shared ${esc(t.replace(/_/g, " "))} records`);
  if (v.shared.fileLinks > 0) items.push(`${v.shared.fileLinks} ${v.shared.fileLinks === 1 ? "file" : "files"}`);
  return items.length === 0 ? "<p>Nothing has been shared with you yet.</p>" : `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

export function pageFor(v: PeekedLinkView, nonce: string): string {
  const password = v.method === "password";
  const heading = v.purpose === "invite" ? "You are invited" : v.purpose === "reset" ? "Choose a new password" : "Sign in";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(heading)}</title>
<style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f}h1{font-size:1.4rem}button,input{font:inherit;padding:.6rem .8rem}button{cursor:pointer}ul{padding-left:1.2rem}.err{color:#b00020}</style></head>
<body><main><h1>${esc(heading)}</h1><p>${esc(v.email)}</p><h2>Shared with you</h2>${sharedLines(v)}
<form id="f">${password ? '<p><label>Password<br><input id="pw" type="password" minlength="8" maxlength="200" required autocomplete="new-password"></label></p>' : ""}
<button type="submit">${password ? "Set password and open" : "Open my portal"}</button></form><p id="out" role="status"></p></main>
<script nonce="${nonce}">
document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var o=document.getElementById("out"),pw=document.getElementById("pw");
var b={};if(pw)b.password=pw.value;
fetch(location.pathname,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return[r.ok,j]})}).then(function(a){
if(a[0]&&a[1]&&a[1].data&&a[1].data.session){try{sessionStorage.setItem("portal-session",a[1].data.session)}catch(x){}o.className="";o.textContent="You are signed in."}
else{o.className="err";o.textContent=(a[1]&&a[1].error&&a[1].error.message)||"That did not work. Ask for a new link."}}).catch(function(){o.className="err";o.textContent="Could not reach the server."})});
</script></body></html>`;
}

function notFound(res: http.ServerResponse): void {
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Link not found</title></head><body style="font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>This link does not work</h1><p>It is wrong, already used or expired. Ask for a new one.</p></body></html>';
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body), "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", ...HEADERS });
  res.end(body);
}

/** A request hook like the blob route: true when the request was for a portal link and has been answered, false when the daemon should carry on. */
export function createPortalLinkRoute(deps: PortalLinkRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  function json(res: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), ...HEADERS });
    res.end(text);
  }

  /** POST on the link: the claim step. Same 404 for a link that does not work; the account's email is read from the link, so the page cannot sign in as anyone else. */
  function claim(req: http.IncomingMessage, res: http.ServerResponse, siteId: string, token: string): void {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size <= 4096) chunks.push(c); });
    req.on("end", () => {
      if (size > 4096) { json(res, 413, { error: { code: "validation.bad_input", message: "That is too large." } }); return; }
      let password: string | undefined;
      try {
        const body = chunks.length === 0 ? {} : (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { password?: unknown });
        if (body.password !== undefined) { if (typeof body.password !== "string") throw new Error("password"); password = body.password; }
      } catch { json(res, 400, { error: { code: "validation.bad_input", message: "The request is not valid." } }); return; }
      deps.peek(siteId, token).then(async (v) => {
        if (!v) { json(res, 404, { error: { code: "validation.not_found", message: "This link is wrong, used or expired. Ask for a new one." } }); return; }
        try { json(res, 200, { data: await deps.signIn({ siteId, email: v.email, token, ...(password === undefined ? {} : { password }) }) }); }
        catch (e) {
          const err = (e as { error?: { code?: string; message?: string }; http?: number } | null);
          json(res, err?.http ?? 400, { error: { code: err?.error?.code ?? "auth.invalid_code", message: err?.error?.message ?? "That did not work. Ask for a new link." } });
        }
      }).catch(() => json(res, 500, { error: { code: "internal.unexpected", message: "Something went wrong." } }));
    });
  }

  return {
    handle(req, res) {
      const url = (req.url ?? "").split("?")[0] ?? "";
      const m = PATH.exec(url);
      if (!m) return false;
      const [, siteId = "", token = ""] = m;
      if (req.method === "POST") { claim(req, res, siteId, token); return true; }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD, POST", ...HEADERS }); res.end(); return true; }
      deps.peek(siteId, token).then((v) => {
        if (!v) { notFound(res); return; }
        const nonce = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("base64");
        const body = pageFor(v, nonce);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body),
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
          ...HEADERS,
        });
        res.end(req.method === "HEAD" ? undefined : body);
      }).catch(() => notFound(res));
      return true;
    },
  };
}
