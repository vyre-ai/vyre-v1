// The sample Spaces behind the Runs screen tests and screenshots: Northwind (the default Space, filled from the prototype's Automations place: "New lead follow-up", the
// invoice run waiting on Maya, the refused message) and Harbor Studio. A fake replica holds the rows; each capability the views read is registered with a resolver over those rows, and the
// writes they make (retry, stop, undo, replay, post, act on a task) change the rows, so every control in a mount really works. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row, ScreenHooks } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import { namesFor, nameOf } from "../../../fixtures/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { RunsData, RunsNav } from "./data.tsx";
import type { Run, RunStep, ThreadMessage, UndoPreview } from "./model.ts";

/** Fri 23 Oct 2026 09:14, the prototype's "now". */
export const SAMPLE_NOW = new Date(2026, 9, 23, 9, 14, 0).getTime();
const MIN = 60_000;
const DAY = 1440 * MIN;
/** The prototype writes a time as `NOW - days + minutes`; dayAt is the same. */
const ago = (min: number): number => SAMPLE_NOW - min * MIN;
const dayAt = (daysBack: number, plusMinutes: number): number => SAMPLE_NOW - daysBack * DAY + plusMinutes * MIN;

type Block = ThreadMessage["blocks"][number];
const block = (type: string, data: Record<string, unknown>, id: string): Block => ({ type, v: 1, id, data, traceId: `trc_${id}` });

interface Line { t: number; body: string; kind?: ThreadMessage["kind"]; author?: ThreadMessage["author"]; block?: [string, Record<string, unknown>]; depth?: number }
const SYS = { kind: "service", id: "svc_runs" } as const;

function thread(threadId: string, startedAt: number, lines: readonly Line[]): Row[] {
  return lines.map((l, i) => ({
    id: `${threadId}_m${i + 1}`, threadId, messageId: `${threadId}_m${i + 1}`, threadSeq: i + 1, author: l.author ?? SYS, kind: l.kind ?? "system", body: l.body,
    blocks: l.block ? [block(l.block[0], l.block[1], `${threadId}_b${i + 1}`)] : [], depth: l.depth ?? 0, attachments: [], reactions: [], pinned: false, createdAt: startedAt + l.t * 1000,
  }));
}
const row = (text: string, t: number, extra: Record<string, unknown> = {}): Line => ({ t, body: text, block: ["run.row", extra] });

export interface RunsSpace {
  id: "northwind" | "harbor";
  name: string;
  me: { id: string; name: string };
  names: Record<string, string>;
}

export const northwind: RunsSpace = {
  id: "northwind", name: "Northwind", me: { id: "usr_irfad", name: "Irfad Imtiaz" },
  names: namesFor("northwind", { aut_lead: "New lead follow-up", aut_flag: "Flag invoices over $5k to me", aut_invoice: "Invoice reminders", aut_meeting: "Meeting transcript to tasks", svc_runs: "Runs" }),
};
export const harbor: RunsSpace = {
  id: "harbor", name: "Harbor Studio", me: { id: "usr_june", name: "June Okafor" },
  names: namesFor("harbor", { aut_h1: "Brief to project", aut_h2: "Friday wrap-up", svc_runs: "Runs" }),
};

const runRow = (o: Partial<Run> & { id: string; startedAt: number; status: Run["status"]; auto: string; owner: string }): Row => {
  const { auto, ...rest } = o;
  return { kind: "automation", startedBy: o.owner, costMicros: 0, traceId: `tr_${o.id.replace(/\W/g, "").padEnd(6, "0").slice(0, 6)}`, subject: { type: "automation", id: auto }, ...rest } as unknown as Row;
};

function northwindRows(): { runs: Row[]; steps: Row[]; messages: Row[]; undo: Row[] } {
  const lead = (o: Partial<Run> & { id: string; startedAt: number; status: Run["status"] }): Row => runRow({ auto: "aut_lead", owner: "usr_maya", definitionVersion: 5, ...o });
  const ok = (id: string, who: string, d: number, at: number, via: string): Row => lead({ id, status: "succeeded", name: `${who} ${via}`, startedAt: at, endedAt: at + d * 1000, definitionVersion: 4, summary: `Succeeded, 6 steps, ${d} s`, threadId: `thr_${id}` });
  const runs: Row[] = [
    lead({ id: "rl1", status: "failed", name: "Elena Rivera arrived from the Meta lead form", startedAt: ago(33), endedAt: ago(33) + 24_000, summary: "No Twilio key", threadId: "thr_rl1" }),
    ok("rl2", "David Okafor", 41, dayAt(1, 460), "arrived from the Meta lead form"),
    ok("rl3", "Priya Nair", 39, dayAt(1, 190), "sent the Client intake form"),
    ok("rl4", "Tom Greene", 44, dayAt(2, 560), "arrived from the Meta lead form"),
    ok("rl5", "Ana Silva", 37, dayAt(3, 700), "arrived from the Meta lead form"),
    ok("rl6", "Jonas Weber", 40, dayAt(4, 300), "arrived from the Meta lead form"),
    runRow({ id: "ri1", auto: "aut_invoice", owner: "usr_irfad", status: "waiting", waitReason: "approval", name: "On schedule, Fridays at 09:00", startedAt: ago(14), definitionVersion: 4, threadId: "thr_ri1" }),
    runRow({ id: "rbig0", auto: "aut_flag", owner: "usr_irfad", status: "failed", name: "Invoice 1044, Greene & Co, $7,900", startedAt: ago(47), endedAt: ago(47) + 19_000, definitionVersion: 3, summary: "The message was refused", threadId: "thr_rbig0" }),
    runRow({ id: "rm0", auto: "aut_meeting", owner: "usr_omar", status: "running", name: "Kickoff call with Elena Rivera has a transcript", startedAt: ago(30), definitionVersion: 2, threadId: "thr_rm0" }),
  ];
  const steps: Row[] = [
    { id: "rl1_s1", runId: "rl1", step: "find", attempt: 1, state: "succeeded" },
    { id: "rl1_s2", runId: "rl1", step: "draft", attempt: 1, state: "succeeded" },
    { id: "rl1_s3", runId: "rl1", step: "paths", attempt: 1, state: "succeeded" },
    ...[1, 2, 3].map((n) => ({ id: `rl1_s4_${n}`, runId: "rl1", step: "text", attempt: n, state: "failed", error: { code: "connector.no_key", message: "No Twilio key" } })),
    { id: "rbig0_s1", runId: "rbig0", step: "message", attempt: 3, state: "failed", error: { code: "chat.refused", message: "The message was refused" } },
  ];
  const lt = runs[0]!["startedAt"] as number;
  const messages: Row[] = [
    ...thread("thr_rl1", lt, [
      { ...row("Started by a new lead: Elena Rivera, from the Meta lead form", 0, { icon: "bolt", tone: "muted" }) },
      row("Found Elena Rivera (1 match)", 1),
      { t: 7, kind: "agent", author: { kind: "agent", id: "agt_intake" }, body: "Hi Elena, thanks for writing in about the lease at Rivera's Bakery. I would like to hear more. Is Tuesday at 10:30 a good time for a short call?",
        block: ["run.turn", { title: "Draft a personal reply from the form answers", thought: { secs: 5, text: "The form says Elena runs a small bakery and wants help with a lease dispute. A warm, short note that names the bakery will land better than a template." }, did: ["Read the five form answers", "Looked at the lead's website for the bakery name", "Wrote a three-line reply"], skipped: ["Did not quote a price, the form did not ask"], key: "Your Claude sign-in", model: "Sonnet 5.5" }] },
      row("She has a mobile number, so it took the Has a phone path", 9),
      row("Tried to text +1 415 555 0161", 11, { icon: "retry", tone: "wait", retry: "Try 1 of 3, failed. Waited 5 s." }),
      row("Try 2 of 3, failed. Waited 5 s.", 14, { icon: "retry", tone: "wait" }),
      { t: 24, body: "No Twilio key", block: ["run.error", { detail: "The Twilio step needs an Account SID and an Auth Token. None is set, so it tried 3 times and stopped.", retry: "Try 3 of 3, failed.", step: "text" }] },
    ]),
    ...thread("thr_rl3", dayAt(1, 190), [
      row("Started: Priya Nair submitted the Client intake form", 0, { icon: "inbox", tone: "muted" }),
      row("Found Priya Nair (1 match)", 1),
      { t: 5, kind: "agent", author: { kind: "agent", id: "agt_intake" }, body: "Hi Priya, thanks for the details. I would like to hear more about the partnership terms. Does Thursday at 14:00 work for a call?",
        block: ["run.turn", { title: "Draft a personal reply from the form answers", did: ["Read the form answers", "Wrote a three-line reply"], skipped: [], key: "Your Claude sign-in", model: "Sonnet 5.5" }] },
      row("She has a mobile number, so it took the Has a phone path", 8),
      row("Text sent to +1 415 555 0142", 12),
      row("Replied after 3 h", 20),
      row("Task given to Omar Haddad", 39),
    ]),
    ...thread("thr_ri1", ago(14), [
      row("Started on schedule: Fridays at 09:00", 0, { icon: "clock", tone: "muted" }),
      row("Found 3 invoices ($7,240)", 1),
      { t: 6, kind: "agent", author: { kind: "agent", id: "agt_billing" }, body: "I wrote three reminders. The oldest is 41 days overdue, so its tone is firmer and it offers a payment plan.", block: ["run.turn", { title: "Billing writes the reminder", did: ["Wrote 3 reminders"], skipped: [], key: "Northwind OpenAI key", model: "GPT 5.5" }] },
      { t: 8, kind: "quiet", author: { kind: "person", id: "usr_maya" }, body: "Maya Chen joined as Approver", block: ["run.join", {}] },
      { t: 9, body: "Waiting for Maya Chen to approve 3 reminders", block: ["run.wait", { taskId: "tsk_ri1" }] },
    ]),
    ...thread("thr_rbig0", ago(47), [
      row("Started: Invoice 1044, Greene & Co, $7,900", 0, { icon: "bolt", tone: "muted" }),
      row("Greene & Co", 1),
      row("Tried to message you", 3, { icon: "retry", tone: "wait", retry: "Try 1 of 3, failed. Waited 5 s." }),
      { t: 17, body: "The message was refused", block: ["run.error", { detail: "Your chat did not accept it three times, so it stopped. It is held in your Needs you.", retry: "Try 3 of 3, failed.", step: "message" }] },
    ]),
    ...thread("thr_rm0", ago(30), [row("Started: the transcript for Kickoff call with Elena Rivera is ready", 0, { icon: "bolt", tone: "muted" }), row("Read 3,420 words", 2)]),
  ];
  const undo: Row[] = [{
    id: "rl3", runId: "rl3",
    undone: [{ eventId: "ev1", summary: "Created the lead record for Priya Nair" }, { eventId: "ev2", summary: "Filed the form answers on the record" }, { eventId: "ev3", summary: "Created a task for Omar Haddad" }],
    skipped: [{ eventId: "ev4", summary: "Text sent to +1 415 555 0142", reason: "sent" }],
  }];
  return { runs, steps, messages, undo };
}

function harborRows(): { runs: Row[]; steps: Row[]; messages: Row[]; undo: Row[] } {
  const mk = (id: string, status: Run["status"], name: string, at: number, summary: string, extra: Partial<Run> = {}): Row =>
    runRow({ id, auto: "aut_h1", owner: "usr_ines", status, name, startedAt: at, ...(status === "running" ? {} : { endedAt: at + 12_000 }), definitionVersion: 2, summary, threadId: `thr_${id}`, ...extra });
  const runs = [
    mk("rh1", "succeeded", "Moreno brief arrived", ago(26), "Succeeded, 3 steps, 12 s"),
    mk("rh2", "succeeded", "Okafor brief arrived", dayAt(1, 600), "Succeeded, 3 steps, 12 s"),
    mk("rh3", "failed", "Lindqvist brief arrived", dayAt(2, 300), "The project template is missing"),
  ];
  const messages = [
    ...thread("thr_rh1", ago(26), [row("Started: the Moreno brief was sent", 0, { icon: "inbox", tone: "muted" }), row("Made the project Moreno shoot", 4)]),
    ...thread("thr_rh3", dayAt(2, 300), [row("Started: the Lindqvist brief was sent", 0, { icon: "inbox", tone: "muted" }), { t: 6, body: "The project template is missing", block: ["run.error", { detail: "The Client project template was removed, so no project could be made.", retry: "Try 3 of 3, failed.", step: "project" }] }]),
  ];
  return { runs, steps: [], messages, undo: [] };
}

export interface SampleRuns {
  data: RunsData;
  replica: FakeReplica;
  space: RunsSpace;
  calls: { cap: string; input: unknown }[];
  opened: string[];
  failNext(cap: string): void;
}

export function createSampleRuns(space: RunsSpace = northwind): SampleRuns {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  const seed = space.id === "harbor" ? harborRows() : northwindRows();
  replica.put("runs", seed.runs);
  replica.put("steps", seed.steps);
  replica.put("messages", seed.messages);
  replica.put("undo", seed.undo);
  let nextId = 1;
  let nextMsg = 100;

  const runs = (): Row[] => replica.rows("runs");
  const find = (id: string): Row | undefined => runs().find((r) => r.id === id);
  const patch = (id: string, p: Record<string, unknown>): Row | undefined => {
    const cur = find(id);
    if (!cur) return undefined;
    const next = { ...cur, ...p } as Row;
    replica.put("runs", [next]);
    return next;
  };

  replica.resolve("runs.list", (_t, input) => {
    const sub = input.subject;
    const list = runs()
      .filter((r) => (sub ? (r["subject"] as { id?: string } | undefined)?.id === sub.id : true))
      .filter((r) => (input.statuses ? (input.statuses as string[]).includes(String(r["status"])) : true))
      .filter((r) => (input.kinds ? (input.kinds as string[]).includes(String(r["kind"])) : true))
      .sort((a, b) => Number(b["startedAt"]) - Number(a["startedAt"]));
    return { runs: list, total: list.length } as unknown as CapMap["runs.list"]["out"];
  });
  replica.resolve("runs.get", (_t, input) => ({ run: find(input.runId) as unknown as Run }) as CapMap["runs.get"]["out"]);
  replica.resolve("runs.steps", (_t, input) => {
    const rows = replica.rows("steps").filter((s) => s["runId"] === input.runId);
    return { steps: rows.map(({ id: _id, runId: _run, ...s }) => s) as unknown as RunStep[], total: rows.length } as CapMap["runs.steps"]["out"];
  });
  replica.resolve("runs.count", (_t, input) => ({ count: runs().filter((r) => (input.statuses ? (input.statuses as string[]).includes(String(r["status"])) : true)).length }) as CapMap["runs.count"]["out"]);
  replica.resolve("chat.messages.list", (_t, input) => {
    const rows = replica.rows("messages").filter((m) => m["threadId"] === input.threadId).sort((a, b) => Number(a["threadSeq"]) - Number(b["threadSeq"]));
    return { messages: rows as unknown as ThreadMessage[], hasMore: false } as CapMap["chat.messages.list"]["out"];
  });

  const writes: Record<string, (input: never) => unknown> = {
    "runs.retry": (i: { runId: string; fromStep?: string }) => {
      const old = find(i.runId);
      if (!old) throw new Error("no such run");
      const id = `rn${nextId++}`;
      replica.put("runs", [{ ...old, id, status: "running", parentRun: old.id, startedAt: SAMPLE_NOW, endedAt: undefined, summary: undefined, threadId: `thr_${id}`, traceId: `tr_${id}` } as unknown as Row]);
      return { runId: id };
    },
    "runs.stop": (i: { runId: string }) => { const r = patch(i.runId, { status: "stopped", endedAt: SAMPLE_NOW }); if (!r) throw new Error("no such run"); return { ok: true }; },
    "runs.preview_undo": (i: { runId: string }) => {
      const u = replica.rows("undo").find((x) => x["runId"] === i.runId);
      return (u ? { undone: u["undone"], skipped: u["skipped"] } : { undone: [], skipped: [] }) as UndoPreview;
    },
    "runs.undo": (i: { runId: string }) => {
      const u = replica.rows("undo").find((x) => x["runId"] === i.runId);
      replica.remove("undo", [i.runId]);
      return (u ? { undone: u["undone"], skipped: u["skipped"] } : { undone: [], skipped: [] }) as UndoPreview;
    },
    "runs.replay": (i: { runId: string; version?: string }) => {
      const old = find(i.runId);
      if (!old) throw new Error("no such run");
      const id = `rn${nextId++}`;
      replica.put("runs", [{ ...old, id, kind: "replay", status: "running", parentRun: old.id, startedAt: SAMPLE_NOW, threadId: `thr_${id}` } as unknown as Row]);
      return { runId: id };
    },
    "chat.post": (i: { threadId: string; body: string }) => {
      const seq = replica.rows("messages").filter((m) => m["threadId"] === i.threadId).length + 1;
      const id = `${i.threadId}_m${nextMsg++}`;
      replica.put("messages", [{ id, threadId: i.threadId, messageId: id, threadSeq: seq, author: { kind: "person", id: space.me.id }, kind: "text", body: i.body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: SAMPLE_NOW + seq * 1000 }]);
      return { ok: true };
    },
    "tasks.act": (i: { taskId: string; action: string }) => {
      const r = i.taskId === "tsk_ri1" ? find("ri1") : undefined;
      if (r) patch(r.id, i.action === "approve" ? { status: "running", waitReason: undefined } : { status: "stopped", endedAt: SAMPLE_NOW });
      return { ok: true };
    },
  };

  const base = createScreenHooks(replica, screensById);
  // the generated screen queries read route parameters ("/route/runId") and a subject pointer; the fake hooks resolve only "/state/...", so these are opened here with the values they were given
  const screens: ScreenHooks = {
    query(screenId, name, state = {}) {
      if (name === "run") return liveQuery(replica, "runs.get", { runId: String(state["runId"] ?? "") }) as LiveQuery<unknown>;
      if (name === "steps") return liveQuery(replica, "runs.steps", { runId: String(state["runId"] ?? "") }) as LiveQuery<unknown>;
      if (name === "runs") return liveQuery(replica, "runs.list", { scope: (state["scope"] as "mine" | "subject" | "owner" | "all" | undefined) ?? "mine", ...(state["subject"] ? { subject: state["subject"] } : {}), ...(state["statuses"] ? { statuses: state["statuses"] } : {}) } as CapMap["runs.list"]["in"]) as LiveQuery<unknown>;
      return base.query(screenId, name, state);
    },
  };
  const nav: RunsNav = {
    openAutomation: (id) => void opened.push(`automation:${id}`), openRun: (id) => void opened.push(`run:${id}`), openRunSide: (id) => void opened.push(`side:${id}`),
  };
  const data: RunsData = {
    screens,
    thread: (threadId) => liveQuery(replica, "chat.messages.list", { threadId }) as unknown as ReturnType<RunsData["thread"]>,
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (w) return w(input as never);
      const r = replica.run(cap as keyof CapMap, input as never);
      if (!r) throw new Error(`no handler for ${cap}`);
      return r.data;
    },
    me: space.me,
    name: (id) => space.names[id] ?? nameOf(space.id, id),
    nav,
    clock: () => ({ now: SAMPLE_NOW }),
  };
  return { data, replica, space, calls, opened, failNext: (cap) => void failing.add(cap) };
}

export { DAY, MIN };
