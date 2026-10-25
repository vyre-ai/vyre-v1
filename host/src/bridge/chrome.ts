// The daemon's Chrome bridge (V1-SPEC 3.12, ARCH 7.12, the device service "chrome-bridge"): the other end of the native messaging host `run.vyre.bridge` (apps/chrome/src/worker/native/host.js).
// The host relays Chrome's framed messages to this over loopback HTTP with the daemon's admin token:
//
//   POST /chrome-bridge/v1/rpc      one request from the extension, one JSON reply
//   GET  /chrome-bridge/v1/events   newline-delimited JSON pushes to the extension (agent commands, fill pushes, Space changes)
//
// For agent browsing (apps/chrome/src/agent/protocol.js) it is the app's side of the chrome_* tools: callTool pushes { type: "agent.call", id, tool, input, agent, space } and waits for the
// extension's { op: "agent.result", input: { callId, ok, output | error } }; optIn pushes { type: "agent.optin", spaces, mode } (and again to every extension that connects later);
// { op: "agent.event" } lines (driving, acted, plan, stopped, paused, resumed) go to onEvent, which logs them under the agent. Capability calls and the other bridge operations (hello, space.select,
// login.check ...) are answered by the host's own handlers, handed in as `invoke` and `op`; without them the bridge answers "not_available" rather than guess.
// Nothing here reads a secret: a vault.fill is answered by the vault filler, which pushes the value to the extension on the events stream itself (`push`).

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface AgentRef { id: string; name: string }
export interface AgentEvent { event: string; [k: string]: unknown }
export type Reply = { id: string; ok: true; output: unknown } | { id: string; ok: false; error: { code: string; message: string } };

export interface ChromeBridgeDeps {
  /** The daemon's admin token: every request must carry it as a Bearer token. */
  token: string;
  /** One Space capability call from the extension, as the signed-in person or (in an agent's computer) the agent. */
  invoke?(capability: string, input: Record<string, unknown>, extra: { agent?: string; space?: string }): Promise<unknown>;
  /** A bridge-level operation the host answers (hello, space.select, agents.list, login.check, ask.page, app.open). */
  op?(op: string, input: Record<string, unknown>): Promise<unknown>;
  /** An event from the extension about an agent driving a tab, to be logged under that agent. */
  onEvent?(event: AgentEvent): void;
  /** How long a tool call may take before it fails with "timeout". Default 120 s (a page can be slow; the extension has its own waits). */
  timeoutMs?: number;
  setTimer?(f: () => void, ms: number): unknown;
  clearTimer?(t: unknown): void;
}

/** A tool failure the extension reported: the agent reads `message`, the run log keeps `code`. */
export class ChromeToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ChromeToolError";
  }
}

const MAX_BODY = 1 << 20;
const TOOL = /^chrome_[a-z_]+$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (id: string, code: string, message: string): Reply => ({ id, ok: false, error: { code, message } });

export function createChromeBridge(deps: ChromeBridgeDeps) {
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const setTimer = deps.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: unknown }>();
  const streams = new Set<(line: string) => void>();
  const ends = new Set<() => void>();
  let seq = 0;
  let lastOptIn: { spaces: string[]; mode: "personal" | "computer" } | null = null;

  const line = (m: unknown): string => `${JSON.stringify(m)}\n`;
  /** Push one message to every extension connected on the events stream. Returns how many got it. */
  function push(m: unknown): number {
    const text = line(m);
    for (const write of streams) write(text);
    return streams.size;
  }

  function settle(callId: string, input: Record<string, unknown>): boolean {
    const wait = pending.get(callId);
    if (!wait) return false;
    pending.delete(callId);
    clearTimer(wait.timer);
    if (input["ok"] === true) wait.resolve(input["output"]);
    else {
      const e = isObject(input["error"]) ? input["error"] : {};
      wait.reject(new ChromeToolError(typeof e["code"] === "string" ? e["code"] : "error", typeof e["message"] === "string" ? e["message"] : "The tool failed."));
    }
    return true;
  }

  /** One request from the extension. Never throws: a failure is a reply with an error. */
  async function rpc(body: unknown): Promise<Reply> {
    if (!isObject(body) || typeof body["id"] !== "string") return fail("", "bad_request", "A request has an id.");
    const id = body["id"];
    const input = isObject(body["input"]) ? body["input"] : {};
    try {
      if (body["type"] === "bridge" && typeof body["op"] === "string") {
        const op = body["op"];
        if (op === "agent.result") {
          const callId = input["callId"];
          if (typeof callId !== "string") return fail(id, "bad_request", "A result names the call it answers.");
          // a result nobody waits for (the call timed out, or the daemon restarted) is acknowledged and dropped
          settle(callId, input);
          return { id, ok: true, output: {} };
        }
        if (op === "agent.event") {
          if (typeof input["event"] === "string") deps.onEvent?.(input as AgentEvent);
          return { id, ok: true, output: {} };
        }
        if (!deps.op) return fail(id, "not_available", "The Vyre app cannot answer that yet.");
        return { id, ok: true, output: await deps.op(op, input) };
      }
      if (body["type"] === "invoke" && typeof body["capability"] === "string") {
        if (!deps.invoke) return fail(id, "not_available", "The Vyre app cannot answer that yet.");
        const extra: { agent?: string; space?: string } = {};
        if (typeof body["agent"] === "string") extra.agent = body["agent"];
        if (typeof body["space"] === "string") extra.space = body["space"];
        return { id, ok: true, output: await deps.invoke(body["capability"], input, extra) };
      }
      return fail(id, "bad_request", "Not a request this bridge understands.");
    } catch (e) {
      const err = e as { code?: unknown; error?: { code?: unknown; message?: unknown }; message?: unknown };
      const code = typeof err.error?.code === "string" ? err.error.code : typeof err.code === "string" ? err.code : "error";
      const message = typeof err.error?.message === "string" ? err.error.message : typeof err.message === "string" ? err.message : "Something went wrong.";
      return fail(id, code, message);
    }
  }

  return {
    rpc,
    push,
    /** Extensions currently connected on the events stream. */
    get connected(): number { return streams.size; },

    /** Which Spaces' agents may drive the Chrome connected here (never stored by the extension), and in what mode. Also sent to every extension that connects later. */
    optIn(spaces: string[], mode: "personal" | "computer"): void {
      lastOptIn = { spaces: [...spaces], mode };
      push({ type: "agent.optin", spaces, mode });
    },

    /** Run one chrome_* tool for an agent in a Space, in the extension that owns the tab. Rejects with ChromeToolError (code from the extension, or "offline" / "timeout"). */
    callTool(call: { tool: string; input?: Record<string, unknown>; agent: AgentRef; space: string; timeoutMs?: number }): Promise<unknown> {
      if (!TOOL.test(call.tool)) return Promise.reject(new ChromeToolError("unknown_tool", `${call.tool} is not a Chrome tool.`));
      const id = `ac_${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => { pending.delete(id); reject(new ChromeToolError("timeout", "The page did not answer in time.")); }, call.timeoutMs ?? timeoutMs);
        pending.set(id, { resolve, reject, timer });
        const sent = push({ type: "agent.call", id, tool: call.tool, input: call.input ?? {}, agent: { id: call.agent.id, name: call.agent.name }, space: call.space });
        if (sent === 0) { pending.delete(id); clearTimer(timer); reject(new ChromeToolError("offline", "The Vyre app is not reachable from this Chrome.")); }
      });
    },

    /** End every events stream (the daemon is stopping); the native host sees the end and exits. */
    closeStreams(): void {
      for (const end of ends) end();
      ends.clear();
      streams.clear();
    },

    /** Every call waiting for an answer fails (the extension disconnected for good, or the daemon is stopping). */
    failAll(code = "offline", message = "The Vyre app is not reachable from this Chrome."): void {
      for (const [id, w] of pending) { clearTimer(w.timer); w.reject(new ChromeToolError(code, message)); pending.delete(id); }
    },

    /** The HTTP routes. Returns true when the request was for this bridge (and has been answered), false to let the daemon's other routes have it. */
    handle(req: IncomingMessage, res: ServerResponse): boolean {
      const url = (req.url ?? "").split("?")[0];
      if (url !== "/chrome-bridge/v1/rpc" && url !== "/chrome-bridge/v1/events") return false;
      const sent = req.headers["authorization"];
      const given = Buffer.from(typeof sent === "string" && sent.startsWith("Bearer ") ? sent.slice(7) : "");
      const want = Buffer.from(deps.token);
      if (given.length !== want.length || !timingSafeEqual(given, want)) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":{"code":"unauthorized"}}'); return true; }
      if (url === "/chrome-bridge/v1/events") {
        if (req.method !== "GET") { res.writeHead(405); res.end(); return true; }
        res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
        res.flushHeaders();   // headers go out now: a client waits for the status before the first push, and an idle stream sends nothing else
        const write = (text: string): void => { res.write(text); };
        const end = (): void => { try { res.end(); } catch { /* already closed */ } };
        streams.add(write);
        ends.add(end);
        if (lastOptIn) write(line({ type: "agent.optin", ...lastOptIn }));
        req.on("close", () => { streams.delete(write); ends.delete(end); });
        return true;
      }
      if (req.method !== "POST") { res.writeHead(405); res.end(); return true; }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify(fail("", "bad_request", "Not JSON."))); return; }
        void rpc(body).then((reply) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); });
      });
      return true;
    },
  };
}

export type ChromeBridge = ReturnType<typeof createChromeBridge>;
