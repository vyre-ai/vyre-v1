// The sample Spaces behind the Home screen tests and the screenshots: Northwind (the default Space) and Harbor Studio, filled from the prototype's Home so a side by side
// reads the same. A fake replica holds the rows; each capability the sections read is registered with a resolver over those rows, and the writes the sections make
// (act, transition, assign, create, mark seen, undo) change the rows, so every control in a mount really works. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, QueryState, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Connection, HomeData, HomeNav, Principal } from "./data.tsx";
import type { Digest, NeedsItem, Ref, RiskProject, Routine, Task } from "./model.ts";

export const SAMPLE_RULE = "A project is at risk when it is overdue, has a blocked task, or its plan has slipped past a milestone.";
/** Friday 24 October 2025, 10:00 in the person's day (UTC for the samples, so every machine prints the same dates). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const DAY = 86_400_000;
const at = (m: number, d: number, h = 17, min = 0): number => Date.UTC(2025, m - 1, d, h, min, 0);

type TaskRow = Task & Row;
type NeedsRow = Row & { taskId: string; reason: NeedsItem["reason"]; handledBy?: string };

export interface SampleSpace {
  id: "northwind" | "harbor";
  name: string;
  me: Principal;
  principals: Principal[];
  records: Record<string, string>;
  tasks: Task[];
  needs: { taskId: string; reason: NeedsItem["reason"]; handledBy?: string }[];
  risk: RiskProject[];
  digest: Digest;
  routines: Routine[];
}

const task = (id: string, o: Partial<Task> & { title: string; kind: Task["kind"]; assigned: Ref; due?: number; recordId?: string }): Task => ({
  id, state: "todo", blocked: false, blocks: [], actions: [], fileIds: [], dependsOn: [], followers: [], workingNotes: {}, reviewLoops: 0,
  createdBy: "usr_irfad", createdAt: at(10, 20, 9), updatedAt: at(10, 23, 9), ...o,
} as Task);

const P = (id: string): Ref => ({ kind: "person", id });
const A = (id: string): Ref => ({ kind: "agent", id });

const people: Principal[] = [
  { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "usr_maya", name: "Maya Chen", kind: "person" }, { id: "usr_omar", name: "Omar Haddad", kind: "person" },
  { id: "usr_lena", name: "Lena Ortiz", kind: "person" }, { id: "usr_sam", name: "Sam Patel", kind: "person" },
  { id: "agt_assistant", name: "Assistant", kind: "agent" }, { id: "agt_intake", name: "Intake", kind: "agent" }, { id: "agt_docs", name: "Docs", kind: "agent" },
  { id: "agt_billing", name: "Billing", kind: "agent" }, { id: "agt_research", name: "Research", kind: "agent" }, { id: "agt_scout", name: "Scout", kind: "agent" },
  { id: "grp_billing", name: "Billing team", kind: "group" }, { id: "rol_reviewer", name: "Reviewer", kind: "role" },
];

const approve = [{ key: "approve", label: "Approve" }, { key: "send_back", label: "Send back", note: "required" as const }];
const review = [{ key: "review", label: "Review" }, { key: "send_back", label: "Send back", note: "required" as const }];
const unblock = [{ key: "unblock", label: "Unblock" }];

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind", me: people[0]!, principals: people,
  records: { rec_rivera: "Rivera matter", rec_pruitt: "Pruitt engagement", rec_atp1: "ATP · Harlow & Price", rec_q4: "Q4 billing", rec_hiring: "Hiring: operations lead", rec_offsite: "Q4 offsite", rec_web: "Website relaunch" },
  tasks: [
    task("tsk_t1", { title: "Send the retainer reminder to Marcus Pruitt", kind: "work", state: "doing", assigned: P("usr_irfad"), due: at(10, 22), recordId: "rec_pruitt" }),
    task("tsk_t2", { title: "Review the Harlow & Price worksheet", kind: "review", assigned: A("agt_research"), reviewer: P("usr_irfad"), due: at(10, 23), recordId: "rec_atp1" }),
    task("tsk_t3", { title: "Approve the Rivera engagement letter", kind: "approve", assigned: A("agt_docs"), approver: P("usr_irfad"), due: at(10, 24), recordId: "rec_rivera" }),
    task("tsk_t4", { title: "Call Elena about the fee waiver", kind: "work", state: "doing", assigned: P("usr_irfad"), due: at(10, 24), recordId: "rec_rivera" }),
    task("tsk_t5", { title: "Sign off the October invoices", kind: "review", assigned: A("agt_billing"), reviewer: P("usr_irfad"), due: at(10, 24), recordId: "rec_q4" }),
    task("tsk_t6", { title: "Approve the consult agenda", kind: "approve", assigned: P("usr_maya"), approver: P("usr_irfad"), due: at(10, 27), recordId: "rec_rivera" }),
    task("tsk_t7", { title: "Interview round one", kind: "work", assigned: P("usr_irfad"), due: at(10, 28), recordId: "rec_hiring" }),
    task("tsk_t8", { title: "Review the Pruitt intake form", kind: "review", assigned: A("agt_intake"), reviewer: P("usr_irfad"), due: at(10, 28), recordId: "rec_pruitt" }),
    task("tsk_t9", { title: "Approve the homepage copy", kind: "approve", state: "doing", blocked: true, assigned: A("agt_docs"), approver: P("usr_irfad"), due: at(10, 29), recordId: "rec_web" }),
    task("tsk_t10", { title: "Book the offsite venue", kind: "work", assigned: P("usr_irfad"), due: at(11, 3), recordId: "rec_offsite" }),
    task("tsk_t11", { title: "Quarterly ATP review with Harlow & Price", kind: "work", assigned: P("usr_irfad"), due: at(11, 12), recordId: "rec_atp1" }),
    task("tsk_t12", { title: "Approve the hiring budget", kind: "approve", assigned: P("usr_lena"), approver: P("usr_irfad"), due: at(11, 14), recordId: "rec_hiring" }),
    task("tsk_t13", { title: "Year-end statements", kind: "work", assigned: P("usr_irfad"), due: at(12, 19), recordId: "rec_q4" }),
    task("tsk_t14", { title: "Prepare the Pruitt consult folder", kind: "work", state: "doing", assigned: P("usr_omar"), due: at(10, 27), recordId: "rec_pruitt" }),
    task("tsk_t15", { title: "Draft the November invoice reminders", kind: "work", assigned: A("agt_billing"), due: at(10, 27), recordId: "rec_q4" }),
    task("tsk_t16", { title: "Check the county index for the Pruitt parcel", kind: "work", state: "doing", assigned: A("agt_intake"), due: at(10, 24), recordId: "rec_pruitt" }),
    // what waits in Needs you (agents asked; the first three are the top of the list)
    task("tsk_n1", { title: "Send 12 invoices", kind: "approve", summary: "$18,420 total · due Friday", state: "awaiting_approval", assigned: A("agt_billing"), approver: P("usr_irfad"), actions: approve, createdBy: "agt_billing", due: at(10, 24) }),
    task("tsk_n2", { title: "Rivera engagement letter", kind: "review", summary: "Draft from the standard template", state: "in_review", assigned: A("agt_docs"), reviewer: P("usr_irfad"), actions: review, createdBy: "agt_docs", due: at(10, 24) }),
    task("tsk_n3", { title: "County records search", kind: "unblock", summary: "Needs a login for the county site", state: "doing", blocked: true, assigned: A("agt_scout"), actions: unblock, createdBy: "agt_scout" }),
    task("tsk_n4", { title: "Pruitt intake summary", kind: "review", summary: "Form came back, 2 fields unclear", state: "in_review", assigned: A("agt_intake"), reviewer: P("usr_irfad"), actions: review, createdBy: "agt_intake" }),
    task("tsk_n5", { title: "Refund for Meyer Law", kind: "approve", summary: "$400 · billed twice in September", state: "awaiting_approval", assigned: A("agt_billing"), approver: P("usr_irfad"), actions: approve, createdBy: "agt_billing" }),
    task("tsk_n6", { title: "Send the ATP reminder to Harlow & Price", kind: "approve", summary: "Quarterly worksheet, due Nov 12", state: "awaiting_approval", assigned: A("agt_research"), approver: P("usr_irfad"), actions: approve, createdBy: "agt_research" }),
    task("tsk_n7", { title: "Consult agenda draft", kind: "review", summary: "Maya pulled this back after the call moved", state: "in_review", assigned: A("agt_docs"), reviewer: P("usr_irfad"), actions: review, createdBy: "agt_docs" }),
  ],
  needs: [
    { taskId: "tsk_n1", reason: "due_today" }, { taskId: "tsk_n2", reason: "due_today" }, { taskId: "tsk_n3", reason: "blocking" }, { taskId: "tsk_n4", reason: "ready" },
    { taskId: "tsk_n5", reason: "ready", handledBy: "grp_billing" }, { taskId: "tsk_n6", reason: "ready" }, { taskId: "tsk_n7", reason: "ready" },
  ],
  risk: [
    { recordId: "rec_pruitt", type: "project", title: "Pruitt engagement", reasons: ["overdue"], dueAt: at(11, 14), lead: "usr_lena", blockedTasks: 0, overdueTasks: 2 },
    { recordId: "rec_q4", type: "project", title: "Q4 billing", reasons: ["blocked"], dueAt: at(12, 23), lead: "usr_lena", blockedTasks: 1, overdueTasks: 0 },
    { recordId: "rec_web", type: "project", title: "Website relaunch", reasons: ["blocked", "slipped"], dueAt: at(11, 21), lead: "usr_sam", blockedTasks: 1, overdueTasks: 0 },
  ],
  digest: {
    id: "dgs_1", person: "usr_irfad", periodStart: at(10, 23, 18), periodEnd: at(10, 24, 9), builtBy: "agt_assistant",
    headline: [
      "Intake added 3 leads and booked Sam Ortega's consult for Tuesday.",
      "Docs drafted the Rivera engagement letter and it waits for your review.",
      "Billing reconciled October and drafted 12 invoices for your approval.",
    ],
    items: [
      { kind: "decision", title: "Booked Sam Ortega's consult for Tuesday", line: "Intake, from the web form inbox", subject: { type: "run", id: "run_sweep" }, at: at(10, 24, 8, 12), undo: { cap: "runs.undo", input: { runId: "run_sweep" } } },
      { kind: "finished", title: "Added 3 leads to Records", line: "Intake, morning lead sweep", subject: { type: "run", id: "run_sweep" }, at: at(10, 24, 8, 0) },
      { kind: "finished", title: "Drafted the Rivera engagement letter", line: "Docs, fee waiver applied", subject: { type: "thread", id: "thr_docs" }, at: at(10, 24, 8, 50) },
      { kind: "finished", title: "Reconciled October and drafted 12 invoices", line: "Billing, $18,420 in total", subject: { type: "run", id: "run_recon" }, at: at(10, 23, 16, 10) },
      { kind: "routine", title: "Morning briefing ran", line: "Assistant, three lines in the chat", subject: { type: "run", id: "run_brief" }, at: at(10, 24, 7, 45) },
      { kind: "record_change", title: "Rivera matter moved to Intake", line: "A record you follow", subject: { type: "record", id: "rec_rivera" }, at: at(10, 23, 15, 30) },
    ],
  },
  routines: [
    { agentId: "agt_assistant", routineId: "rtn_brief", title: "Morning briefing", at: at(10, 24, 7, 45), state: "done", runId: "run_brief", resultLine: "three lines in the chat" },
    { agentId: "agt_billing", routineId: "rtn_invoice", title: "Watch for invoice questions", at: at(10, 24, 6, 0), state: "running", resultLine: "2 handled today" },
    { agentId: "agt_intake", routineId: "rtn_leads", title: "Weekly lead report", at: at(10, 24, 16, 0), state: "scheduled" },
    { agentId: "agt_assistant", routineId: "rtn_status", title: "Weekly status drafts", at: at(10, 24, 17, 0), state: "scheduled" },
  ],
};

const harborPeople: Principal[] = [
  { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" }, { id: "usr_ines", name: "Ines Costa", kind: "person" }, { id: "usr_theo", name: "Theo Lindqvist", kind: "person" },
  { id: "usr_june", name: "June Okafor", kind: "person" }, { id: "agt_assistant", name: "Assistant", kind: "agent" }, { id: "agt_scheduler", name: "Scheduler", kind: "agent" },
  { id: "agt_proofer", name: "Proofer", kind: "agent" }, { id: "grp_studio", name: "Studio team", kind: "group" },
];

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio", me: harborPeople[0]!, principals: harborPeople,
  records: { rec_moreno: "Moreno rebrand", rec_abel: "Abel & Daughters site", rec_open: "Open studio day" },
  tasks: [
    task("tsk_h1", { title: "Send Kai the logo round two", kind: "work", state: "doing", assigned: P("usr_irfad"), due: at(10, 24), recordId: "rec_moreno" }),
    task("tsk_h2", { title: "Approve the Abel homepage copy", kind: "approve", assigned: A("agt_proofer"), approver: P("usr_irfad"), due: at(10, 24), recordId: "rec_abel" }),
    task("tsk_h3", { title: "Book the photographer", kind: "work", assigned: P("usr_june"), createdBy: "usr_irfad", due: at(10, 27), recordId: "rec_open" }),
    task("tsk_h4", { title: "Review the studio day signage", kind: "review", assigned: P("usr_june"), reviewer: P("usr_irfad"), due: at(10, 28), recordId: "rec_open" }),
    task("tsk_h5", { title: "Invoice Moreno Ceramics", kind: "work", assigned: P("usr_irfad"), due: at(10, 30), recordId: "rec_moreno" }),
    task("tsk_hn1", { title: "Confirm 3 studio visits", kind: "approve", summary: "Thursday 10:00, 11:30, 14:00", state: "awaiting_approval", assigned: A("agt_scheduler"), approver: P("usr_irfad"), actions: approve, createdBy: "agt_scheduler", due: at(10, 24) }),
    task("tsk_hn2", { title: "Abel homepage copy", kind: "review", summary: "Four lines marked", state: "in_review", assigned: A("agt_proofer"), reviewer: P("usr_irfad"), actions: review, createdBy: "agt_proofer", due: at(10, 24) }),
  ],
  needs: [{ taskId: "tsk_hn1", reason: "due_today" }, { taskId: "tsk_hn2", reason: "due_today" }],
  risk: [{ recordId: "rec_abel", type: "project", title: "Abel & Daughters site", reasons: ["overdue"], dueAt: at(11, 12), lead: "usr_theo", blockedTasks: 0, overdueTasks: 1 }],
  digest: {
    id: "dgs_h1", person: "usr_irfad", periodStart: at(10, 23, 18), periodEnd: at(10, 24, 9), builtBy: "agt_assistant",
    headline: ["Scheduler held three Thursday slots for studio visits.", "The morning briefing ran at 7:45.", "Nothing else needs a decision today."],
    items: [
      { kind: "finished", title: "Held 3 slots for Thursday visits", line: "Scheduler", subject: { type: "thread", id: "thr_sched" }, at: at(10, 24, 8, 10) },
      { kind: "routine", title: "Morning briefing ran", line: "Assistant", subject: { type: "run", id: "run_hbrief" }, at: at(10, 24, 7, 45) },
    ],
  },
  routines: [
    { agentId: "agt_assistant", routineId: "rtn_hbrief", title: "Morning briefing", at: at(10, 24, 7, 45), state: "done", runId: "run_hbrief", resultLine: "two things need you" },
    { agentId: "agt_scheduler", routineId: "rtn_hhold", title: "Hold visit slots", at: at(10, 24, 6, 0), state: "running", resultLine: "3 handled today" },
  ],
};

// ---------------------------------------------------------------- the fake replica behind a Space

const OPEN = (s: Task["state"]): boolean => s !== "done" && s !== "canceled";
const refEq = (a: Ref | null | undefined, id: string): boolean => a != null && a.id === id;

export function liveRows<T>(replica: FakeReplica, table: string, map: (rows: Row[]) => T): LiveQuery<T> {
  let at = -1, snap: QueryState<T> = { status: "loading" };
  return {
    subscribe: (l) => replica.subscribe(l),
    getSnapshot() {
      if (replica.version() === at) return snap;
      at = replica.version();
      snap = { status: "ready", data: map(replica.rows(table)) };
      return snap;
    },
  };
}

export interface SampleHome {
  data: HomeData;
  replica: FakeReplica;
  /** every capability the sections called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  setOnline(online: boolean): void;
  /** make the next call to `cap` fail */
  failNext(cap: string): void;
}

export function createSampleHome(space: SampleSpace = northwind, o: { online?: boolean } = {}): SampleHome {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  const clock = { now: SAMPLE_NOW, offsetMin: 0 };
  let online = o.online ?? true;
  const listeners = new Set<() => void>();

  replica.put("tasks", space.tasks.map((t) => ({ ...t }) as TaskRow));
  replica.put("needs", space.needs.map((n) => ({ id: n.taskId, ...n }) as NeedsRow));
  replica.put("risk", space.risk.map((r) => ({ id: r.recordId, ...r })));
  replica.put("digest", [{ id: space.digest.id, ...space.digest }]);
  replica.put("routines", space.routines.map((r) => ({ id: r.routineId, ...r })));
  replica.put("principals", space.principals.map((p) => ({ ...p })));

  const taskRows = (): Task[] => replica.rows("tasks") as unknown as Task[];
  const me = space.me.id;
  const mine = (t: Task): boolean => OPEN(t.state) && (refEq(t.assigned, me) || refEq(t.reviewer, me) || refEq(t.approver, me)) && !NEEDS_IDS.has(t.id);
  const NEEDS_IDS = new Set(space.needs.map((n) => n.taskId));

  replica.resolve("tasks.needs_you", (_t, input) => {
    const byId = new Map(taskRows().map((t) => [t.id, t] as const));
    const rank = { overdue: 0, due_today: 1, blocking: 2, ready: 3 } as const;
    const rows = (replica.rows("needs") as unknown as NeedsRow[]).filter((n) => byId.has(n.taskId) && OPEN(byId.get(n.taskId)!.state));
    rows.sort((a, b) => rank[a.reason] - rank[b.reason]);
    const items = rows.map((n) => ({ task: byId.get(n.taskId)!, reason: n.reason, ...(n.handledBy ? { handledBy: n.handledBy } : {}) }));
    return { items: items.slice(0, input.limit ?? 50), total: items.length } as CapMap["tasks.needs_you"]["out"];
  });
  replica.resolve("tasks.my_work", (_t, input) => {
    const all = taskRows();
    const section = input.section ?? "open";
    const open = all.filter(mine);
    const given = all.filter((t) => OPEN(t.state) && t.createdBy === me && !refEq(t.assigned, me) && !NEEDS_IDS.has(t.id) && !mine(t));
    const done = all.filter((t) => t.state === "done" && !NEEDS_IDS.has(t.id));
    const tasks = section === "open" ? open : section === "assigned_by_me" ? given : section === "done" ? done : [...open, ...given, ...done];
    return { tasks, counts: { open: open.length, assignedByMe: given.length, done: done.length }, total: tasks.length } as CapMap["tasks.my_work"]["out"];
  });
  replica.resolve("home.at_risk", (_t, input) => ({ rule: SAMPLE_RULE, projects: (replica.rows("risk") as unknown as RiskProject[]).slice(0, input.limit ?? 50) }));
  replica.resolve("home.digest", () => ({ digest: (replica.rows("digest")[0] as unknown as Digest | undefined) ?? null }));
  replica.resolve("home.routines_today", () => ({ routines: replica.rows("routines") as unknown as Routine[] }));

  const patchTask = (id: string, patch: Partial<Task>): Task => {
    const cur = taskRows().find((t) => t.id === id);
    if (!cur) throw new Error(`no such task ${id}`);
    const next = { ...cur, ...patch, updatedAt: SAMPLE_NOW } as Task;
    replica.put("tasks", [next as TaskRow]);
    return next;
  };

  const writes: Record<string, (input: any) => unknown> = {
    "tasks.act": (i: { taskId: string; action: string }) => patchTask(i.taskId, { state: "done" }) && { task: taskRows().find((t) => t.id === i.taskId) },
    "tasks.transition": (i: { taskId: string; to: Task["state"] }) => ({ task: patchTask(i.taskId, { state: i.to, blocked: false }) }),
    "tasks.assign": (i: { taskId: string; slot: "assigned" | "reviewer" | "approver"; to: Ref | null }) => {
      const patch: Partial<Task> = i.slot === "assigned" ? { assigned: i.to as Ref } : i.slot === "reviewer" ? { reviewer: i.to ?? undefined } as Partial<Task> : { approver: i.to ?? undefined } as Partial<Task>;
      return { task: patchTask(i.taskId, patch) };
    },
    "tasks.create": (i: { kind: Task["kind"]; title: string; assigned: Ref }) => {
      const id = `tsk_new${replica.rows("tasks").length + 1}`;
      replica.put("tasks", [{ ...task(id, { title: i.title, kind: i.kind, assigned: i.assigned, due: SAMPLE_NOW + DAY, createdBy: me }), createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW } as TaskRow]);
      return { task: taskRows().find((t) => t.id === id) };
    },
    "home.mark_digest_seen": (i: { digestId: string }) => {
      const cur = replica.rows("digest").find((d) => d.id === i.digestId);
      if (cur) replica.put("digest", [{ ...cur, seenAt: SAMPLE_NOW } as Row]);
      return { ok: true };
    },
    "runs.undo": (i: { runId: string }) => {
      const cur = replica.rows("digest")[0] as unknown as (Digest & Row) | undefined;
      if (cur) replica.put("digest", [{ ...cur, items: cur.items.filter((it) => !(it.undo && JSON.stringify(it.undo.input) === JSON.stringify({ runId: i.runId }))) } as unknown as Row]);
      return { ok: true };
    },
  };

  const nav: HomeNav = {
    openTask: (id) => void opened.push(`task:${id}`), openRecord: (id) => void opened.push(`record:${id}`), openRun: (id) => void opened.push(`run:${id}`),
    openNeedsYou: (id) => void opened.push(id ? `needs:${id}` : "needs"), openMyWork: () => void opened.push("mywork"), openActivity: () => void opened.push("activity"),
    openAgent: (id) => void opened.push(`agent:${id}`), openSubject: (s) => void opened.push(`${s.type}:${s.id}`),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: HomeData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    connection,
    principals: liveRows(replica, "principals", (rows) => rows as unknown as Principal[]),
    recordTitle: (id) => space.records[id],
    me: space.me,
    nav,
    clock: () => clock,
  };
  return {
    data, replica, calls, opened,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap) { failing.add(cap); },
  };
}
