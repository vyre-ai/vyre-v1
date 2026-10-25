// The vault .env pull route (spec 2.20; vault.export_env): GET /exports/<exportId>?token=<one-time token> answers the .env text.
// The link is the credential, so there is no session: whoever holds the id and the token may pull, once. The vault decides what the token is worth (exportPull checks the hash, expiry and
// revocation); this route adds what only the edge can: single use, no caching, no logging of anything but the export id.
//   - one answer for every refusal (unknown, wrong token, expired, revoked, already pulled): 404 with the same body, so a caller learns nothing about which it was
//   - single use: the first successful pull closes the link for this process at once (a claim taken before the vault is asked, so two pulls racing get one answer); a refused pull gives the claim back
//   - GET only. HEAD is refused (405) so a link preview or a scanner cannot use the link up.
//   - 200: text/plain, Cache-Control no-store, attachment named .env, nosniff, no referrer
import type http from "node:http";
import { makeError } from "./errors.ts";

export interface VaultExportRouteDeps {
  /** The .env text for this export and token, or a throw (vault.exportPull on the host's vault ctx). A throw of any kind is a refusal. */
  pull(exportId: string, token: string): string | Promise<string>;
  /** Told after each pull with the export id only: never the token, never the text. */
  log?(entry: { exportId: string; outcome: "pulled" | "refused" }): void;
}

const PATH = /^(?:\/spaces\/[^/]+)?\/exports\/(vex_[a-z0-9_]+)$/;
const TRACE = "0".repeat(32);

function refuse(res: http.ServerResponse, status: number, headers: Record<string, string> = {}): void {
  const body = JSON.stringify({ error: makeError("validation.not_found", TRACE, { message: "This link is closed or has expired." }) });
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", ...headers });
  res.end(body);
}

/** The route as a request hook, like the blob route: true when the request was for an export path and has been answered, false when the daemon should carry on. */
export function createVaultExportRoute(deps: VaultExportRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const claimed = new Set<string>();   // ids pulled, or being pulled, by this process

  async function serve(res: http.ServerResponse, exportId: string, token: string): Promise<void> {
    if (token === "" || claimed.has(exportId)) { deps.log?.({ exportId, outcome: "refused" }); return refuse(res, 404); }
    claimed.add(exportId);
    let text: string;
    try {
      text = await deps.pull(exportId, token);
    } catch {
      claimed.delete(exportId);
      deps.log?.({ exportId, outcome: "refused" });
      return refuse(res, 404);
    }
    deps.log?.({ exportId, outcome: "pulled" });
    const bytes = Buffer.from(text, "utf8");
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8", "content-length": bytes.byteLength, "cache-control": "no-store", pragma: "no-cache",
      "content-disposition": 'attachment; filename=".env"', "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    });
    res.end(bytes);
  }

  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      const m = PATH.exec(url.pathname);
      if (!m) return false;
      if ((req.method ?? "GET").toUpperCase() !== "GET") { refuse(res, 405, { allow: "GET" }); return true; }
      void serve(res, m[1] as string, url.searchParams.get("token") ?? "").catch(() => { if (!res.headersSent) refuse(res, 404); else res.end(); });
      return true;
    },
  };
}
