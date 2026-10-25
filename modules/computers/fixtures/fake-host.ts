// A scripted stand-in for the machine that runs agent computers: it keeps what a real host keeps (which containers exist and run, who has the controls, what is recording) in memory, records
// every call, and can be told to fail or to be busy. The Docker host is tested against a scripted Docker API instead (lifecycle.docker.test.ts) and against the real one (lifecycle.heavy.test.ts).
import type { ComputerHost, HostKind, Probe, RecordResult, SessionInfo } from "../projections.ts";

export interface FakeComputer {
  agentId: string; running: boolean; busy: boolean; caption?: string; tabs: number; tabLimit: number; takeoverBy?: string; recording?: string; sessions: SessionInfo[];
  saved: Array<{ recordingId: string; folderPath: string; events: string; har: string }>;
}

export interface FakeHostOptions {
  kind?: HostKind;
  /** Methods that throw (by name) while listed. */
  failing?: Set<string>;
  /** What stopping a recording returns. */
  recording?: RecordResult;
  /** Signed-in sites of a computer when it starts. */
  sessions?: SessionInfo[];
}

export function fakeHost(o: FakeHostOptions = {}) {
  const computers = new Map<string, FakeComputer>();
  const calls: Array<{ method: string; args: unknown }> = [];
  const failing = o.failing ?? new Set<string>();
  const removed: string[] = [];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  let recording: RecordResult = o.recording ?? { events: "", har: JSON.stringify({ log: { version: "1.2", entries: [] } }), durationMs: 240_000 };

  const log = (method: string, args: unknown): void => {
    calls.push({ method, args });
    if (failing.has(method)) throw new Error(`${method} failed on purpose`);
  };
  const need = (id: string): FakeComputer => {
    const c = computers.get(id);
    if (!c) throw new Error(`no such container ${id}`);
    return c;
  };

  const host: ComputerHost = {
    kind: o.kind ?? "server",
    async create(a) { log("create", a); computers.set(a.computerId, { agentId: a.agentId, running: false, busy: false, tabs: 0, tabLimit: a.tabLimit, sessions: o.sessions ? [...o.sessions] : [], saved: [] }); return { diskBytes: 1024 }; },
    async start(a) { log("start", a); const c = need(a.computerId); c.running = true; c.tabs = 1; c.tabLimit = a.tabLimit; },
    async stop(a) { log("stop", a); const c = need(a.computerId); c.running = false; c.tabs = 0; delete c.caption; c.busy = false; return { sessions: c.sessions, diskBytes: 2048 }; },
    async remove(id) { log("remove", id); need(id); computers.delete(id); removed.push(id); },
    async probe(id): Promise<Probe> {
      log("probe", id);
      const c = need(id);
      return { running: c.running, busy: c.busy, tabs: c.tabs, ...(c.caption !== undefined ? { caption: c.caption } : {}), lastFrameAt: 1_760_000_000_000, diskBytes: 4096 };
    },
    async configure(a) { log("configure", a); need(a.computerId).tabLimit = a.tabLimit ?? need(a.computerId).tabLimit; },
    async takeover(a) { log("takeover", a); const c = need(a.computerId); c.takeoverBy = a.personId; c.busy = false; },
    async giveBack(id) { log("giveBack", id); delete need(id).takeoverBy; },
    async screenshot(id) { log("screenshot", id); need(id); return { bytes: png, width: 1280, height: 800 }; },
    async stream(a) { log("stream", a); need(a.computerId); return { transport: "mjpeg", url: `/computers/${a.computerId}/stream?ticket=${a.ticket}` }; },
    async record(a) {
      log("record", a);
      const c = need(a.computerId);
      if (a.action === "start") { c.recording = a.recordingId; return {}; }
      delete c.recording;
      return recording;
    },
    async saveRecording(a) { log("saveRecording", { computerId: a.computerId, recordingId: a.recordingId }); need(a.computerId).saved.push({ recordingId: a.recordingId, folderPath: a.folderPath, events: a.events, har: a.har }); },
    async removeRecording(a) { log("removeRecording", a); const c = need(a.computerId); c.saved = c.saved.filter((s) => s.recordingId !== a.recordingId); },
    async sessions(id) { log("sessions", id); return [...need(id).sessions]; },
    async signOut(a) { log("signOut", a); const c = need(a.computerId); const had = c.sessions.some((s) => s.site === a.site); c.sessions = c.sessions.filter((s) => s.site !== a.site); return had; },
    async health() { log("health", null); return { ok: true, latencyMs: 3 }; },
  };

  return {
    host, computers, calls, removed, failing,
    named(method: string): Array<{ method: string; args: unknown }> { return calls.filter((c) => c.method === method); },
    /** The agent is in the middle of a task on this computer. */
    setBusy(id: string, busy: boolean, caption?: string): void { const c = need(id); c.busy = busy; if (caption !== undefined) c.caption = caption; else delete c.caption; },
    /** The container died without being asked. */
    crash(id: string): void { need(id).running = false; },
    setRecording(r: RecordResult): void { recording = r; },
  };
}

export type FakeHost = ReturnType<typeof fakeHost>;
