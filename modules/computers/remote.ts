// A ComputerHost for a computer that lives on a node: every call becomes a job for that node (jobs.ts), and its answer comes back as the call's answer. The node runs the job on its own Docker with
// the same host the Space uses at home (nodeRun below is the one place a job is turned back into a call), so the two cannot drift.
// What is not here yet on a node (the live view, recordings) refuses plainly; the Space's own computers keep all of it.
import { awaitJob, enqueueJob } from "./jobs.ts";
import type { JobKind } from "./jobs.ts";
import { bindRemote, computerBy } from "./projections.ts";
import type { ComputerHost, Db, Probe, RecordResult, SessionInfo } from "./projections.ts";
import type { ToolHost } from "./handlers/tools/common.ts";

const NOT_YET = "That is not available on a computer that joined the Space yet.";
const bytesOut = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const bytesIn = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

export interface RemoteDeps { db: Db; now(): number; nodeId: string }

const TIMEOUT: Partial<Record<JobKind, number>> = { start: 150_000, create: 120_000, stop: 90_000, remove: 60_000, screenshot: 30_000 };

export function createRemoteHost(d: RemoteDeps): ComputerHost & ToolHost {
  async function run<T>(kind: JobKind, computerId: string, input: unknown, timeoutMs = TIMEOUT[kind] ?? 30_000): Promise<T> {
    const agentId = computerBy(d.db, computerId)?.agentId;
    if (!agentId) throw new Error("There is no such agent computer.");
    const jobId = enqueueJob(d.db, { nodeId: d.nodeId, computerId, agentId, kind, input, timeoutMs, now: d.now() });
    return (await awaitJob(d.db, jobId, { now: d.now, timeoutMs })) as T;
  }
  const refuse = async (): Promise<never> => { throw new Error(NOT_YET); };
  return {
    kind: "server",
    create: (a) => run<{ diskBytes?: number }>("create", a.computerId, a),
    start: async (a) => { await run("start", a.computerId, a); },
    stop: (a) => run<{ sessions?: SessionInfo[]; diskBytes?: number }>("stop", a.computerId, a),
    remove: async (computerId) => { await run("remove", computerId, { computerId }); },
    probe: (computerId) => run<Probe>("probe", computerId, { computerId }, 20_000),
    configure: async (a) => { await run("configure", a.computerId, a); },
    takeover: async (a) => { await run("takeover", a.computerId, a); },
    giveBack: async (computerId) => { await run("giveBack", computerId, { computerId }); },
    async screenshot(computerId) {
      const r = await run<{ png: string; width: number; height: number }>("screenshot", computerId, { computerId });
      return { bytes: bytesIn(r.png), width: r.width, height: r.height };
    },
    stream: refuse as ComputerHost["stream"],
    record: refuse as unknown as (a: { computerId: string; recordingId: string; action: "start" | "stop" }) => Promise<RecordResult>,
    saveRecording: refuse as ComputerHost["saveRecording"],
    removeRecording: refuse as ComputerHost["removeRecording"],
    sessions: async (computerId) => (await run<{ sessions?: SessionInfo[] }>("sessions", computerId, { computerId })).sessions ?? [],
    async signOut(a) { return (await run<{ ok?: boolean }>("signOut", a.computerId, a)).ok === true; },
    async health() { return { ok: true }; },
    tool: (a) => run("tool", a.computerId, a, a.timeoutMs + 20_000),
  };
}

/** The node's half: turn a job back into the call on the node's own host, and the answer into JSON. The node loads this through the module's host seam, so it never imports the module. */
export async function nodeRun(host: ComputerHost & Partial<ToolHost>, kind: string, input: unknown): Promise<unknown> {
  const a = (input ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (kind) {
    case "create": return host.create(a as never);
    case "start": await host.start(a as never); return {};
    case "stop": return host.stop(a as never);
    case "remove": await host.remove(String(a["computerId"])); return {};
    case "probe": return host.probe(String(a["computerId"]));
    case "configure": await host.configure(a as never); return {};
    case "takeover": await host.takeover(a as never); return {};
    case "giveBack": await host.giveBack(String(a["computerId"])); return {};
    case "screenshot": { const s = await host.screenshot(String(a["computerId"])); return { png: bytesOut(s.bytes), width: s.width, height: s.height }; }
    case "sessions": return { sessions: await host.sessions(String(a["computerId"])) };
    case "signOut": return { ok: await host.signOut(a as never) };
    case "tool": if (typeof host.tool !== "function") throw new Error("This computer cannot run tools."); return host.tool(a as never);
    default: throw new Error(`This computer does not do "${kind}".`);
  }
}

bindRemote((db, now, nodeId) => createRemoteHost({ db, now, nodeId }));
