// The sample Spaces behind the memory tests and screenshots: Northwind (a firm: a Rivera engagement, a Pruitt estate plan, people, decisions, a booking site; the Intake, Docs and Billing agents) and
// Harbor Studio (a small agency), with facts proposed and facts already current. A fake replica holds the tables; every capability the screens read has a resolver that honours its inputs (scope,
// agent, time, layers, status), and the writes (accept, reject, save layout, export) change the rows the way the real ones do. A personal-layer note is in the data so a test can show it is never drawn.
import { createFakeReplica, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row, Tables } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { LiveCap, MemoryData } from "./data.tsx";
import type { Fact, GNode, GEdge, NoteRow } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const DAY = 86_400_000, HOUR = 3_600_000;

export type Variant = "northwind" | "harbor";
interface SNode extends GNode { born: number; agents: string[] }
export interface SampleSpace { id: Variant; name: string; agents: { id: string; name: string }[]; nodes: SNode[]; edges: GEdge[]; facts: Fact[]; notes: NoteRow[]; people: Record<string, string> }

const n = (nodeId: string, kind: GNode["kind"], title: string, layer: GNode["layer"], cluster: string, daysAgo: number, agents: string[] = []): SNode => ({ nodeId, kind, title, layer, cluster, born: SAMPLE_NOW - daysAgo * DAY, agents });
const e = (from: string, to: string, kind: GEdge["kind"] = "link"): GEdge => ({ from, to, kind });
const fact = (factId: string, layer: Fact["layer"], text: string, status: Fact["status"], hoursAgo: number, o: Partial<Fact> = {}): Fact => ({
  factId, layer, ownerRef: "usr_maya", agentId: "agt_intake", text, validFrom: SAMPLE_NOW - hoursAgo * HOUR, learnedAt: SAMPLE_NOW - hoursAgo * HOUR, sourceKind: "chat", sourceRef: `cht_${factId}`, sourceLink: `/chats/cht_${factId}`, status, ...o,
});

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind",
  agents: [{ id: "agt_intake", name: "Intake" }, { id: "agt_docs", name: "Docs" }, { id: "agt_billing", name: "Billing" }],
  nodes: [
    n("vyre", "note", "VYRE.md", "space", "Firm", 29), n("fees", "note", "Fee schedule", "space", "Firm", 24), n("script", "note", "Intake script", "agent", "Firm", 20, ["agt_intake"]),
    n("hours", "decision", "Weekend intake hours", "agent", "Firm", 12, ["agt_intake"]), n("flat", "decision", "Flat fee for simple wills", "space", "Firm", 9),
    n("elena", "client", "Elena Rivera", "project", "Rivera engagement", 21, ["agt_intake", "agt_docs"]), n("rivera", "project", "Rivera engagement", "project", "Rivera engagement", 21, ["agt_intake", "agt_docs"]),
    n("consult", "record", "Consult · Elena Rivera", "project", "Rivera engagement", 14, ["agt_intake"]), n("letter", "note", "Engagement letter", "project", "Rivera engagement", 8, ["agt_docs"]),
    n("prep", "chat", "Consult prep chat", "project", "Rivera engagement", 6, ["agt_intake"]), n("inv", "record", "INV-1042", "project", "Rivera engagement", 4, ["agt_billing"]),
    n("marcus", "client", "Marcus Pruitt", "project", "Pruitt estate plan", 18, ["agt_docs"]), n("pruitt", "project", "Pruitt estate plan", "project", "Pruitt estate plan", 18, ["agt_docs"]),
    n("trust", "note", "Trust template", "project", "Pruitt estate plan", 10, ["agt_docs"]), n("maya", "person", "Maya Chen", "space", "Firm", 29), n("omar", "person", "Omar Haddad", "space", "Firm", 27),
    n("widget", "site", "Booking widget", "space", "Firm", 16, ["agt_intake"]), n("private", "note", "Maya's private notes", "person", "Firm", 5, ["agt_intake"]),
  ],
  edges: [
    e("vyre", "fees"), e("vyre", "script"), e("vyre", "maya"), e("vyre", "omar"), e("fees", "flat"), e("script", "hours"), e("script", "widget"), e("hours", "widget", "relation"),
    e("elena", "rivera", "relation"), e("rivera", "consult", "relation"), e("rivera", "letter"), e("consult", "prep", "came_from"), e("letter", "inv", "relation"), e("rivera", "maya", "relation"), e("elena", "prep", "came_from"),
    e("marcus", "pruitt", "relation"), e("pruitt", "trust"), e("pruitt", "omar", "relation"), e("trust", "fees"), e("flat", "trust", "came_from"), e("private", "maya", "link"), e("letter", "fees"),
  ],
  facts: [
    fact("f1", "project", "Elena Rivera prefers email over phone calls", "proposed", 3, { sourceKind: "channel", sourceRef: "ch_rivera", sourceLink: "/chats/ch_rivera", agentId: "agt_docs" }),
    fact("f2", "project", "The Rivera engagement letter goes out once the retainer clears", "proposed", 26, { sourceKind: "run", sourceRef: "run_intake_91", sourceLink: "/automations/run_intake_91" }),
    fact("f3", "space", "A flat fee for a simple will is $1,200", "proposed", 52, { ownerRef: "usr_omar", sourceKind: "chat", agentId: "agt_billing" }),
    fact("f4", "agent", "Intake books consults on Tuesdays and Thursdays", "proposed", 70, { lowRisk: true }),
    fact("f5", "person", "Prefers summaries under five lines", "proposed", 5),
    fact("f6", "project", "Rivera engagement is a will and a power of attorney", "current", 200, { agentId: "agt_docs", sourceKind: "record", sourceRef: "rec_rivera", sourceLink: "/records/rec_rivera" }),
    fact("f7", "space", "Retainers are due before work starts", "current", 400, { ownerRef: "usr_omar" }),
  ],
  notes: [
    { noteId: "nt_p1", path: "memory/proposed/rivera-contact.md", title: "Rivera contact preferences", layer: "project", agentId: "agt_intake", updatedAt: SAMPLE_NOW - 2 * HOUR },
    { noteId: "nt_p2", path: "memory/proposed/weekend-hours.md", title: "Weekend hours", layer: "agent", agentId: "agt_intake", updatedAt: SAMPLE_NOW - 30 * HOUR },
  ],
  people: { usr_maya: "Maya Chen", usr_omar: "Omar Haddad", usr_irfad: "Irfad Imtiaz" },
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio",
  agents: [{ id: "agt_scout", name: "Scout" }, { id: "agt_brief", name: "Brief" }],
  nodes: [
    n("hv", "note", "VYRE.md", "space", "Studio", 20), n("brand", "note", "Brand voice", "space", "Studio", 14), n("ines", "person", "Ines Costa", "space", "Studio", 20), n("launch", "project", "Spring launch", "project", "Spring launch", 10),
    n("deck", "note", "Launch deck", "project", "Spring launch", 6), n("kickoff", "chat", "Kickoff chat", "project", "Spring launch", 5),
  ],
  edges: [e("hv", "brand"), e("hv", "ines"), e("brand", "launch"), e("launch", "deck"), e("deck", "kickoff", "came_from"), e("launch", "ines", "relation")],
  facts: [fact("h1", "project", "The launch date is the 14th", "proposed", 6, { agentId: "agt_scout", ownerRef: "usr_ines" }), fact("h2", "space", "Invoices go out on the last Friday", "proposed", 30, { agentId: "agt_scout", ownerRef: "usr_ines" })],
  notes: [],
  people: { usr_ines: "Ines Costa", usr_irfad: "Irfad Imtiaz" },
};

// ---------------------------------------------------------------- the replica

type Cap<C extends keyof CapMap> = CapMap[C];

export interface SampleMemory {
  data: MemoryData;
  replica: FakeReplica;
  /** every capability the screens called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
}

/** The fact rows without the table key the fake replica adds. */
function factsOf(t: Tables): Fact[] {
  const out: Fact[] = [];
  for (const r of t.get("facts")?.values() ?? []) { const { id: _id, ...rest } = r as unknown as Fact & { id: string }; out.push(rest as Fact); }
  return out;
}

export function createSampleMemory(space: SampleSpace = northwind, o: { fail?: string; now?: number } = {}): SampleMemory {
  const replica = createFakeReplica(space.id);
  const calls: SampleMemory["calls"] = [];
  const opened: string[] = [];
  replica.put("facts", space.facts.map((f) => ({ ...f, id: f.factId }) as unknown as Row));
  replica.put("nodes", space.nodes.map((x) => ({ ...x, id: x.nodeId }) as unknown as Row));
  replica.put("notes", space.notes.map((x) => ({ ...x, id: x.noteId }) as unknown as Row));
  replica.put("layout", [{ id: "agent", positions: {} }, { id: "space", positions: {} }] as unknown as Row[]);
  replica.put("exports", []);

  replica.resolve("memory.graph", (t, i: Cap<"memory.graph">["in"]) => {
    const all = [...(t.get("nodes")?.values() ?? [])] as unknown as SNode[];
    const nodes = all.filter((x) => (i.asOf === undefined || x.born <= i.asOf) && (i.scope === "space" || !i.agentId || x.agents.length === 0 || x.agents.includes(i.agentId)) && (!i.kinds || i.kinds.length === 0 || i.kinds.includes(x.kind)));
    const ids = new Set(nodes.map((x) => x.nodeId));
    const edges = space.edges.filter((x) => ids.has(x.from) && ids.has(x.to));
    const degree = new Map<string, number>();
    for (const x of edges) { degree.set(x.from, (degree.get(x.from) ?? 0) + 1); degree.set(x.to, (degree.get(x.to) ?? 0) + 1); }
    const by = new Map<string, SNode[]>();
    for (const x of nodes) by.set(x.cluster ?? "", [...(by.get(x.cluster ?? "") ?? []), x]);
    const clusters = [...by].map(([name, list]) => ({ name, hub: list.slice().sort((a, b) => (degree.get(b.nodeId) ?? 0) - (degree.get(a.nodeId) ?? 0))[0]!.nodeId, size: list.length })).sort((a, b) => b.size - a.size);
    return {
      nodes: nodes.map((x) => ({ nodeId: x.nodeId, kind: x.kind, title: x.title, ...(x.layer ? { layer: x.layer } : {}), ...(x.cluster ? { cluster: x.cluster } : {}) })), edges, clusters,
    };
  });
  replica.resolve("memory.layout.get", (t, i: Cap<"memory.layout.get">["in"]) => ({ positions: ((t.get("layout")?.get(i.scope) as unknown as { positions: Record<string, { x: number; y: number }> } | undefined)?.positions) ?? {} }));
  replica.resolve("memory.facts.list", (t, i: Cap<"memory.facts.list">["in"]) => {
    const list = factsOf(t).filter((f) => (!i.status || i.status.includes(f.status)) && (!i.layer || f.layer === i.layer) && (!i.agentId || f.agentId === undefined || f.agentId === i.agentId || f.layer === "space" || f.layer === "project"));
    return { facts: list, total: list.length };
  });
  replica.resolve("memory.notes.list", (t, i: Cap<"memory.notes.list">["in"]) => {
    const list = [...(t.get("notes")?.values() ?? [])] as unknown as NoteRow[];
    const out = list.filter((x) => (!i.agentId || x.agentId === i.agentId) && (!i.area || x.path.includes(`/${i.area}/`)));
    return { notes: out, total: out.length };
  });

  const setStatus = (id: string, status: Fact["status"], extra: Partial<Fact> = {}): Fact => {
    const cur = (replica.rows("facts") as unknown as Fact[]).find((f) => f.factId === id);
    if (!cur) throw new Error("fact not found");
    if (cur.status !== "proposed") throw new Error("Only a proposed fact can be decided.");
    const next = { ...cur, status, ...extra, id } as unknown as Row;
    replica.put("facts", [next]);
    const { id: _drop, ...fact } = next as unknown as Fact & { id: string };
    return fact as Fact;
  };
  const writes: Record<string, (i: never) => unknown> = {
    "memory.fact.accept": (i: { factId: string }) => ({ fact: setStatus(i.factId, "current") }),
    "memory.fact.reject": (i: { factId: string }) => ({ fact: setStatus(i.factId, "removed", { closedAt: o.now ?? SAMPLE_NOW }) }),
    "memory.layout.save": (i: { scope: string; positions: Record<string, { x: number; y: number }> }) => { replica.put("layout", [{ id: i.scope, positions: i.positions }] as unknown as Row[]); return { ok: true }; },
    "memory.graph_export": (_i: unknown) => { const id = `fil_export_${replica.rows("exports").length + 1}`; replica.put("exports", [{ id }] as unknown as Row[]); return { fileId: id }; },
  };
  const data: MemoryData = {
    live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> { return liveQuery(replica, cap, input); },
    async call(cap, input) {
      calls.push({ cap, input });
      if (o.fail) throw new Error(o.fail);
      const w = writes[cap];
      if (!w) throw new Error(`unknown capability ${cap}`);
      return w(input as never);
    },
    now: () => o.now ?? SAMPLE_NOW, agents: space.agents, nameOf: (id) => space.people[id] ?? id,
    nav: { openNote: (id) => void opened.push(`note:${id}`), openSource: (link) => void opened.push(`source:${link}`) },
  };
  return { data, replica, calls, opened };
}
