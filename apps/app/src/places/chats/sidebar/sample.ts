// The sample Spaces behind the Chats sidebar tests and screenshots: Northwind (the default Space) and Harbor Studio, filled from the prototype's Chats place so a side by side
// reads the same. A fake replica holds the rows; each capability the sidebar reads is registered with a resolver over those rows, and the writes it makes (chat.start, stars.toggle,
// threads.mark_read, tasks.act) change the rows, so every control in a mount really works. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { fixtureFor } from "../../../fixtures/index.ts";
import type { FixtureChannel } from "../../../fixtures/index.ts";
import type { Agent, Channel, NeedsItem, RecentItem, RecentOut } from "./model.ts";
import type { ChatsNav, ChatsSidebarData, Connection } from "./data.tsx";

/** Friday 24 October 2025, 10:00 (UTC, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const at = (m: number, d: number, h: number, min = 0): number => Date.UTC(2025, m - 1, d, h, min, 0);
const DAY = 86_400_000;

export interface SampleThread { threadId: string; title: string; agents: string[]; unread: number; working: boolean; starred: boolean; lastAt: number; preview?: string }
export interface SampleSpace {
  id: "northwind" | "harbor" | "personal";
  name: string;
  assistant: { agentId: string; name: string };
  otherNeedsYou: boolean;
  agents: { agentId: string; name: string; starred: boolean; working?: boolean }[];
  threads: SampleThread[];
  channels: { channelId: string; name: string; unread: number; visibility: "public" | "invite"; project?: boolean }[];
  needs: { taskId: string; title: string; kind: "approve" | "review" | "unblock"; by: string }[];
  needsTotal: number;
}

/**
 * The prototype's sidebar draws a project channel only when it is starred or followed (renderSide: c.project && (c.starred || c.followed)); spec 3.2 says the same. Its seed marks
 * pruitt-matter followed and atp-q4 not, so atp-q4 stays out of the list. The shared fixture carries the channel but not that flag, so the followed ids are kept here.
 */
export const FOLLOWED_PROJECTS: ReadonlySet<string> = new Set(["ch_pruitt"]);

function channelsOf(all: readonly FixtureChannel[], followed: ReadonlySet<string>): SampleSpace["channels"] {
  return all
    .filter((c) => c.project !== true || followed.has(c.id))
    .map((c) => ({ channelId: c.id.replace(/^ch_/, ""), name: c.name, unread: c.mentions ?? (c.unread === true ? 1 : 0), visibility: c.private === true ? ("invite" as const) : ("public" as const), ...(c.project === true ? { project: true } : {}) }));
}

const t = (threadId: string, title: string, agents: string[], lastAt: number, o: Partial<SampleThread> = {}): SampleThread =>
  ({ threadId, title, agents, unread: 0, working: false, starred: false, lastAt, ...o });

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind", assistant: { agentId: "agt_assistant", name: "Assistant" }, otherNeedsYou: true,
  // the faces are the pinned agents in the order the seed lists them (the assistant is the Vyre mark beside New chat, not a face)
  agents: fixtureFor("northwind").agents.map((a) => ({ agentId: a.id, name: a.name, starred: a.pinned, ...(a.id === "agt_intake" ? { working: true } : {}) })),
  threads: [
    t("c1", "Rivera intake", ["agt_intake"], at(10, 24, 9, 31), { working: true }),
    t("c3", "October invoices", ["agt_billing"], at(10, 24, 9, 12), { unread: 2 }),
    t("c4", "Rivera engagement letter", ["agt_docs"], at(10, 24, 8, 50), { unread: 1 }),
    t("d1", "Maya Chen", [], at(10, 24, 8, 40), { unread: 1 }),
    t("c6", "County records search", ["agt_scout"], at(10, 24, 8, 20)),
    t("c2", "Competitor pricing", ["agt_research"], at(10, 23, 16, 5), { starred: true }),
    t("d2", "Omar Haddad", [], at(10, 23, 11, 15)),
    t("c5", "Weekly lead report", ["agt_intake"], at(10, 20, 9, 0)),
    t("c7", "Plan the Q4 offsite", ["agt_assistant"], at(10, 20, 8, 30)),
  ],
  channels: channelsOf(fixtureFor("northwind").channels, FOLLOWED_PROJECTS),
  needs: [
    { taskId: "tsk_n1", title: "Send 12 invoices", kind: "approve", by: "agt_billing" },
    { taskId: "tsk_n2", title: "Rivera engagement letter", kind: "review", by: "agt_docs" },
    { taskId: "tsk_n3", title: "County records search", kind: "unblock", by: "agt_scout" },
    { taskId: "tsk_n4", title: "Pruitt intake summary", kind: "review", by: "agt_intake" },
    { taskId: "tsk_n5", title: "Send the ATP reminder to Harlow & Price", kind: "approve", by: "agt_research" },
    { taskId: "tsk_n6", title: "Problem report from Omar", kind: "review", by: "agt_assistant" },
    { taskId: "tsk_n7", title: "Month-end export is waiting on a sign-in", kind: "unblock", by: "agt_billing" },
  ],
  needsTotal: 7,
};

/** A prototype clock string: "8:41" is today at 08:41, "Yesterday" yesterday midday, a weekday name the Monday before. */
const stampOf = (when: string): number => {
  const m = /^(\d+):(\d+)$/.exec(when);
  if (m) return at(10, 24, Number(m[1]), Number(m[2]));
  return when === "Yesterday" ? at(10, 23, 12) : at(10, 20, 9);
};

/** Harbor Studio, read from the shared fixtures (which are read from the prototype): Scheduler and Proofer starred, studio and galleries, two Needs you, the Moreno chats. */
function harborSpace(): SampleSpace {
  const f = fixtureFor("harbor");
  const agentId = (id: string): boolean => id.startsWith("agt_");
  return {
    id: "harbor", name: f.space.name, assistant: { agentId: "agt_assistant", name: "Assistant" }, otherNeedsYou: false,
    agents: f.agents.map((a) => ({ agentId: a.id, name: a.name, starred: a.pinned })),
    threads: f.chats.map((c) => t(c.id, c.title, agentId(c.with) ? [c.with] : [], stampOf(c.at), { ...(c.unread === true ? { unread: 1 } : {}), ...(c.starred === true ? { starred: true } : {}) })),
    channels: channelsOf(f.channels, FOLLOWED_PROJECTS),
    needs: f.needs.map((n) => ({ taskId: `tsk_${n.id}`, title: n.title, kind: n.kind === "Approve" ? ("approve" as const) : n.kind === "Review" ? ("review" as const) : ("unblock" as const), by: n.agent })),
    needsTotal: f.needs.length,
  };
}
export const harbor: SampleSpace = harborSpace();

export const personal: SampleSpace = {
  id: "personal", name: "Personal", assistant: { agentId: "agt_assistant", name: "Assistant" }, otherNeedsYou: false,
  agents: [{ agentId: "agt_assistant", name: "Assistant", starred: true }],
  threads: [
    t("m1", "Plan the week", ["agt_assistant"], at(10, 24, 8, 5)),
    t("m2", "Flights to Kuala Lumpur", ["agt_assistant"], at(10, 23, 18, 40), { starred: true }),
    t("m3", "Tax papers checklist", ["agt_assistant"], at(10, 20, 9, 0)),
  ],
  channels: [], needs: [], needsTotal: 0,
};

const agentRow = (a: SampleSpace["agents"][number], i: number): Row => ({
  id: a.agentId, agentId: a.agentId, name: a.name, face: a.name[0]!, role: "", status: a.working ? "working" : "awake", ownerId: "usr_irfad", folderId: `fld_${a.agentId}`,
  accountPolicy: "asker", toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "propose", hasComputer: false, templateVersion: 1, createdAt: at(10, 1, 9) + i, starred: a.starred,
});

export interface SampleSidebar {
  data: ChatsSidebarData;
  replica: FakeReplica;
  /** every capability the sidebar called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  setOnline(online: boolean): void;
  /** make the next call to `cap` fail */
  failNext(cap: string): void;
  /** milliseconds chat.start takes to answer (default 40, so the local row is visible first) */
  startDelayMs: number;
}

export function createSampleSidebar(space: SampleSpace = northwind, o: { online?: boolean; startDelayMs?: number } = {}): SampleSidebar {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  const listeners = new Set<() => void>();
  let online = o.online ?? true;
  let startDelayMs = o.startDelayMs ?? 40;

  replica.put("agents", space.agents.map(agentRow));
  replica.put("threads", space.threads.map((x) => ({ id: x.threadId, ...x })));
  replica.put("channels", space.channels.map((c) => ({ id: c.channelId, ...c })));
  replica.put("needs", space.needs.map((n) => ({ id: n.taskId, ...n })));

  const threads = (): SampleThread[] => replica.rows("threads") as unknown as SampleThread[];
  const dayOf = (ts: number): number => Math.floor(ts / DAY);
  const item = (x: SampleThread): RecentItem => ({ threadId: x.threadId, kind: "chat", title: x.title, agents: x.agents, unread: x.unread, working: x.working, starred: x.starred, lastAt: x.lastAt });

  replica.resolve("chat.recent", () => {
    // the order the Space lists its chats in (the prototype shows them as seeded), not re-sorted
    const all = threads();
    const today = dayOf(SAMPLE_NOW);
    const out: RecentOut = { starred: [], today: [], yesterday: [], earlier: [], nextUnread: null };
    for (const x of all) {
      const d = today - dayOf(x.lastAt);
      (x.starred ? out.starred : d <= 0 ? out.today : d === 1 ? out.yesterday : out.earlier).push(item(x));
    }
    out.nextUnread = all.filter((x) => x.unread > 0).sort((a, b) => a.lastAt - b.lastAt)[0]?.threadId ?? null;
    return out;
  });
  replica.resolve("channels.list", () => ({
    channels: (replica.rows("channels") as unknown as SampleSpace["channels"]).map((c): Channel => ({
      channelId: c.channelId, mainThreadId: `th_${c.channelId}`, name: c.name, visibility: c.visibility, archived: false, members: [], agents: [], unread: c.unread, createdAt: at(10, 1, 9),
      ...(c.project ? { recordId: `rec_${c.channelId}` } : {}),
    })),
  }));
  replica.resolve("agents.list", (_t, input) => {
    const all = replica.rows("agents") as unknown as (Agent & { starred: boolean })[];
    const rows = input.section === "starred" ? all.filter((a) => a.starred) : all;
    return { agents: rows.map(({ starred: _s, ...a }) => a as Agent) };
  });
  replica.resolve("tasks.needs_you", (_t, input) => {
    const rows = replica.rows("needs") as unknown as SampleSpace["needs"];
    const items = rows.map((n): NeedsItem => ({
      reason: "ready",
      task: {
        id: n.taskId, kind: n.kind, title: n.title, state: "todo", blocked: n.kind === "unblock", blocks: [], assigned: { kind: "person", id: "usr_irfad" }, fileIds: [], dependsOn: [], followers: [], workingNotes: {},
        reviewLoops: 0, createdBy: n.by, createdAt: at(10, 24, 8), updatedAt: at(10, 24, 9),
        actions: n.kind === "approve" ? [{ key: "approve", label: "Approve" }] : n.kind === "review" ? [{ key: "review", label: "Looks good" }] : [],
      } as NeedsItem["task"],
    }));
    return { items: items.slice(0, input.limit ?? 50), total: Math.max(space.needsTotal, items.length) } as CapMap["tasks.needs_you"]["out"];
  });

  const patch = (id: string, p: Partial<SampleThread>): void => {
    const cur = threads().find((x) => x.threadId === id);
    if (cur) replica.put("threads", [{ id, ...cur, ...p }]);
  };
  const writes: Record<string, (input: any) => unknown> = {
    "chat.start": async (i: { agentIds: string[]; idempotencyKey: string }) => {
      await new Promise((r) => setTimeout(r, startDelayMs));
      const id = `th_${i.idempotencyKey}`;
      if (!threads().some((x) => x.threadId === id)) replica.put("threads", [{ id, ...t(id, "New chat", i.agentIds, SAMPLE_NOW) }]);
      return { thread: { threadId: id, kind: "chat", title: "New chat", listed: true, planMode: false } };
    },
    "stars.toggle": (i: { resource: { type: string; id: string }; on: boolean }) => {
      if (i.resource.type === "thread") patch(i.resource.id, { starred: i.on });
      if (i.resource.type === "agent") { const a = replica.rows("agents").find((r) => r.id === i.resource.id); if (a) replica.put("agents", [{ ...a, starred: i.on }]); }
      return { starred: i.on, following: false };
    },
    "threads.mark_read": (i: { threadId: string }) => {
      patch(i.threadId, { unread: 0 });
      const ch = (replica.rows("channels") as unknown as SampleSpace["channels"]).find((c) => `th_${c.channelId}` === i.threadId);
      if (ch) replica.put("channels", [{ id: ch.channelId, ...ch, unread: 0 }]);
      return { unread: 0 };
    },
    "tasks.act": (i: { taskId: string }) => { replica.remove("needs", [i.taskId]); return { task: {} }; },
  };

  const nav: ChatsNav = {
    openChat: (id) => void opened.push(`chat:${id}`), openAgentChat: (id) => void opened.push(`agent:${id}`), openChannel: (id) => void opened.push(`channel:${id}`),
    openNeedsYou: (id) => void opened.push(id ? `needs:${id}` : "needs"), openAllAgents: () => void opened.push("all-agents"), openSearch: () => void opened.push("search"),
    openSpaceSwitcher: () => void opened.push("spaces"), openNewChannel: () => void opened.push("new-channel"),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: ChatsSidebarData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    connection,
    space: { name: space.name, otherNeedsYou: space.otherNeedsYou, assistant: space.assistant },
    nav,
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
  };
  return {
    data, replica, calls, opened,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap) { failing.add(cap); },
    get startDelayMs() { return startDelayMs; },
    set startDelayMs(v: number) { startDelayMs = v; },
  };
}
