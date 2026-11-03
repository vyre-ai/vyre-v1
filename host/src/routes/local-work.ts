// What is running on this computer right now, for the desktop shell before it updates the app (apps/desktop/src-tauri/src/updater.rs). The shell stops every daemon, swaps the binaries and starts them
// again; it must never do that in the middle of a chat turn. So before it stops a daemon it asks here:
//
//   GET  /local/daemon/busy    {turns, sources: [{name, turns}]}   the turns running on this computer now
//   POST /local/daemon/drain   the same answer, after every source that can hand its turns over has done so
//
// A source is anything that runs turns here: the engine module's own turns (a Personal Space, or the Space a Mac hosts), and a person's turns for a Team Space that this computer runs over its link
// (lane l-runson). A source that can hand its turns over to the Space's server (a link: the Space goes on with the same turn there) does so on drain; one that cannot is waited for, and the shell
// updates once the count is 0. A turn waiting for an approval is not running: it waits the same after a restart.
//
// Local only, like /local/daemon/stop: a loopback socket and this daemon's own admin token, which only the shell holds.
import type http from "node:http";

export interface LocalWorkSource {
  name: string;
  /** Turns running here now. */
  running(): number;
  /** Hand the running turns to the server, when the source can (its turns go on there). Absent: the turns are waited for. */
  handOver?(): Promise<void> | void;
}

export interface LocalWorkState { turns: number; sources: Array<{ name: string; turns: number }> }

export interface LocalWork {
  /** Add a source; returns its removal. */
  add(source: LocalWorkSource): () => void;
  state(): LocalWorkState;
  drain(): Promise<LocalWorkState>;
}

export function createLocalWork(): LocalWork {
  const sources = new Set<LocalWorkSource>();
  const state = (): LocalWorkState => {
    const list = [...sources].map((s) => { let n = 0; try { n = Math.max(0, Math.floor(s.running())); } catch { n = 0; } return { name: s.name, turns: n }; });
    return { turns: list.reduce((a, s) => a + s.turns, 0), sources: list };
  };
  return {
    add(source) { sources.add(source); return () => { sources.delete(source); }; },
    state,
    async drain() {
      for (const s of sources) {
        if (!s.handOver) continue;
        let n = 0;
        try { n = s.running(); } catch { n = 0; }
        if (n > 0) await Promise.resolve(s.handOver()).catch(() => undefined);
      }
      return state();
    },
  };
}

const BUSY = "/local/daemon/busy";
const DRAIN = "/local/daemon/drain";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function answer(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

export function createLocalWorkRoute(d: { token: string; work: LocalWork; sameToken(a: string, b: string): boolean }): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== BUSY && path !== DRAIN) return false;
      const auth = String(req.headers["authorization"] ?? "");
      if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || !auth.startsWith("Bearer ") || !d.sameToken(auth.slice(7).trim(), d.token)) {
        answer(res, 401, { error: { code: "auth.unauthenticated", message: "Authentication is required." } });
        return true;
      }
      if (path === BUSY && req.method === "GET") { answer(res, 200, { data: d.work.state() }); return true; }
      if (path === DRAIN && req.method === "POST") {
        void d.work.drain().then((s) => answer(res, 200, { data: s }), () => answer(res, 200, { data: d.work.state() }));
        return true;
      }
      answer(res, 405, { error: { code: "validation.method", message: "That method is not allowed here." } });
      return true;
    },
  };
}
