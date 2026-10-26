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
  /** The portal module's peekLink, bound to the module's tables; null when the module is not live. */
  peek(siteId: string, token: string): Promise<PeekedLinkView | null>;
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

export function pageFor(v: PeekedLinkView, token: string, nonce: string): string {
  const password = v.method === "password";
  const heading = v.purpose === "invite" ? "You are invited" : v.purpose === "reset" ? "Choose a new password" : "Sign in";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(heading)}</title>
<style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f}h1{font-size:1.4rem}button,input{font:inherit;padding:.6rem .8rem}button{cursor:pointer}ul{padding-left:1.2rem}.err{color:#b00020}</style></head>
<body><main><h1>${esc(heading)}</h1><p>${esc(v.email)}</p><h2>Shared with you</h2>${sharedLines(v)}
<form id="f">${password ? '<p><label>Password<br><input id="pw" type="password" minlength="8" maxlength="200" required autocomplete="new-password"></label></p>' : ""}
<button type="submit">${password ? "Set password and open" : "Open my portal"}</button></form><p id="out" role="status"></p></main>
<script nonce="${nonce}">
var T=${JSON.stringify(token)},S=${JSON.stringify(v.siteId)},E=${JSON.stringify(v.email)};
document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var o=document.getElementById("out"),pw=document.getElementById("pw");
var b={siteId:S,email:E,token:T};if(pw)b.password=pw.value;
fetch("/portal/sign-in",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return[r.ok,j]})}).then(function(a){
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
  return {
    handle(req, res) {
      const url = (req.url ?? "").split("?")[0] ?? "";
      const m = PATH.exec(url);
      if (!m) return false;
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD", ...HEADERS }); res.end(); return true; }
      const [, siteId = "", token = ""] = m;
      deps.peek(siteId, token).then((v) => {
        if (!v) { notFound(res); return; }
        const nonce = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("base64");
        const body = pageFor(v, token, nonce);
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
