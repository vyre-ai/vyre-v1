// The sample behind the agent page tests and screenshots: Northwind's Intake (working on its computer, Omar Haddad as the signed-in owner), the same page seen by a person who
// may not change it, Intake paused, Intake with a broken agent.toml, and the Personal Space assistant. It builds on the Chats right pane's sample (same agent, chats, facts, files,
// routines and computer) and adds what the page reads on top: the summary, the suggestions, the config, and the writes the page makes. Every control works against the replica.
import { createScreenHooks } from "../../../../../../client/src/index.ts";
import type { Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import { SAMPLE_NOW, createSample as createPaneSample } from "../rightpane/sample.ts";
import type { AgentPageData, AgentPageNav } from "./data.tsx";
import type { AgentRow, Config, Summary, Suggestion } from "./model.ts";

export { SAMPLE_NOW };
export type Variant = "owner" | "viewer" | "paused" | "broken" | "personal";

export const NAMES: Record<string, string> = { usr_omar: "Omar Haddad", usr_maya: "Maya Chen", usr_irfad: "Irfad", agt_intake: "Intake", agt_assistant: "Assistant" };
const at = (m: number, d: number, h: number, min = 0): number => Date.UTC(2025, m - 1, d, h, min, 0);

export interface Sample {
  data: AgentPageData;
  replica: ReturnType<typeof createPaneSample>["replica"];
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open, as "kind:id" */
  opened: string[];
  setOnline(online: boolean): void;
  failNext(cap: string): void;
}

export function createSample(variant: Variant = "owner", o: { online?: boolean } = {}): Sample {
  const personal = variant === "personal";
  const base = createPaneSample(personal ? "personal" : "northwind", o);
  const { replica, calls, opened } = base;
  const agentId = base.data.agent.agentId;
  const failing = new Set<string>();
  const rows = <T,>(table: string): T[] => replica.rows(table) as unknown as T[];
  const strip = <T extends object>(x: T): T => { const c = { ...x } as Record<string, unknown>; delete c.id; return c as T; };

  /* ----- the agent row: the pane sample's, with the settings the page shows */
  const current = rows<AgentRow & Row>("agents").find((a) => a.agentId === agentId)!;
  const versions: Record<string, string> = {};
  const putAgent = (p: Partial<AgentRow>): AgentRow => { const next = { ...current, ...rows<AgentRow & Row>("agents").find((a) => a.agentId === agentId)!, ...p } as AgentRow & Row; replica.put("agents", [next]); return strip(next); };
  putAgent(personal
    ? { model: "sonnet", captureMode: "propose" }
    : {
      model: "opus", fallbackModel: "sonnet", toolsAllowed: ["calendar.read", "calendar.book", "crm.read", "crm.write", "email.draft", "knowledge.read"], vaultKeys: ["#CRM_API", "#CALENDAR_BOOKING"],
      limits: { dayCostMicros: 5_000_000, turnsPerDay: 150, minutesPerRun: 24 },
      ...(variant === "paused" ? { status: "paused" as const, pausedBy: "usr_maya", pausedReason: "Waiting for the new retainer terms" } : {}),
    });

  /* ----- what the page reads on top of the pane's rows */
  const summary: Summary = personal
    ? { chatsThisWeek: 2, openTasks: 1, runsToday: 0, spendTodayMicros: 0, memoryFacts: 0, proposedFacts: 0, workingOn: [], linked: [], watches: [] }
    : {
      chatsThisWeek: 3, openTasks: 4, runsToday: 6, spendTodayMicros: 420_000, spendLimitMicros: 5_000_000, memoryFacts: 4, proposedFacts: 3,
      workingOn: [{ kind: "record", id: "rec_acme", title: "Acme launch intake" }, { kind: "task", id: "tsk_dev", title: "Follow up with Dev Rao" }],
      linked: [{ kind: "project", id: "prj_acme", title: "Acme launch" }, { kind: "channel", id: "ch_intake", title: "#intake" }],
      watches: ["Web form inbox"],
    };
  replica.resolve("agents.summary", () => summary);
  const config: Config = {
    effective: { model: "opus" }, lines: { agentMd: 93, vyreMd: 41 },
    ...(variant === "broken" ? { error: { line: 12, message: "unknown key limits.on_limitt" }, lastGoodVersionId: "ver_good" } : {}),
  };
  replica.resolve("agents.config.get", () => config);
  const suggestions: Suggestion[] = personal ? [] : [
    { suggestionId: "sg1", agentId, kind: "agent_md", file: "AGENT.md", diff: "@@ ## You do not\n+ Offer Thursday morning times. Maya blocks them.", widening: false, state: "open", proposedBy: agentId, proposedAt: at(10, 24, 9, 34), reason: "Maya blocks Thursday mornings for client visits" },
    { suggestionId: "sg2", agentId, kind: "template", file: "agent.toml", diff: "@@ [limits]\n+ on_limit = \"stop\"", widening: true, state: "open", proposedBy: "usr_omar", proposedAt: at(10, 23, 11) },
  ];
  replica.put("suggestions", suggestions.map((s) => ({ id: s.suggestionId, ...s })));
  replica.resolve("agents.suggestions.list", () => ({ suggestions: rows<Suggestion & Row>("suggestions").map((s) => strip(s)) }));
  // The routines list in the pane sample has no owner filter; the page filters to the ones the signed-in person set.
  if (variant === "viewer") replica.put("routines", rows<{ id: string; ownerId: string }>("routines").map((r) => ({ ...r, ownerId: "usr_maya" })));

  /* ----- the writes the page makes */
  let seq = 0;
  const writes: Record<string, (input: any) => unknown> = {
    "agents.role_line.set": (i: { description: string }) => {
      const prev = current.role ?? "";
      const id = `ver_${++seq}`;
      versions[id] = prev;
      return { agent: putAgent({ role: i.description }), undoVersionId: id };
    },
    "agents.restore_version": (i: { versionId: string }) => ({ agent: putAgent({ role: versions[i.versionId] ?? "" }) }),
    "chat.start": (i: { agentIds: string[] }) => {
      const t = { threadId: `c_new${++seq}`, kind: "chat" as const, title: "New chat", listed: true, planMode: false, members: [{ kind: "person" as const, id: "usr_omar" }], agents: i.agentIds.map((a, n) => ({ agentId: a, mode: n === 0 ? ("lead" as const) : ("listen" as const) })), createdAt: SAMPLE_NOW };
      replica.put("threads", [{ id: t.threadId, ...t }]);
      return { thread: t };
    },
    "agents.pause": (i: { reason?: string }) => ({ agent: putAgent({ status: "paused", pausedBy: "usr_omar", ...(i.reason ? { pausedReason: i.reason } : {}) }) }),
    "agents.resume": () => {
      const { pausedBy: _by, pausedReason: _why, ...rest } = rows<AgentRow & Row>("agents").find((x) => x.agentId === agentId)!;
      const next = { ...rest, status: "awake" as const };
      replica.put("agents", [next]);
      return { agent: strip(next) };
    },
    "agents.suggestion.accept": (i: { suggestionId: string }) => setSuggestion(i.suggestionId, "accepted"),
    "agents.suggestion.dismiss": (i: { suggestionId: string }) => setSuggestion(i.suggestionId, "dismissed"),
    "agents.delete": () => ({ deleted: true }),
  };
  const setSuggestion = (id: string, state: Suggestion["state"]): unknown => {
    const cur = rows<Suggestion & Row>("suggestions").find((s) => s.suggestionId === id);
    if (!cur) throw new Error("no such suggestion");
    const next = { ...cur, state } as Suggestion & Row;
    replica.put("suggestions", [next]);
    return { suggestion: strip(next) };
  };

  const paneNav = base.data.nav;
  const nav: AgentPageNav = {
    ...paneNav,
    openChat: (id) => void opened.push(`chat:${id}`),
    openFolder: (id) => void opened.push(`folder:${id}`),
    openAgentFile: (_a, file) => void opened.push(`file:${file}`),
    openAutomationRuns: (id) => void opened.push(`runs:${id}`),
    closePage: () => void opened.push("close"),
    openSource: (kind, ref) => void opened.push(`source:${kind}:${ref}`),
  };
  const me = variant === "viewer" ? { id: "usr_irfad", name: "Irfad" } : { id: "usr_omar", name: "Omar Haddad" };
  const data: AgentPageData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      const w = writes[cap];
      if (!w) return base.data.call(cap, input);
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      return w(input);
    },
    connection: base.data.connection,
    agent: base.data.agent,
    me,
    nameOf: (id) => NAMES[id] ?? id,
    canEdit: variant !== "viewer",
    space: base.data.space,
    nav,
    clock: base.data.clock,
  };
  return {
    data, replica, calls, opened,
    setOnline: base.setOnline,
    failNext(cap) { if (cap in writes) failing.add(cap); else base.failNext(cap); },
  };
}
