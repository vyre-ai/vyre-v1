// Connect my GitHub, the browser leg (lane l-ci-runners). github.me.connect gives the address that sends the person to GitHub; GitHub sends them back to GET /hooks/github/connect with a one-use code and the
// state github.me.connect made. This route checks the shape of the state and the return address, then sends the browser back to the app with the code and the state in the URL FRAGMENT (never logged).
// The app then calls github.me.complete {code, state} as the signed-in person: that call checks the state is theirs, unused and recent (single use) and holds the PKCE verifier, which never leaves the server.
// The state is "<random>.<base64url(return address)>". The return address is the Space's own origin or a loopback address, as for sign-in with GitHub, so a crafted link cannot hand a code to a stranger's site.
import http from "node:http";

const PATH = "/hooks/github/connect";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const STATE = /^[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{4,600}$/;

export function returnOf(state: string): string | null {
  if (!STATE.test(state)) return null;
  try { return Buffer.from(state.split(".")[1]!, "base64url").toString("utf8"); } catch { return null; }
}

const page = (res: http.ServerResponse, status: number, text: string): void => { res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }); res.end(text); };

export function createGithubConnectRoute(): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const origin = (req: http.IncomingMessage): string => {
    const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() || ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
    return `${proto === "https" ? "https" : "http"}://${req.headers.host ?? "localhost"}`;
  };
  const allowed = (own: string, ret: string): string | null => {
    try { const u = new URL(ret); return u.origin === own || (LOOPBACK.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:")) ? u.origin + u.pathname + u.search : null; } catch { return null; }
  };
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      if (url.pathname !== PATH) return false;
      if ((req.method ?? "GET").toUpperCase() !== "GET") { page(res, 405, "Not a way in."); return true; }
      const state = url.searchParams.get("state") ?? "";
      const ret = returnOf(state);
      const to = ret === null ? null : allowed(origin(req), ret);
      if (!to) { page(res, 400, "This GitHub link is not valid. Go back to Vyre and connect again."); return true; }
      const code = url.searchParams.get("code") ?? "";
      const frag = url.searchParams.get("error") || !code || code.length > 200 ? "github_connect=denied" : `github_connect_code=${encodeURIComponent(code)}&github_connect_state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location: `${to}#${frag}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end();
      return true;
    },
  };
}
