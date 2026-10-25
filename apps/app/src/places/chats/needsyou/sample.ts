// The sample Spaces behind the Needs you tests and screenshots: Northwind (seven requests, as in the prototype) and Harbor Studio (nothing waiting). A fake replica holds the
// rows; each capability the screen reads is registered with a resolver over those rows, and the writes it makes (tasks.act, tasks.take, tasks.snooze) change the rows, so every
// control in a mount really works. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { Connection, NeedsNav, NeedsYouData } from "./data.tsx";
import type { Item, Reason, Task } from "./model.ts";

/** Friday 24 October 2025, 10:00 (UTC, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const at = (m: number, d: number, h: number, min = 0): number => Date.UTC(2025, m - 1, d, h, min, 0);

export type Variant = "northwind" | "harbor" | "quiet";

export const ME = "usr_irfad";
export const NAMES: Record<string, string> = {
  usr_irfad: "You", usr_omar: "Omar Haddad", usr_maya: "Maya Chen",
  agt_billing: "Billing", agt_docs: "Docs", agt_scout: "Scout", agt_intake: "Intake", agt_research: "Research", agt_assistant: "Assistant", agt_scheduler: "Scheduler", agt_proofer: "Proofer",
  role_finance: "Finance", usr_lena: "Lena Ortiz",
};
const SOURCES: Record<string, string> = { "chat:c3": "October invoices", "chat:c4": "Rivera engagement letter", "chat:c6": "County records search", "chat:c1": "Rivera intake", "chat:c2": "Competitor pricing", "chat:c7": "Plan the Q4 offsite", "chat:hc-sched": "Studio visits", "chat:hc-proof": "Abel homepage copy", "chat:c4w": "Pruitt fee letter" };

const approve = [{ key: "approve", label: "Approve" }, { key: "send_back", label: "Send back", note: "required" as const }];
const review = [{ key: "review", label: "Looks good" }, { key: "send_back", label: "Send back", note: "required" as const }];

function task(id: string, kind: Task["kind"], by: string, title: string, summary: string, why: string, chat: string, updatedAt: number, o: Partial<Task> = {}): Task {
  return {
    id, kind, title, summary, why, state: kind === "approve" ? "awaiting_approval" : kind === "review" ? "in_review" : "doing", blocked: false, blocks: [], actions: kind === "approve" ? approve : review,
    assigned: { kind: "agent", id: by }, approver: { kind: "person", id: ME }, fileIds: [], source: { kind: "chat", id: chat }, dependsOn: [], followers: [], workingNotes: {}, reviewLoops: 0,
    createdBy: by, createdAt: updatedAt - 600_000, updatedAt, ...o,
  };
}

export function northwindTasks(): { task: Task; reason: Reason; handledBy?: string }[] {
  return [
    { reason: "due_today", task: task("n1", "approve", "agt_billing", "Send 12 invoices", "$18,420 total · due Friday", "The monthly run, same as September. Two clients have new rates since last month; both are marked.", "c3", at(10, 24, 9, 12), {
      due: at(10, 24, 17), blocks: [{ type: "table", v: 1, data: { columns: ["Client", "Amount", "Due"], rows: [["Harlow & Price", "$2,400", "Oct 31"], ["Grant Legal", "$1,850", "Oct 31"], ["Meyer Law", "$3,100", "Nov 1"], ["Ardent Partners", "$960", "Nov 1"], ["Brook Studio", "$1,200", "Nov 2"]], more: 7, tags: ["", "new rate", "", "", "new rate"] } }],
    }) },
    { reason: "ready", task: task("n2", "review", "agt_docs", "Rivera engagement letter", "Draft from the standard template", "Filled from Elena's record and the consult booking. Three values came from the record; please check the fee.", "c4", at(10, 24, 8, 50), {
      fileIds: ["doc1"], blocks: [{ type: "document", v: 1, data: { lines: ["This letter confirms that Elena Rivera engages Northwind for the matter described below.", "The consult fee is $250, due at the consult on Tuesday, Oct 28."], file: "engagement-letter.docx" } }],
    }) },
    { reason: "blocking", task: task("n3", "unblock", "agt_scout", "County records search", "Needs a login for the county site", "It reached the county records portal and hit a sign-in page. Lend it a login from the Vault and it carries on from the same step; it never sees the password.", "c6", at(10, 24, 8, 31), {
      blocked: true, actions: [{ key: "lend", label: "Lend a login…" }], blocks: [{ type: "screenshot", v: 1, data: { caption: "records.county.gov/search, sign-in page" } }],
    }) },
    { reason: "ready", task: task("n4", "review", "agt_intake", "Pruitt intake summary", "Form came back, 2 fields unclear", "Marcus Pruitt returned the intake form. The property address and the other party's name were unclear, so I left them blank.", "c1", at(10, 24, 9, 10)) },
    { reason: "ready", task: task("n5", "approve", "agt_research", "Send the ATP reminder to Harlow & Price", "Quarterly worksheet, due Nov 12", "A standard reminder with the worksheet link. It goes from your address.", "c2", at(10, 23, 16, 5)) },
    { reason: "ready", task: task("n6", "review", "agt_assistant", "Problem report from Omar", "The intake form would not send", "Omar pressed Report a problem on the Rivera intake form. The bundle holds the last 20 trace ids, recent errors and a window picture. Sealed values are redacted.", "c7", at(10, 24, 9, 36), {
      blocks: [{ type: "pairs", v: 1, data: { pairs: [["Item", "forms/rivera-intake · e41c"], ["Trace ids", "20 · last tr_91ac07"], ["Errors", "1 · form.send 503"], ["Versions", "app 1.0.0 · server 1.0.0"], ["Device", "MacBook · macOS 26"]] } }],
    }) },
    // Withdrawn by its source: the fee changed and Docs is redrafting it. It sits under Withdrawn and does not count.
    { reason: "ready", task: task("n8", "approve", "agt_docs", "Send the Pruitt fee letter", "Withdrawn: the fee changed and Docs is redrafting it.", "", "c4", at(10, 24, 8, 10), { state: "canceled", actions: [{ key: "dismiss", label: "Dismiss" }] }) },
    { reason: "blocking", task: task("n7", "unblock", "agt_billing", "Month-end export is waiting on a sign-in", "The wait outlived your Claude sign-in", "The export has waited 14 hours for the bank to finish. Your Claude sign-in ran out meanwhile. Sign in again and Billing carries on, or let it use its backup key. The run shows Waiting, not Failed.", "c3", at(10, 24, 9, 14), {
      blocked: true, actions: [{ key: "signin", label: "Sign in again" }, { key: "backup", label: "Use the backup key" }],
    }) },
  ];
}

/** Harbor Studio's two requests, from the prototype: the Scheduler wants three studio visits confirmed, the Proofer wants a copy review. */
export function harborTasks(): { task: Task; reason: Reason; handledBy?: string }[] {
  return [
    { reason: "ready", task: task("h1", "approve", "agt_scheduler", "Confirm 3 studio visits", "Thursday 10:00, 11:30, 14:00", "Each visitor has a free slot and a booking form on file. Confirming sends them the address and parking note.", "hc-sched", at(10, 24, 9, 20)) },
    { reason: "ready", task: task("h2", "review", "agt_proofer", "Abel homepage copy", "Four lines marked", "The copy matches the brand sheet except four long lines. Take or leave each change.", "hc-proof", at(10, 24, 8, 40)) },
  ];
}

export interface Sample {
  data: NeedsYouData;
  replica: FakeReplica;
  /** every capability the screen called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open, as "kind:id" */
  opened: string[];
  setOnline(online: boolean): void;
  /** make the next call to `cap` fail */
  failNext(cap: string): void;
}

export function createSample(variant: Variant = "northwind", o: { online?: boolean } = {}): Sample {
  const replica = createFakeReplica(variant);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  const listeners = new Set<() => void>();
  let online = o.online ?? true;
  const seed = variant === "northwind" ? northwindTasks() : variant === "harbor" ? harborTasks() : [];
  replica.put("needs", seed.map((x) => ({ id: x.task.id, ...x })));

  const rows = (): (Item & Row)[] => replica.rows("needs") as unknown as (Item & Row)[];
  const clean = (x: Item & Row): Item => { const { id: _id, ...rest } = x; return rest as Item; };
  replica.resolve("tasks.needs_you", (_t, input) => {
    const items = rows().map(clean);
    return { items: items.slice(0, input.limit ?? 50), total: items.filter((i) => i.task.state !== "canceled").length };
  });
  replica.resolve("tasks.count_needs_you", () => ({ count: rows().filter((r) => r.task.state !== "canceled").length }));
  replica.resolve("tasks.get", (_t, input) => {
    const r = rows().find((x) => x.task.id === input.taskId);
    if (!r) throw new Error("no such task");
    return { task: r.task };
  });

  const patch = (id: string, p: Partial<Task>): Task => {
    const cur = rows().find((x) => x.task.id === id);
    if (!cur) throw new Error("no such task");
    const next = { ...cur, task: { ...cur.task, ...p } };
    replica.put("needs", [next]);
    return next.task;
  };
  const writes: Record<string, (input: any) => unknown> = {
    "tasks.act": (i: { taskId: string; action: string; note?: string }) => {
      const t = patch(i.taskId, { state: "done" });
      replica.remove("needs", [i.taskId]);
      return { task: t };
    },
    "tasks.take": (i: { taskId: string }) => ({ task: patch(i.taskId, { takenBy: ME }) }),
    "tasks.snooze": (i: { taskId: string; until: number | null }) => {
      const t = patch(i.taskId, { ...(i.until !== null ? { snoozedUntil: i.until } : {}) });
      replica.remove("needs", [i.taskId]);
      return { task: t };
    },
  };

  const nav: NeedsNav = {
    openSource: (kind, id) => void opened.push(`source:${kind}:${id}`),
    openFile: (id) => void opened.push(`file:${id}`),
    openComputer: (id) => void opened.push(`computer:${id}`),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };
  const data: NeedsYouData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    connection,
    me: ME,
    space: { name: variant === "northwind" ? "Northwind" : "Harbor Studio" },
    nameOf: (id) => NAMES[id] ?? id,
    sourceTitle: (kind, id) => SOURCES[`${kind}:${id}`],
    nav,
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
  };
  return {
    data, replica, calls, opened,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap) { failing.add(cap); },
  };
}
