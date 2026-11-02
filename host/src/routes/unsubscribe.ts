// The unsubscribe link in an Automations email (spec 2.18): /u/<token> on a Space's own address, /p/u/<token> on a phone address, where the relay carries only /p/*.
// A person with no account lands here from their mail client, so nothing is signed in and nothing about the Space is shown: not its name, not their address, not the flow.
// GET changes nothing. Mail security scanners fetch every link in an email, so a GET that unsubscribed would remove people who never clicked. The page sends itself once a browser opens it, so a person still
// has one click to make; a reader with no scripts gets the button. POST does the work, and also serves a mail client's own one-click unsubscribe. A link used twice answers the same way.
import type http from "node:http";

const PATH = /^\/u\/([A-Za-z0-9_-]{16,200})\/?$/;

export interface UnsubscribeDeps {
  /** True when the link is good, used or not. Rejects when it could not be done, so the person can try again. */
  unsubscribe(token: string): Promise<boolean>;
}

const PAGE_STYLE = "html{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px}button{font:inherit;padding:8px 16px}";

function page(res: http.ServerResponse, method: string, status: number, title: string, line: string, extra = ""): void {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>${PAGE_STYLE}</style><main><h1>${title}</h1><p>${line}</p>${extra}</main></html>`;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts allow-forms",
  });
  res.end(method === "HEAD" ? undefined : body);
}

const ASK = `<form id="go" method="post"><button>Unsubscribe</button></form><script>document.getElementById("go").submit()</script>`;

export function createUnsubscribeRoute(deps: UnsubscribeDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      const m = PATH.exec(new URL(req.url ?? "/", "http://vyred").pathname);
      if (!m) return false;
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") { page(res, method, 200, "Unsubscribe", "Stop getting these emails.", ASK); return true; }
      if (method !== "POST") { res.writeHead(405, { allow: "GET, HEAD, POST", "content-length": "0" }); res.end(); return true; }
      req.resume();   // a mail client's one-click POST carries a body; the token is all this needs
      void deps.unsubscribe(m[1] as string).then(
        (good) => { if (good) page(res, method, 200, "You are unsubscribed", "You will not get these emails again."); else page(res, method, 404, "This link does not work", "It may be incomplete. Copy the whole link from the email."); },
        () => page(res, method, 503, "That did not work", "You are still subscribed. Try the link again in a minute."),
      );
      return true;
    },
  };
}
