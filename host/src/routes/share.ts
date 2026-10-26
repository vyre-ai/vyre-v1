// The shared project link (spec 3.4; P-SEC_10): GET /share/project/<token> shows a client the read-only view of one project, with no sign-in.
// The token is the whole key (144 random bits), so the route is deliberately narrow:
//   1. the host asks the projects module for the view as itself (projects.shared_view); the module checks the token, its expiry and that it was not revoked. This route never reads a module's tables.
//   2. an unknown, expired or revoked token is the same 404 page, so a link says nothing about why it stopped working
//   3. the view holds the title, status, goal, the latest status update and the next milestones; never people, threads, files or assignees
//   4. the answer is never cached and never indexed, sends no referrer, and runs no script: a page with inline text and one style block under a CSP that allows nothing else
// GET and HEAD only; anything else is 405. Nothing about a link is logged but a 404.
import type http from "node:http";

export interface SharedView {
  title: string;
  status: string;
  goal?: string | undefined;
  statusUpdate?: { text: string; at: number } | undefined;
  milestones: Array<{ title: string; due?: number | undefined; status: string }>;
  expiresAt?: number | undefined;
}

export interface ShareRouteDeps {
  /** the projects module's view for a token, or null when the link is unknown, expired or revoked */
  view(token: string): Promise<SharedView | null>;
}

const PATH = /^\/share\/project\/([a-z0-9]{16,64})$/;
const HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const STYLE = "body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f}h1{font-size:1.6rem;margin:0 0 .25rem}.m{color:#6e6e73;font-size:.9rem}h2{font-size:1rem;margin:2rem 0 .5rem}li{margin:.25rem 0}";

function page(v: SharedView): string {
  const update = v.statusUpdate ? `<h2>Latest update</h2><p>${esc(v.statusUpdate.text)}</p><p class="m">${day(v.statusUpdate.at)}</p>` : "";
  const goal = v.goal ? `<h2>Goal</h2><p>${esc(v.goal)}</p>` : "";
  const next = v.milestones.length
    ? `<h2>Next milestones</h2><ul>${v.milestones.map((m) => `<li>${esc(m.title)}${m.due !== undefined ? ` <span class="m">${day(m.due)}</span>` : ""}</li>`).join("")}</ul>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${esc(v.title)}</title><style>${STYLE}</style></head><body><h1>${esc(v.title)}</h1><p class="m">${esc(v.status)}</p>${goal}${update}${next}</body></html>`;
}

function send(res: http.ServerResponse, status: number, type: string, body: string, head: boolean, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...HEADERS, "content-type": type, "content-length": Buffer.byteLength(body), ...extra });
  res.end(head ? undefined : body);
}

const notFound = (res: http.ServerResponse, json: boolean, head: boolean): void => json
  ? send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: { code: "validation.not_found", message: "That link does not work." } }), head)
  : send(res, 404, "text/html; charset=utf-8", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Link not found</title><style>${STYLE}</style></head><body><h1>This link does not work</h1><p class="m">It may have expired or been withdrawn. Ask the person who sent it for a new one.</p></body></html>`, head);

/** The route as a request hook, like the blob route: true when the request was for a share path and has been answered. */
export function createShareRoute(deps: ShareRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      if (!url.pathname.startsWith("/share/")) return false;
      const method = (req.method ?? "GET").toUpperCase();
      const json = String(req.headers["accept"] ?? "").includes("application/json");
      if (method !== "GET" && method !== "HEAD") { send(res, 405, "text/plain; charset=utf-8", "Shared links are read with GET.", false, { allow: "GET, HEAD" }); return true; }
      const head = method === "HEAD";
      const m = PATH.exec(url.pathname);
      if (!m) { notFound(res, json, head); return true; }
      void deps.view(m[1] as string).then((v) => {
        if (!v) return notFound(res, json, head);
        if (json) return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ data: v }), head);
        send(res, 200, "text/html; charset=utf-8", page(v), head);
      }).catch(() => { if (!res.headersSent) notFound(res, json, head); else res.end(); });
      return true;
    },
  };
}
