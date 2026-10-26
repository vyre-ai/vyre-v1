// The sample Space behind the mounted Chats place's tests and screenshots: one runtime (the same shape the shell builds for a real Space) whose screens and writes are answered by the
// samples the parts were built against (sidebar, conversation, agent page, Needs you, computer popup, helper) and by one more fake replica for what this folder adds: terminals with
// their output and stars, the terminal rules, the agent computers, a channel to connect an outside agent to, a stopped recording, and a wait that holds a thread. Every write changes
// those rows, so each control in a mount really works; the real replica is SQLite behind the same surface. Nothing here is used by the app.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Principal } from "../../home/sections-a/data.tsx";
import type { ShellRuntime, ShellTarget } from "../../../shell/providers/runtime.tsx";
import { createSample as createAgent } from "../agentpage/sample.ts";
import { createSample as createComputer } from "../computer/sample.ts";
import { createSample as createConversation } from "../conversation/sample.ts";
import type { Variant as ConversationVariant } from "../conversation/sample.ts";
import { createSample as createHelper } from "../helper/sample.ts";
import { createSample as createNeeds } from "../needsyou/sample.ts";
import { createSampleSidebar } from "../sidebar/sample.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const at = (h: number, m: number, s = 0): number => Date.UTC(2025, 9, 24, h, m, s);

export const COMPUTER = "cmp_intake";
export const TERMINAL = "trm_rivera";
export const SERVER_TERMINAL = "trm_server";
export const CHANNEL = "chn_rivera";
export const RECORDING = "rec_1";
export const HELPER = "h1";

export const PEOPLE: Principal[] = [
  { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "usr_omar", name: "Omar Haddad", kind: "person" }, { id: "usr_maya", name: "Maya Chen", kind: "person" },
  { id: "agt_intake", name: "Intake", kind: "agent" }, { id: "agt_docs", name: "Docs", kind: "agent" }, { id: "agt_billing", name: "Billing", kind: "agent" },
  { id: "agt_research", name: "Research", kind: "agent" }, { id: "agt_scout", name: "Scout", kind: "agent" }, { id: "agt_assistant", name: "Assistant", kind: "agent" },
];

type Terminal = CapMap["terminal.get"]["out"]["terminal"];
type Rules = CapMap["terminal.rules.get"]["out"]["rules"];
type Run = CapMap["runs.list"]["out"]["runs"][number];
type Thread = CapMap["threads.get"]["out"]["thread"];

const term = (terminalId: string, name: string, host: Terminal["host"], hostTitle: string, o: Partial<Terminal> = {}): Terminal => ({
  terminalId, name, host, hostTitle, ...(host === "agent_computer" ? { agentId: "agt_intake", computerId: COMPUTER } : {}), cwd: "~/rivera", state: "running", exitCode: null, named: true, cols: 100, rows: 30,
  createdAt: at(9, 10), lastActiveAt: at(9, 58), ...o,
});

const SCREEN = "\x1b[32m$\x1b[0m npm run dev\r\n\r\n  \x1b[1mVITE\x1b[0m v5.4.8  ready in \x1b[1m312\x1b[0m ms\r\n\r\n  \x1b[32m➜\x1b[0m  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m\r\n  \x1b[2m➜  press h + enter to show help\x1b[0m\r\n\r\n\x1b[32m$\x1b[0m git status\r\nOn branch main\r\nnothing to commit, working tree clean\r\n\x1b[32m$\x1b[0m ";

export type Who = "member" | "owner";

export interface MountSample {
  rt: ShellRuntime;
  /** every capability called through the runtime, in order */
  calls: { cap: string; input: unknown }[];
  /** what the runtime was asked to open elsewhere */
  opened: ShellTarget[];
  /** every key sent to a terminal through terminal.input */
  typed: string[];
  /** the replica of the screens this folder adds */
  setOnline(online: boolean): void;
  /** make the next call to `cap` fail */
  failNext(cap: string): void;
  /** the next terminal.open_server is refused: the signed-in person has no server.services */
  refuseServer(on: boolean): void;
  /** text a terminal prints, as the host would send it */
  print(terminalId: string, text: string): void;
  /** put a wait on the open chat's thread, as the engine does when an agent waits on background work */
  startWait(label: string): void;
}

export function createMountSample(o: { conversation?: ConversationVariant; who?: Who; online?: boolean } = {}): MountSample {
  const who = o.who ?? "member";
  const side = createSampleSidebar(undefined, o.online === undefined ? {} : { online: o.online });
  const conv = createConversation(o.conversation ?? "busy", o.online === undefined ? {} : { online: o.online });
  const agent = createAgent("owner", o.online === undefined ? {} : { online: o.online });
  const needs = createNeeds("northwind", o.online === undefined ? {} : { online: o.online });
  const comp = createComputer("working", o.online === undefined ? {} : { online: o.online });
  const help = createHelper("done", o.online === undefined ? {} : { online: o.online });

  const replica = createFakeReplica("northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const opened: ShellTarget[] = [];
  const typed: string[] = [];
  const failing = new Set<string>();
  const buffers = new Map<string, string>([[TERMINAL, SCREEN], [SERVER_TERMINAL, "\x1b[32mroot@northwind\x1b[0m:~# "]]);
  let refused = false;
  let seq = 0;

  replica.put("terminals", [
    { id: TERMINAL, ...term(TERMINAL, "Rivera dev server", "agent_computer", "Intake's computer") },
    { id: SERVER_TERMINAL, ...term(SERVER_TERMINAL, "Space server", "space_server", "Space server", { cwd: "/srv/vyre", createdAt: at(8, 30), lastActiveAt: at(9, 20), state: "idle" }) },
    { id: "trm_old", ...term("trm_old", "Invoice export", "device", "irfad-macbook", { state: "exited", exitCode: 0, lastActiveAt: at(7, 45), createdAt: at(7, 40) }) },
  ]);
  replica.put("stars", [{ id: TERMINAL, resource: { type: "terminal", id: TERMINAL }, title: "Rivera dev server", at: at(9, 15) }]);
  replica.put("rules", [{ id: "mine", allow: ["git status", "git diff", "ls"], ask: ["git push", "npm install"], deny: ["rm -rf", "sudo"], folders: ["fld_rivera", "fld_work"] }]);
  replica.put("computers", [{ id: COMPUTER, computerId: COMPUTER, agentId: "agt_intake", state: "working", caption: "Looking up Elena Rivera", tabs: 2, tabLimit: 10, host: "server", recording: false, lastActiveAt: at(9, 59) }]);
  replica.put("channels", [{
    id: CHANNEL, channelId: CHANNEL, mainThreadId: "t_rivera", name: "rivera-matter", topic: "Everything for the Rivera matter", visibility: "invite", archived: false,
    members: [{ kind: "person", id: "usr_irfad" }, { kind: "person", id: "usr_maya" }], agents: [{ agentId: "agt_intake", mode: "lead" }], unread: 0, createdAt: at(8, 0),
  }]);
  replica.put("recordings", [{
    id: RECORDING, recordingId: RECORDING, computerId: COMPUTER, agentId: "agt_intake", startedAt: SAMPLE_NOW - 23_000, endedAt: SAMPLE_NOW, durationMs: 23_000,
    folderPath: "Agents/Intake/work/recordings/2025-10-24-1000", state: "saved", intents: [],
  }]);
  replica.put("runs", []);

  const rows = <T>(table: string): T[] => (replica.rows(table) as unknown as (T & { id: string })[]).map(({ id: _id, ...rest }) => rest as unknown as T);
  /** Rows whose own `id` is the table key (runs): kept whole. */
  const whole = <T>(table: string): T[] => replica.rows(table) as unknown as T[];

  replica.resolve("terminal.get", (_t, i) => { const t = rows<Terminal>("terminals").find((x) => x.terminalId === i.terminalId); if (!t) throw new Error("no such terminal"); return { terminal: t }; });
  replica.resolve("terminal.list", (_t, i) => {
    const all = rows<Terminal>("terminals").filter((t) => (i.host === undefined || t.host === i.host) && (i.state === undefined || i.state.includes(t.state)));
    return { terminals: all, total: all.length };
  });
  replica.resolve("stars.list", () => ({ stars: rows<CapMap["stars.list"]["out"]["stars"][number]>("stars") }));
  replica.resolve("terminal.rules.get", () => ({ rules: rows<Rules>("rules")[0] ?? { allow: [], ask: [], deny: [], folders: [] } }));
  replica.resolve("computers.list", () => ({ computers: rows<CapMap["computers.list"]["out"]["computers"][number]>("computers") }));
  replica.resolve("channels.get", (_t, i) => { const c = rows<CapMap["channels.get"]["out"]["channel"]>("channels").find((x) => x.channelId === i.channelId); if (!c) throw new Error("no such channel"); return { channel: c }; });
  replica.resolve("computers.recording.get", (_t, i) => {
    const r = rows<CapMap["computers.recording.get"]["out"]["recording"]>("recordings").find((x) => x.recordingId === i.recordingId);
    if (!r) throw new Error("no such recording");
    return { recording: r, eventsPath: `${r.folderPath}/events.json`, harPath: `${r.folderPath}/network.har`, videoPath: `${r.folderPath}/screen.webm` };
  });
  replica.resolve("runs.list", (_t, i) => {
    const list = whole<Run>("runs").filter((r) => (i.statuses === undefined || i.statuses.includes(r.status)) && (i.subject === undefined || (r.subject?.type === i.subject.type && r.subject.id === i.subject.id)));
    return { runs: list, total: list.length };
  });

  const threadFor = (threadId: string): Thread => ({
    threadId, kind: /^h\d/.test(threadId) ? "helper" : "chat", title: threadId, listed: true, planMode: false, members: [{ kind: "person", id: "usr_irfad" }],
    agents: [{ agentId: "agt_intake", mode: "lead" }], createdAt: at(9, 0),
  });
  const bufferOf = (id: string): string => buffers.get(id) ?? "";
  const mk = (host: Terminal["host"], input: { agentId?: string; computerId?: string; name?: string }): { terminal: Terminal } => {
    const id = `trm_new${++seq}`;
    const t = term(id, input.name ?? (host === "space_server" ? "Space server" : host === "device" ? "This computer" : "Intake's computer"), host, host === "space_server" ? "Space server" : host === "device" ? "irfad-macbook" : "Intake's computer", {
      ...(host === "agent_computer" ? { agentId: input.agentId ?? "agt_intake", computerId: input.computerId ?? COMPUTER } : {}), createdAt: SAMPLE_NOW, lastActiveAt: SAMPLE_NOW, named: false,
    });
    replica.put("terminals", [{ id, ...t }]);
    buffers.set(id, "\x1b[32m$\x1b[0m ");
    return { terminal: t };
  };
  const refusal = (): Error => Object.assign(new Error("The Space server's shell needs server.services."), { code: "permission.role_lacks_permission" });

  const writes: Record<string, (input: any) => unknown> = {
    "threads.get": (i: { threadId: string }) => ({ thread: threadFor(i.threadId) }),
    "threads.list": () => ({ threads: [] }),
    "computers.list": () => replica.run("computers.list", {})?.data,
    "terminal.list": (i: CapMap["terminal.list"]["in"]) => replica.run("terminal.list", i)?.data,
    "terminal.open": (i: CapMap["terminal.open"]["in"]) => mk(i.host === "device" ? "device" : "agent_computer", i),
    "terminal.open_server": (i: CapMap["terminal.open_server"]["in"]) => { if (refused) throw refusal(); return mk("space_server", i); },
    "terminal.attach": (i: { terminalId: string }) => {
      if (i.terminalId === SERVER_TERMINAL && refused) throw refusal();
      return { ticket: `tk_${++seq}`, expiresAt: SAMPLE_NOW + 60_000, replay: bufferOf(i.terminalId) };
    },
    "terminal.read": (i: { terminalId: string; lines?: number; since?: number }) => {
      const buf = bufferOf(i.terminalId);
      return i.since === undefined ? { text: i.lines === 1 ? buf.split("\n").pop() ?? "" : buf, next: buf.length } : { text: buf.slice(i.since), next: buf.length };
    },
    "terminal.input": (i: { terminalId: string; data: string }) => { typed.push(i.data); return { ok: true }; },
    "terminal.resize": () => ({ ok: true }),
    "terminal.interrupt": () => ({ ok: true }),
    "terminal.close": (i: { terminalId: string }) => { replica.remove("terminals", [i.terminalId]); return { closed: true }; },
    "terminal.rename": (i: { terminalId: string; name: string }) => {
      const cur = rows<Terminal>("terminals").find((x) => x.terminalId === i.terminalId);
      if (!cur) throw new Error("no such terminal");
      const next = { ...cur, name: i.name, named: true };
      replica.put("terminals", [{ id: i.terminalId, ...next }]);
      return { terminal: next };
    },
    "terminal.rules.set": (i: { rules: Rules }) => {
      const r = { allow: i.rules.allow.filter((e) => !i.rules.deny.includes(e) && !i.rules.ask.includes(e)), ask: i.rules.ask.filter((e) => !i.rules.deny.includes(e)), deny: i.rules.deny, folders: i.rules.folders };
      replica.put("rules", [{ id: "mine", ...r }]);
      return { rules: r };
    },
    "stars.toggle": (i: { resource: { type: string; id: string }; on: boolean }) => {
      if (i.resource.type !== "terminal") throw new Error("no write for stars.toggle");
      if (i.on) replica.put("stars", [{ id: i.resource.id, resource: i.resource, title: i.resource.id, at: SAMPLE_NOW }]);
      else replica.remove("stars", [i.resource.id]);
      return { starred: i.on, following: false };
    },
    "access.request": () => ({ requested: true }),
    "channels.connect_outside_agent": (i: { channelId: string; name: string }) => {
      const url = "https://northwind.vyre.run/mcp";
      const token = "vyre_ot_k3m9q7xw2dtp5ncfr8h4vbae";
      const tool = /codex/i.test(i.name) ? "codex" : "claude";
      return { mcpUrl: url, oneTimeToken: token, expiresAt: SAMPLE_NOW + 10 * 60_000, runCommand: `${tool} mcp add vyre ${url} --token ${token}` };
    },
    "runs.stop": (i: { runId: string }) => {
      const cur = whole<Run>("runs").find((r) => r.id === i.runId);
      if (cur) replica.put("runs", [{ ...cur, id: cur.id, status: "stopped" }]);
      return { run: cur };
    },
  };
  const others = [conv.data.call, needs.data.call, agent.data.call, comp.data.call, help.data.call, side.data.call];

  const hooks: Record<string, ScreenHooks> = {};
  const own = createScreenHooks(replica, screensById);
  for (const id of ["chats.sidebar", "chats.all-agents"]) hooks[id] = side.data.screens;
  hooks["chats.conversation"] = conv.data.screens;
  for (const id of ["chats.agent-page", "chats.agent-memory", "chats.right-pane"]) hooks[id] = agent.data.screens;
  hooks["chats.agent-computer"] = agent.data.screens;
  hooks["tasks.needs-you"] = needs.data.screens;
  hooks["chats.computer-popup"] = comp.data.screens;
  hooks["chats.helper-chat"] = help.data.screens;
  const screens: ScreenHooks = { query: (id, name, state) => (hooks[id] ?? own).query(id, name, state) };

  const everyone: QueryState<Principal[]> = { status: "ready", data: PEOPLE };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => everyone };
  const me = who === "owner" ? PEOPLE[1]! : PEOPLE[0]!;
  const rt: ShellRuntime = {
    screens,
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      const chain = w ? [async () => w(input), ...others.map((c) => () => c(cap, input))] : others.map((c) => () => c(cap, input));
      let last: unknown = new Error(`no write for ${cap}`);
      for (const c of chain) {
        try { return await c(); } catch (e) { last = e; if (!/no write for/.test(String((e as { message?: unknown }).message))) throw e; }
      }
      throw last;
    },
    connection: conv.data.connection, principals, recordTitle: () => undefined, me, clock: conv.data.clock,
    space: { id: "northwind", kind: "team", name: "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, calendarConnected: true,
    deferredModules: new Set<string>(), isDeferred: () => false, open: (t) => void opened.push(t), openUrl: () => undefined,
  };
  return {
    rt, calls, opened, typed,
    setOnline(v) { conv.setOnline(v); },
    failNext(cap) { failing.add(cap); },
    refuseServer(on) { refused = on; },
    print(id, text) { buffers.set(id, bufferOf(id) + text); },
    startWait(label) {
      const run: Run = { id: `run_wait${++seq}`, kind: "wait", name: label, owner: "agt_intake", startedBy: "agt_intake", subject: { type: "thread", id: "c1" }, status: "waiting", waitReason: "background", costMicros: 0, startedAt: SAMPLE_NOW - 60_000, traceId: "tr_wait", threadId: "c1" };
      replica.put("runs", [{ ...run, id: run.id }]);
    },
  };
}
