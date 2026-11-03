// The Team Spaces the person is signed in to on this computer, as the desktop shell hands them to its device daemon (apps/desktop/src-tauri/src/chrome.rs link_chrome_space and relink): each one
// becomes this computer's link to that Space (compute/device-link.ts), so the person's chats there can run here. The shell sends the person's own session for the Space; it is kept in memory only.
//
//   POST   /local/chrome/spaces          {id, name, address, token, compute?}   link (again) to that Space; a second POST for the same Space replaces the first
//                                         compute false: for Vyre for Chrome only (a Personal Space, a Team Space on this computer): kept for the extension, never dialled for chats
//   DELETE /local/chrome/spaces?id=spc_  stop linking to it (sign-out)
//
// Local only, like /local/daemon/stop: a loopback socket and this daemon's own admin token, which only the shell holds. A daemon that hosts a Space never links out (its own Space is here).
import type http from "node:http";

export interface TeamLink { id: string; name: string; address: string; token: string; compute?: boolean }

export interface TeamLinksDeps {
  /** This daemon's admin token: the shell's own key to it. */
  token: string;
  /** Start the link to one Space; returns its stop. */
  start(link: TeamLink): () => void;
  sameToken(a: string, b: string): boolean;
  log?(msg: string, attrs: Record<string, unknown>): void;
}

const PATH = "/local/chrome/spaces";
const SPACE_ID = /^spc_[A-Za-z0-9_]{1,120}$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function answer(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) { res.writeHead(status, { "cache-control": "no-store" }); res.end(); return; }
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

/** An address a link may dial: http(s) with a host, no credentials in it. */
export function linkAddress(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  try {
    const u = new URL(v);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username !== "" || u.password !== "" || u.hostname === "") return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

export function createTeamLinksRoute(d: TeamLinksDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean; ids(): string[]; sessions(): TeamLink[]; close(): void } {
  const links = new Map<string, { stop(): void; address: string; link: TeamLink }>();
  const drop = (id: string): void => { const l = links.get(id); if (l) { links.delete(id); l.stop(); } };
  return {
    ids: () => [...links.entries()].filter(([, l]) => l.link.compute !== false).map(([id]) => id),
    /** Every session the shell handed over, in the order it did (Vyre for Chrome acts as the person with these, lib/chrome-app.ts). */
    sessions: () => [...links.values()].map((l) => ({ ...l.link })),
    close() { for (const id of [...links.keys()]) drop(id); },
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname !== PATH) return false;
      const auth = String(req.headers["authorization"] ?? "");
      if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || !auth.startsWith("Bearer ") || !d.sameToken(auth.slice(7).trim(), d.token)) {
        answer(res, 401, { error: { code: "auth.unauthenticated", message: "Authentication is required." } });
        return true;
      }
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id") ?? "";
        if (!SPACE_ID.test(id)) { answer(res, 400, { error: { code: "validation.bad_input", message: "That is not a Space id." } }); return true; }
        drop(id);
        d.log?.("team.link_stopped", { space: id });
        answer(res, 204);
        return true;
      }
      if (req.method !== "POST") { answer(res, 405, { error: { code: "validation.bad_input", message: "Use POST or DELETE." } }); return true; }
      void (async () => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) { size += (c as Buffer).length; if (size > 8192) throw new Error("too large"); chunks.push(c as Buffer); }
        const o = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        const id = typeof o["id"] === "string" && SPACE_ID.test(o["id"]) ? o["id"] : null;
        const address = linkAddress(o["address"]);
        const token = typeof o["token"] === "string" && /^[\x21-\x7e]{8,512}$/.test(o["token"]) ? o["token"] : null;
        if (!id || !address || !token) { answer(res, 400, { error: { code: "validation.bad_input", message: "A Space id, its address and a session are needed." } }); return; }
        drop(id);
        const link: TeamLink = { id, name: typeof o["name"] === "string" ? o["name"].slice(0, 80) : "", address, token, ...(o["compute"] === false ? { compute: false } : {}) };
        links.set(id, { address, link, stop: link.compute === false ? () => undefined : d.start(link) });
        d.log?.("team.link_started", { space: id, address });
        answer(res, 204);
      })().catch(() => { if (!res.headersSent) answer(res, 400, { error: { code: "validation.bad_input", message: "That was not a Space to link." } }); });
      return true;
    },
  };
}
