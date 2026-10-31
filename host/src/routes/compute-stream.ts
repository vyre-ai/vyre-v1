// The live view of an agent computer that lives on a node (a computer that joined the Space). The node only dials out, so the Space never connects in: the node holds ONE WebSocket to /compute/stream, and a
// viewer's connection to the Space is bridged onto it.
//
//   node  -> Space   GET /compute/stream (upgrade) with `Authorization: Bearer <credential>`; a revoked or unknown credential is a plain 401. One socket per node; a newer one replaces the older.
//   viewer -> Space  GET /computers/<id>/stream?ticket=...  (MJPEG) or /computers/<id>/ws?ticket=...  (WebSocket: frames down, the person's input up). The ticket is the one computers.stream or
//                    computers.take_over handed out: one use, sixty seconds, for this computer only. It is spent by the computers module (computers.stream_open), which also says which node the computer lives on.
//
// Frames on the node socket. Text (JSON):
//   Space -> node  {t:"open", view, computerId}    {t:"input", view, data}    {t:"close", view}
//   node -> Space  {t:"opened", view}  {t:"failed", view, reason}  {t:"ended", view}  {t:"msg", view, data}  {t:"hb"}
// Binary, node -> Space: one byte n, then n bytes of the view id, then a JPEG.
//
// The same socket carries one more thing: a CLI engine process of a turn pinned to this node (spawnProc below). The Space names the process, sends its argv, folder and environment, and then its input;
// the node runs it on its own sandbox and sends its output and its end back. Text frames, tagged by `proc`:
//   Space -> node  {t:"cli_spawn", proc, argv, cwd?, env}   {t:"cli_in", proc, data}   {t:"cli_end", proc}   {t:"cli_kill", proc, signal}      (data is base64)
//   node -> Space  {t:"cli_started", proc, pid?}  {t:"cli_out", proc, data, err?}  {t:"cli_exit", proc, code, signal}  {t:"cli_failed", proc, code, reason}
// A frame naming a process that is not one of this socket's is dropped, like a view. A node that goes away ends its processes.
//
// What keeps one node out of another's computers: the Space chooses the node from the register (computers.stream_open), mints the view id itself, and only sends `open` on that node's socket. A frame, a
// message or an `ended` carrying a view id that is not one of this socket's views is dropped. Input is passed on only for a take-over ticket, and only while the person still holds the controls (asked of the
// module again every half second), so nothing gets through before take-over or after a give-back; agentd's own check is the second lock. A node that is removed has its sockets closed the moment the Space
// hears of it (closeNode) and, as a backstop, within `recheckMs`.
import type http from "node:http";
import type { Duplex } from "node:stream";
import { makeError } from "./errors.ts";
import { acceptPeer as accept } from "../ws.ts";
import type { Peer } from "../ws.ts";
import { sourceOf } from "../daemon/preauth.ts";

const TRACE = "0".repeat(32);
const NODE_PATH = "/compute/stream";
const VIEW_PATH = /^\/computers\/(cmt_[a-z0-9]{1,64})\/(stream|ws)$/;
const MAX_NODE_FRAME = 4 * 1024 * 1024;
const MAX_VIEWER_MESSAGE = 4 * 1024;
const MAX_VIEWS_PER_NODE = 8;
const BACKLOG = 2 * 1024 * 1024;
const BOUNDARY = "vyreframe";
const OPEN_MS = 12_000;
const INPUT_CHECK_MS = 500;

export interface ComputeStreamDeps {
  /** Who holds this credential, if still admitted (the network module's node_poll). */
  poll(credential: string): Promise<{ serverId: string } | null>;
  /** Spend a viewer's ticket for this computer: the node it lives on, who the ticket was issued to, and whether that person holds the controls. Null when the ticket is not good. */
  open(ticket: string, computerId: string): Promise<{ nodeId: string; personId: string; input: boolean } | null>;
  /** Does this person still hold the controls of this computer? */
  mayInput(computerId: string, personId: string): Promise<boolean>;
  now?: () => number;
  /** How often a connected node's credential is checked again. Default 2 s. */
  recheckMs?: number;
  /** A node that has said nothing for this long is dropped. Default 60 s. */
  deadMs?: number;
}

/** How a relayed process ended (the same shape the local launcher reports). */
export interface RelayExit { code: number | null; signal: string | null }

/** A CLI process running on a node, as the engine's launcher wants it (agent/src/drivers/cli/types.ts CliProcess, structural here). */
export interface RelayProc {
  readonly pid: number | undefined;
  readonly stdout: AsyncIterable<Uint8Array>;
  write(data: string): Promise<void>;
  endInput(): void;
  readonly exited: Promise<RelayExit>;
  stderrTail(): string;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

/** Why a process could not be started on a node: the node is not connected, or it refused. `code` is an engine error code. */
export class RelayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "RelayError"; this.code = code; }
}

export interface ComputeStream {
  /** Start a process on a node, over its socket. Rejects with RelayError (engine.server_off) when the node is not connected, or with the node's own refusal. */
  spawnProc(nodeId: string, spec: { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>> }): Promise<RelayProc>;
  /** Does this upgrade request belong here? The live hub leaves such a request alone. */
  claims(req: http.IncomingMessage): boolean;
  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  /** GET /computers/<id>/stream. False when the request is not for this route. */
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
  /** The node left the Space: close its socket and end its views. Returns how many sockets were closed. */
  closeNode(nodeId: string): number;
  connected(nodeId: string): boolean;
  close(): void;
}

interface NodeConn { nodeId: string; credential: string; peer: Peer; views: Set<string>; procs: Set<string>; lastSeen: number }
interface ProcState {
  id: string; nodeId: string; started(pid: number | undefined): void; failed(e: RelayError): void; out(bytes: Buffer, err: boolean): void; exit(x: RelayExit): void;
}
const PROC_START_MS = 15_000;
const MAX_PROCS_PER_NODE = 16;
const STDERR_TAIL = 4096;
interface View {
  id: string; nodeId: string; computerId: string; personId: string; input: boolean;
  frame(jpeg: Buffer): void;
  text(data: string): void;
  opened(): void;
  fail(reason: string): void;
  end(): void;
  inputOk: { at: number; ok: boolean };
}

export function createComputeStream(deps: ComputeStreamDeps): ComputeStream {
  const now = deps.now ?? Date.now;
  const nodes = new Map<string, NodeConn>();
  const views = new Map<string, View>();
  const procs = new Map<string, ProcState>();
  const hits = new Map<string, number[]>();
  const limited = (key: string, max: number): boolean => {
    const at = now(), list = (hits.get(key) ?? []).filter((t) => at - t < 60_000);
    list.push(at); hits.delete(key); hits.set(key, list);
    if (hits.size > 5_000) hits.delete(hits.keys().next().value as string);
    return list.length > max;
  };
  const plain = (res: http.ServerResponse, status: number, code: string, message: string): void => {
    const text = JSON.stringify({ error: makeError(code as never, TRACE, { message }) });
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
    res.end(text);
  };
  const refuseUpgrade = (socket: Duplex, status: string): void => { socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\ncache-control: no-store\r\n\r\n`); };
  const sourceFor = (req: http.IncomingMessage): string => sourceOf({ "x-vyre-remote": req.socket.remoteAddress ?? "", ...(typeof req.headers["x-forwarded-for"] === "string" ? { "x-forwarded-for": req.headers["x-forwarded-for"] } : {}) });

  function dropView(id: string, tell: boolean): void {
    const v = views.get(id);
    if (!v) return;
    views.delete(id);
    const n = nodes.get(v.nodeId);
    n?.views.delete(id);
    if (tell && n?.peer.open) n.peer.send(JSON.stringify({ t: "close", view: id }));
    v.end();
  }
  /** The node went away with processes running: each one ends as killed, so the turn fails and says so. */
  function dropProcs(n: NodeConn): void {
    for (const id of [...n.procs]) {
      const p = procs.get(id);
      procs.delete(id);
      n.procs.delete(id);
      p?.failed(new RelayError("engine.server_off", "The server went away."));
      p?.exit({ code: null, signal: "SIGKILL" });
    }
  }
  function dropNode(n: NodeConn, code: number): void {
    if (nodes.get(n.nodeId) === n) nodes.delete(n.nodeId);
    for (const id of [...n.views]) dropView(id, false);
    dropProcs(n);
    n.peer.close(code);
  }

  // ---- the node's socket

  function onNode(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    void (async () => {
      if (limited(`node:${sourceFor(req)}`, 30)) { refuseUpgrade(socket, "429 Too Many Requests"); return; }
      const auth = req.headers["authorization"];
      const credential = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const who = credential.startsWith("vcc_") ? await deps.poll(credential).catch(() => null) : null;
      if (!who) { refuseUpgrade(socket, "401 Unauthorized"); return; }
      const peer = accept(req, socket, head, MAX_NODE_FRAME);
      if (!peer) return;
      const conn: NodeConn = { nodeId: who.serverId, credential, peer, views: new Set(), procs: new Set(), lastSeen: now() };
      const old = nodes.get(conn.nodeId);
      if (old) dropNode(old, 4000);
      nodes.set(conn.nodeId, conn);
      peer.send(JSON.stringify({ t: "ready" }));
      peer.onClose(() => { if (nodes.get(conn.nodeId) === conn) nodes.delete(conn.nodeId); for (const id of [...conn.views]) dropView(id, false); dropProcs(conn); });
      peer.onMessage((data, binary) => {
        conn.lastSeen = now();
        if (binary) {
          const n = data[0] ?? 0;
          const id = data.subarray(1, 1 + n).toString("latin1");
          const v = views.get(id);
          if (v && v.nodeId === conn.nodeId && conn.views.has(id)) v.frame(data.subarray(1 + n));
          return;
        }
        let m: { t?: unknown; view?: unknown; reason?: unknown; data?: unknown; proc?: unknown; pid?: unknown; err?: unknown; code?: unknown; signal?: unknown };
        try { m = JSON.parse(data.toString("utf8")) as typeof m; } catch { return; }
        if (m.t === "hb") return;
        if (typeof m.t === "string" && m.t.startsWith("cli_")) {
          const pid = typeof m.proc === "string" ? m.proc : "";
          const p = procs.get(pid);
          if (!p || p.nodeId !== conn.nodeId || !conn.procs.has(pid)) return;   // not one of this socket's processes: ignored
          if (m.t === "cli_started") p.started(typeof m.pid === "number" ? m.pid : undefined);
          else if (m.t === "cli_out" && typeof m.data === "string") p.out(Buffer.from(m.data, "base64"), m.err === true);
          else if (m.t === "cli_failed") { procs.delete(pid); conn.procs.delete(pid); p.failed(new RelayError(typeof m.code === "string" ? m.code : "engine.cli_failed", typeof m.reason === "string" ? m.reason.slice(0, 300) : "The server could not start it.")); p.exit({ code: null, signal: null }); }
          else if (m.t === "cli_exit") { procs.delete(pid); conn.procs.delete(pid); p.exit({ code: typeof m.code === "number" ? m.code : null, signal: typeof m.signal === "string" ? m.signal : null }); }
          return;
        }
        const id = typeof m.view === "string" ? m.view : "";
        const v = views.get(id);
        if (!v || v.nodeId !== conn.nodeId || !conn.views.has(id)) return;   // not one of this socket's views: ignored
        if (m.t === "opened") v.opened();
        else if (m.t === "failed") { v.fail(typeof m.reason === "string" ? m.reason.slice(0, 200) : "The computer could not open its view."); dropView(id, false); }
        else if (m.t === "ended") dropView(id, false);
        else if (m.t === "msg" && typeof m.data === "string") v.text(m.data);
      });
    })().catch(() => refuseUpgrade(socket, "500 Internal Server Error"));
  }

  // ---- a viewer

  /** Spend the ticket and ask the node to open the view. Resolves once the node says it has, or with why not. */
  async function attach(computerId: string, ticket: string, make: (id: string, opened: { nodeId: string; personId: string; input: boolean }) => Omit<View, "id" | "nodeId" | "computerId" | "personId" | "input" | "inputOk">): Promise<{ ok: true; view: View } | { ok: false; status: number; message: string }> {
    const opened = ticket ? await deps.open(ticket, computerId).catch(() => null) : null;
    if (!opened) return { ok: false, status: 403, message: "This view needs a live ticket for this computer." };
    const node = nodes.get(opened.nodeId);
    if (!node?.peer.open) return { ok: false, status: 503, message: "The computer is not connected to the Space right now." };
    if (node.views.size >= MAX_VIEWS_PER_NODE) return { ok: false, status: 429, message: "This computer already has as many viewers as it can serve." };
    const id = `viw_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("")}`;
    const view: View = { id, nodeId: opened.nodeId, computerId, personId: opened.personId, input: opened.input, inputOk: { at: 0, ok: false }, ...make(id, opened) };
    views.set(id, view);
    node.views.add(id);
    node.peer.send(JSON.stringify({ t: "open", view: id, computerId }));
    return { ok: true, view };
  }

  function handleMjpeg(req: http.IncomingMessage, res: http.ServerResponse, computerId: string): void {
    if (limited(`view:${sourceFor(req)}`, 60)) { res.setHeader("retry-after", "60"); return plain(res, 429, "rate_limit.exceeded", "Too many requests from this address."); }
    const ticket = new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? "";
    let started = false;
    let settle: (v: { status: number; message: string } | null) => void = () => undefined;
    const answered = new Promise<{ status: number; message: string } | null>((r) => { settle = r; });
    void (async () => {
      const got = await attach(computerId, ticket, () => ({
        frame(jpeg) {
          if (!started || res.writableLength > BACKLOG) return;
          res.write(`--${BOUNDARY}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`);
          res.write(jpeg);
          res.write("\r\n");
        },
        text() { /* an MJPEG viewer has no input channel */ },
        opened() { settle(null); },
        fail(reason) { settle({ status: 502, message: reason }); },
        end() { settle({ status: 502, message: "The computer closed its view." }); if (started) res.end(); },
      }));
      if (!got.ok) return plain(res, got.status, got.status === 403 ? "permission.no_grant" : "validation.precondition_failed", got.message);
      const timer = setTimeout(() => { settle({ status: 504, message: "The computer did not open its view in time." }); dropView(got.view.id, true); }, OPEN_MS);
      res.once("close", () => { clearTimeout(timer); dropView(got.view.id, true); });
      const failed = await answered;
      clearTimeout(timer);
      if (failed) { dropView(got.view.id, true); return plain(res, failed.status, "validation.precondition_failed", failed.message); }
      if (res.destroyed) return;
      started = true;
      res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "cache-control": "no-store", connection: "close" });
    })().catch(() => { if (!res.headersSent) plain(res, 500, "internal.unexpected", "The live view could not be opened."); });
  }

  function onViewer(req: http.IncomingMessage, socket: Duplex, head: Buffer, computerId: string): void {
    void (async () => {
      if (limited(`view:${sourceFor(req)}`, 60)) { refuseUpgrade(socket, "429 Too Many Requests"); return; }
      const ticket = new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? "";
      let peer: Peer | null = null;
      let gotOpened: () => void = () => undefined;
      let gotFailed: (reason: string) => void = () => undefined;
      const answered = new Promise<string | null>((resolve) => { gotOpened = () => resolve(null); gotFailed = resolve; });
      const got = await attach(computerId, ticket, () => ({
        frame(jpeg) { peer?.send(jpeg); },
        text(data) { peer?.send(data); },
        opened() { gotOpened(); },
        fail(reason) { gotFailed(reason); },
        end() { gotFailed("The computer closed its view."); peer?.close(1000); },
      }));
      if (!got.ok) { refuseUpgrade(socket, got.status === 403 ? "403 Forbidden" : got.status === 429 ? "429 Too Many Requests" : "503 Service Unavailable"); return; }
      const view = got.view;
      const timer = setTimeout(() => gotFailed("The computer did not open its view in time."), OPEN_MS);
      const failed = await answered;
      clearTimeout(timer);
      if (failed) { dropView(view.id, true); refuseUpgrade(socket, "502 Bad Gateway"); return; }
      peer = accept(req, socket, head, MAX_VIEWER_MESSAGE);
      if (!peer) { dropView(view.id, true); return; }
      const viewer = peer;
      viewer.onClose(() => dropView(view.id, true));
      viewer.onMessage((data, binary) => {
        if (binary || !views.has(view.id)) return;
        const text = data.toString("utf8");
        let m: { t?: unknown; seq?: unknown };
        try { m = JSON.parse(text) as typeof m; } catch { return; }
        const seq = typeof m.seq === "number" ? m.seq : 0;
        if (m.t === "ping") { viewer.send(JSON.stringify({ t: "pong", seq })); return; }
        void (async () => {
          const at = now();
          // The person may act only with a take-over ticket and only while they still hold the controls; the module is asked again (not more than twice a second) so a give-back stops it.
          if (view.input && at - view.inputOk.at >= INPUT_CHECK_MS) view.inputOk = { at, ok: await deps.mayInput(computerId, view.personId).catch(() => false) };
          if (!view.input || !view.inputOk.ok) { viewer.send(JSON.stringify({ t: "refused", seq, reason: "A person has to take over before the view takes input." })); return; }
          const n = nodes.get(view.nodeId);
          if (!views.has(view.id) || !n?.peer.open) return;
          n.peer.send(JSON.stringify({ t: "input", view: view.id, data: text }));
        })();
      });
    })().catch(() => refuseUpgrade(socket, "500 Internal Server Error"));
  }

  // ---- liveness: a node that was removed, or has gone quiet, is dropped

  const deadMs = deps.deadMs ?? 60_000;
  const timer = setInterval(() => {
    for (const n of [...nodes.values()]) {
      if (now() - n.lastSeen > deadMs) { dropNode(n, 4001); continue; }
      void deps.poll(n.credential).then((who) => { if (!who || who.serverId !== n.nodeId) dropNode(n, 4003); }).catch(() => undefined);
    }
  }, deps.recheckMs ?? 2_000);
  timer.unref();

  /** One process on one node. Output is queued until the engine reads it; the end waits until the output is drained. */
  async function spawnProc(nodeId: string, spec: { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>> }): Promise<RelayProc> {
    const node = nodes.get(nodeId);
    if (!node?.peer.open) throw new RelayError("engine.server_off", "The server is not connected to the Space right now.");
    if (node.procs.size >= MAX_PROCS_PER_NODE) throw new RelayError("engine.server_busy", "The server is already running as many engines as it can.");
    const id = `prc_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join("")}`;
    const chunks: Buffer[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    let tail = "";
    let pidSeen: number | undefined;
    let resolveExit: (x: RelayExit) => void = () => undefined;
    const exited = new Promise<RelayExit>((r) => { resolveExit = r; });
    let settleStart: { ok(): void; fail(e: RelayError): void } = { ok() {}, fail() {} };
    const startup = new Promise<void>((ok, fail) => { settleStart = { ok, fail }; });
    const state: ProcState = {
      id, nodeId,
      started(pid) { pidSeen = pid; settleStart.ok(); },
      failed(e) { settleStart.fail(e); },
      out(bytes, err) {
        if (err) { tail = (tail + bytes.toString("utf8")).slice(-STDERR_TAIL); return; }
        chunks.push(bytes); wake?.();
      },
      exit(x) { ended = true; wake?.(); resolveExit(x); },
    };
    procs.set(id, state);
    node.procs.add(id);
    const send = (m: Record<string, unknown>): void => { const n = nodes.get(nodeId); if (n?.peer.open) n.peer.send(JSON.stringify({ ...m, proc: id })); };
    send({ t: "cli_spawn", argv: [...spec.argv], ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}), env: { ...spec.env } });
    const timer = setTimeout(() => { settleStart.fail(new RelayError("engine.server_off", "The server did not start the engine in time.")); procs.delete(id); node.procs.delete(id); send({ t: "cli_kill", signal: "SIGKILL" }); }, PROC_START_MS);
    try { await startup; } finally { clearTimeout(timer); }
    async function* stdout(): AsyncGenerator<Uint8Array> {
      for (;;) {
        const next = chunks.shift();
        if (next) { yield next; continue; }
        if (ended) return;
        await new Promise<void>((r) => { wake = r; });
        wake = null;
      }
    }
    return {
      get pid() { return pidSeen; },
      stdout: stdout(),
      write: (data) => { if (ended) return Promise.reject(new Error("stdin is closed")); send({ t: "cli_in", data: Buffer.from(data, "utf8").toString("base64") }); return Promise.resolve(); },
      endInput: () => send({ t: "cli_end" }),
      exited,
      stderrTail: () => tail,
      kill: (signal = "SIGTERM") => send({ t: "cli_kill", signal }),
    };
  }

  return {
    spawnProc,
    claims(req) {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === NODE_PATH) return true;
      const m = VIEW_PATH.exec(path);
      return !!m && m[2] === "ws";
    },
    upgrade(req, socket, head) {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === NODE_PATH) return onNode(req, socket, head);
      const m = VIEW_PATH.exec(path);
      if (m && m[2] === "ws") return onViewer(req, socket, head, m[1]!);
      refuseUpgrade(socket, "404 Not Found");
    },
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://x");
      const m = VIEW_PATH.exec(url.pathname);
      if (!m || m[2] !== "stream") return false;
      if (req.method !== "GET") { plain(res, 405, "validation.bad_input", "Use GET."); return true; }
      handleMjpeg(req, res, m[1]!);
      return true;
    },
    closeNode(nodeId) {
      const n = nodes.get(nodeId);
      if (!n) return 0;
      dropNode(n, 4003);
      return 1;
    },
    connected: (nodeId) => nodes.get(nodeId)?.peer.open === true,
    close() { clearInterval(timer); for (const n of [...nodes.values()]) dropNode(n, 1001); },
  };
}
