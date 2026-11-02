// The tab an MCP client opens: the only page the sign-in draws in a browser it does not know. It carries no Allow button and takes no password, so nothing here can be pressed by a frame, a forged form or a look-alike: the
// press is made in Vyre, where the person is already signed in, and through the relay a password would pass the Worker. This page opens Vyre, shows the code to compare, and collects the answer. Same frame as the entry screens
// (apps/app/src/join/kit.tsx): the rail ground, one soft sheet, the mark, one heading, one action. What a client says about itself is escaped, marked as its own words, and the redirect host is named when it is not this computer.
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const STYLE = `:root{--win:#FBFAFD;--rail:#E8E5EF;--field:#EEEBF3;--ink:#17141F;--ink-3:#6A6578;--accent:#5A3FF0;--accent-ink:#FFFFFF;--beacon:#EE5A38;--danger:#CC2A4A;--pop:0 1px 2px rgba(23,20,31,.05),0 24px 60px -24px rgba(23,20,31,.25);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--win:#121118;--rail:#07070A;--field:#201E29;--ink:#F2F0F7;--ink-3:#928DA2;--accent:#A092FF;--accent-ink:#120E24;--beacon:#FF8A66;--danger:#FF6F85;--pop:0 0 0 1px rgba(242,240,247,.04),0 30px 70px -30px rgba(0,0,0,.9);color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0;height:100%}body{background:var(--rail);color:var(--ink);font:14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}section{width:100%;max-width:420px;min-height:380px;background:var(--win);border-radius:20px;box-shadow:var(--pop);padding:36px 32px 28px;display:flex;flex-direction:column;align-items:center;text-align:center}
svg{width:40px;height:40px;margin-bottom:18px}h1{margin:0;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.02em;overflow-wrap:anywhere}p{margin:6px 0 0;color:var(--ink-3)}.tag{margin-top:8px;font-size:12.5px;line-height:16px}.warn{margin-top:16px;color:var(--danger);overflow-wrap:anywhere}
.code{margin-top:22px;font:500 28px/34px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em}.grow{flex:1;min-height:20px}a.btn{display:flex;align-items:center;justify-content:center;width:100%;height:44px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-weight:600;font-size:15px;text-decoration:none}
.links{display:flex;gap:16px;justify-content:center;margin-top:14px;min-height:24px}.links a{color:var(--ink-3);font-size:13px;font-weight:500;text-decoration:none}[hidden]{display:none!important}`;

const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 6.4l6.3 11.2 4.9-8.6" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.6" cy="5.6" r="2.7" fill="var(--beacon)"/></svg>';

export interface PageHeaders { "content-type": string; "cache-control": string; "content-security-policy": string; "x-frame-options": string; "x-content-type-options": string; "referrer-policy": string; "cross-origin-opener-policy": string; "x-robots-tag": string }
const headers = (nonce: string): PageHeaders => ({
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
  "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-opener-policy": "same-origin", "x-robots-tag": "noindex",
});

const nonceOf = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

const shell = (nonce: string, title: string, body: string, script = ""): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head><body><main><section>${MARK}${body}</section></main>${script}</body></html>`;

export function refusalPage(title: string, text: string): { headers: PageHeaders; body: string } {
  const nonce = nonceOf();
  return { headers: headers(nonce), body: shell(nonce, title, `<h1>${esc(title)}</h1><p>${esc(text)}</p><div class="grow"></div>`) };
}

export interface AllowTab {
  clientName: string; spaceName: string; match: string; requestId: string; proof: string; origin: string;
  /** Set when the code would leave this computer. */
  redirectHost?: string;
  /** Where a person with no Vyre app can sign in. */
  webApp?: string;
}

/** The address that opens the Allow sheet in the Vyre app. The app acts on it only for a Space it is already signed in to. */
export const appLink = (origin: string, requestId: string): string => `vyre://open?${new URLSearchParams({ address: origin, allow: requestId })}`;

export function allowTab(t: AllowTab): { headers: PageHeaders; body: string } {
  const nonce = nonceOf();
  const app = appLink(t.origin, t.requestId);
  const web = t.webApp ? `${t.webApp}/oauth/allow?${new URLSearchParams({ space: t.origin, request: t.requestId })}` : "";
  const name = esc(t.clientName);
  const body =
    `<h1 id="title">${name} wants to join ${esc(t.spaceName)}</h1><p class="tag">That name is what the app calls itself. Vyre has not checked it.</p>` +
    (t.redirectHost ? `<p class="warn">When you allow this, it goes to <b>${esc(t.redirectHost)}</b>, not an app on this computer.</p>` : "") +
    `<div class="code" id="code">${esc(t.match)}</div><p id="line">Vyre shows the same code. Check they match, then press Allow there.</p><div class="grow"></div>` +
    `<a class="btn" id="open" href="${esc(app)}">Open Vyre</a><div class="links" id="links">${web ? `<a href="${esc(web)}" target="_blank" rel="noopener noreferrer">Use the web app</a>` : ""}</div>`;
  const data = JSON.stringify({ request: t.requestId, proof: t.proof, app, name: t.clientName, space: t.spaceName }).replace(/</g, "\\u003c");
  const script = `<script nonce="${nonce}">(function(){var d=${data},$=function(i){return document.getElementById(i)};
function end(title,line){clearInterval(timer);$("title").textContent=title;$("line").textContent=line;["code","open","links"].forEach(function(i){$(i).hidden=true});var tags=document.querySelectorAll(".tag,.warn");for(var n=0;n<tags.length;n++)tags[n].hidden=true}
function look(){fetch("/oauth/wait",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({request:d.request,proof:d.proof}),cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(a){if(!a)return;
if(a.status==="allowed"){end(d.name+" joined "+d.space,"Go back to the app. You can close this tab.");location.replace(a.redirect)}
else if(a.status==="declined"){end("Not allowed",d.name+" did not join. You can close this tab.");if(a.redirect)location.replace(a.redirect)}
else if(a.status==="expired"){end("This link ended","Links to join last five minutes. Start again from the app you are connecting.")}
else if(a.status==="done"){end(d.name+" joined "+d.space,"Go back to the app. You can close this tab.")}}).catch(function(){})}
var timer=setInterval(look,1500);setTimeout(function(){location.href=d.app},300)})()</script>`;
  return { headers: headers(nonce), body: shell(nonce, `${t.clientName} wants to join ${t.spaceName}`, body, script) };
}
