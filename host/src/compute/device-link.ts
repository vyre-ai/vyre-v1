// A person's own computer joined to a Team Space for their own turns (lane l-runson; owner rulings 2 and 3 Nov: "I wanna be able to stay in control of where I run it"). The Vyre app's device daemon
// holds one outbound socket to the Space's /compute/stream, signed in as the person (their own session, the one the app holds for that Space), and runs the CLI engine of a turn the Space places
// here, through this computer's own engine launcher and sandbox. The Space keeps the turn (queue, lease, tools over MCP, approvals, Stop, the record); only the engine process runs here.
//
//   one link per Space the person is signed in to on this computer (the app hands the session over: POST /local/chrome/spaces, see daemon.ts), dialled again after a drop
//   the hello says which engines this computer runs, so the Space never sends a turn it cannot take
//   a spawn for anyone but the person this link was signed in as is refused (cliRelay's person lock), whatever the Space says
//   a dial that does not open (the Space is unreachable, the computer just woke, or the session was signed out) is tried again, waiting longer each time up to a minute; the app takes the link away
//   at sign-out (DELETE /local/chrome/spaces)
import path from "node:path";
import { cliRelay } from "./node.ts";
import type { NodeLauncher, NodeSocket } from "./node.ts";

export interface DeviceLinkDeps {
  /** The Space's address as this computer reaches it (https://team.example.com). */
  server: string;
  /** The person's own signed-in session for that Space. Held in memory only. */
  token: string;
  dataDir: string;
  /** What this computer calls itself in the Runs-on menu. */
  name: string;
  /** The engines this computer can run (driver ids: claude_code, codex, grok). */
  engines: readonly string[];
  launcher: NodeLauncher;
  socket(url: string, headers: Record<string, string>): NodeSocket;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
  log(line: string): void;
  /** Pause between dials after a drop. Default 2 s. */
  retryMs?: number;
}

/** Hold the link until stopped, dialling again after a drop. */
export async function runDeviceLink(d: DeviceLinkDeps): Promise<"stopped"> {
  const server = d.server.replace(/\/+$/, "");
  const url = `${server.replace(/^http/, "ws")}/compute/stream`;
  let person: string | null = null;
  const engines = cliRelay({ launcher: d.launcher, dataDir: d.dataDir, server, log: d.log, person: () => person, workDir: (proc) => path.join(d.dataDir, "turns", proc) });
  const base = d.retryMs ?? 2_000;
  let wait = base;
  for (;;) {
    if (d.signal.aborted) return "stopped";
    const ended = await once();
    if (d.signal.aborted) return "stopped";
    wait = ended === "closed" ? base : Math.min(wait * 2, 60_000);
    await d.sleep(wait, d.signal).catch(() => undefined);
  }

  /** One socket: open, hello, serve engine frames until it closes. "refused" when it never opened (401). */
  function once(): Promise<"closed" | "refused"> {
    return new Promise((resolve) => {
      let opened = false;
      let hb: ReturnType<typeof setInterval> | undefined;
      const up = d.socket(url, { authorization: `Bearer ${d.token}` });
      const say = (m: Record<string, unknown>): void => { try { up.send(JSON.stringify(m)); } catch { /* the socket is going away */ } };
      const end = (): void => {
        // the Space ends every process of a dropped link; this side stops them too, so nothing runs on with nobody to read it
        engines.killAll();
        person = null;
        if (hb) clearInterval(hb);
        d.signal.removeEventListener("abort", stop);
        resolve(opened ? "closed" : "refused");
      };
      const stop = (): void => up.close();
      d.signal.addEventListener("abort", stop, { once: true });
      up.onOpen(() => {
        opened = true;
        say({ t: "hello", engines: [...d.engines], name: d.name });
        hb = setInterval(() => say({ t: "hb" }), 15_000); hb.unref?.();
      });
      up.onClose(end);
      up.onMessage((data) => {
        if (typeof data !== "string") return;
        let m: Record<string, unknown>;
        try { m = JSON.parse(data) as Record<string, unknown>; } catch { return; }
        if (m["t"] === "ready") { person = typeof m["person"] === "string" ? m["person"] : null; if (person) d.log(`Linked to ${server} for ${person}.`); return; }
        if (typeof m["t"] === "string" && m["t"].startsWith("cli_")) engines.frame(m, say);
        // views, ports and machine questions are a server's; a person's computer answers none of them
      });
    });
  }
}
