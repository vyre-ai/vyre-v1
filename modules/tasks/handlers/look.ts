// The daily look (lane r42-alive, living tasks). Once a day, at most 20 unclear tasks of the Space (about 60 tokens each) go to the cheapest model the Space's own AI accounts allow, in ONE call. The model may only
// propose two things: "ask about this" or "this looks done". "Done" counts only with a quoted line from a named, later message in the task's own chat that really says it. Nothing here ever archives or closes
// a task: a proposal puts the task on the Still need these card, where a person answers. No Space AI account, or tidy or the look switched off: the rules alone run and nothing is called.
// Privacy: off by default; only chats every person on the task can read are read, never an Ask pane, helper, run or encrypted message, and a quote is shown only for such a chat.
// Cost is never a guess: every run writes its model and tokens to tasks_look_log.
import { cheapestModel } from "../../../lib/cheap-model.ts";
import type { ListedModel } from "../../../lib/cheap-model.ts";
import { NOT_ARCHIVED, allTasks, readPolicy } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";
import { cannotArchive } from "./archive.ts";
import { NOT_ASKED, putOnCard } from "./still.ts";

const DAY = 86_400_000;
export const LOOK_MAX = 20;
export const LOOK_EVERY_MS = DAY;
const SEEN_AGAIN_MS = 14 * DAY;
const UNCLEAR_AFTER_MS = 7 * DAY;

export interface Seen {
  id: string;
  kind: string;
  title: string;
  ageDays: number;
  source: string;
  lines: { id: string; at: number; text: string }[];
}
export interface Asked {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}
/** What the look needs from outside, so a test can stand a model in: one ask, and one message read. */
export interface LookDeps {
  /** a Space AI account and a cheap model exist: checked first, so a Space without one costs no chat reads */
  ready(): Promise<boolean>;
  ask(system: string, prompt: string): Promise<Asked | null>;
  /** one message of a chat, with who wrote it; null when it is encrypted or cannot be read */
  message(threadId: string, messageId: string): Promise<{ body: string; at: number; by: string } | null>;
  recent(threadId: string): Promise<{ id: string; at: number; text: string }[]>;
  /** the chat is an ordinary shared one (not an Ask pane, a helper, a run or a console) and every one of these people is in it */
  readable(threadId: string, people: readonly string[]): Promise<boolean>;
}

const SYSTEM =
  'You help keep a task list honest. For each task you are shown, decide whether to say nothing, to ask the owner if it still matters ("ask"), or to say it looks done ("done"). Say "done" only if one of the shown messages of that task states it is finished, and then give that message\'s id and copy the words that say so exactly. Reply with a JSON array and nothing else: [{"id":"tsk_..","say":"ask","why":"at most 8 plain words"},{"id":"tsk_..","say":"done","message":"msg_..","quote":"the exact words"}]. Leave a task out when unsure.';

const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const one = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The tasks worth a look today: open, untouched a week, not already asked or kept, not looked at lately, nothing waiting on them, nothing coming. At most LOOK_MAX, the longest untouched first. */
export function candidates(ctx: TasksCtx): Task[] {
  const now = ctx.now();
  const out: Task[] = [];
  for (const t of allTasks(
    ctx.db,
    `c.state NOT IN ('done', 'canceled') AND ${NOT_ARCHIVED} AND c.updated_at <= ? ${NOT_ASKED} AND NOT EXISTS (SELECT 1 FROM tasks_look_seen s WHERE s.task_id = c.id AND s.at > ?) ORDER BY c.updated_at`,
    now - UNCLEAR_AFTER_MS,
    now,
    now - SEEN_AGAIN_MS,
  )) {
    if (t.snoozedUntil !== undefined && t.snoozedUntil > now) continue;
    if (t.due !== undefined && t.due > now) continue;
    if (cannotArchive(ctx, t) !== null) continue;
    out.push(t);
    if (out.length >= LOOK_MAX) break;
  }
  return out;
}

/** The chat a task lives in, if any. */
export const threadOf = (t: Task): string | undefined =>
  t.threadId ?? (t.source?.kind === "chat" ? t.source.id : undefined);
/** The people on a task: the slots that are people, and who made it if a person. */
export function peopleOn(t: Task): string[] {
  const ids = [t.assigned, t.reviewer, t.approver].flatMap((a) => (a && a.kind === "person" ? [a.id] : []));
  if (t.createdBy.startsWith("usr_")) ids.push(t.createdBy);
  return [...new Set(ids)];
}

async function describe(ctx: TasksCtx, deps: LookDeps, t: Task): Promise<Seen> {
  const thread = threadOf(t);
  // the words of a chat go to the model only when everyone on the task can read that chat
  const open = thread ? await deps.readable(thread, peopleOn(t)).catch(() => false) : false;
  const lines = thread && open ? (await deps.recent(thread).catch(() => [])).slice(-2) : [];
  return {
    id: t.id,
    kind: t.kind,
    title: cut(one(t.title), 80),
    ageDays: Math.floor((ctx.now() - t.updatedAt) / DAY),
    source: t.source ? t.source.kind : "manual",
    lines: lines.map((l) => ({ id: l.id, at: l.at, text: cut(one(l.text), 120) })),
  };
}

/** The prompt: one short block per task. */
export function promptOf(seen: readonly Seen[]): string {
  return seen
    .map(
      (s) =>
        `${s.id} | ${s.kind} | ${s.title} | untouched ${s.ageDays} days | from ${s.source}` +
        s.lines.map((l) => `\n  ${l.id}: ${l.text}`).join(""),
    )
    .join("\n");
}

type Proposal = { id: string; say: "ask" | "done"; why?: string; message?: string; quote?: string };

/** The model's answer as proposals; anything that is not the asked shape is dropped. */
export function parse(text: string): Proposal[] {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Proposal[] = [];
  for (const r of raw.slice(0, LOOK_MAX * 2)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o["id"] !== "string" || (o["say"] !== "ask" && o["say"] !== "done")) continue;
    out.push({
      id: o["id"],
      say: o["say"],
      ...(typeof o["why"] === "string" ? { why: o["why"] } : {}),
      ...(typeof o["message"] === "string" ? { message: o["message"] } : {}),
      ...(typeof o["quote"] === "string" ? { quote: o["quote"] } : {}),
    });
  }
  return out;
}

/**
 * One run, given a model. Returns false when it did nothing (not due, off, no tasks, no model answer). Each proposal is checked: "ask" needs only the task; "done" needs the named message to be in the task's own
 * chat, later than the task, and to contain the quote word for word. A rejected "done" is dropped, never turned into anything. A proposal puts the task on the card with a short line a person reads.
 */
export async function lookOnce(
  ctx: TasksCtx,
  deps: LookDeps,
): Promise<{ ran: boolean; asked: number; done: number; rejected: number }> {
  const none = { ran: false, asked: 0, done: 0, rejected: 0 };
  const policy = readPolicy(ctx.db);
  if (!policy.tidy || !policy.assistantLook) return none;
  const now = ctx.now();
  if (!(await deps.ready().catch(() => false))) return none; // no account or model: not one chat read is made
  const last = ctx.db.all("SELECT MAX(at) AS at FROM tasks_look_log")[0] as { at?: number | null } | undefined;
  if (last?.at != null && now - last.at < LOOK_EVERY_MS) return none;
  const tasks = candidates(ctx);
  if (tasks.length === 0) return none;
  const seen = await Promise.all(tasks.map((t) => describe(ctx, deps, t)));
  const answer = await deps.ask(SYSTEM, promptOf(seen)).catch(() => null);
  if (!answer) return none; // no account, no model, or the call failed: nothing is logged as a run, the rules alone carry on, tried again next pass
  for (const t of tasks) ctx.db.run("INSERT OR REPLACE INTO tasks_look_seen (task_id, at) VALUES (?, ?)", t.id, now);
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  let asked = 0,
    done = 0,
    rejected = 0;
  for (const p of parse(answer.text)) {
    const t = byId.get(p.id);
    if (!t) {
      rejected += 1;
      continue;
    }
    if (p.say === "ask") {
      // what the model wrote is shown as plain words under the task and never as a "looks done": one line, cut
      if (putOnCard(ctx, t, cut(one(p.why ?? "Might be finished."), 50))) asked += 1;
      continue;
    }
    const thread = threadOf(t);
    const open = thread ? await deps.readable(thread, peopleOn(t)).catch(() => false) : false;
    const msg = thread && open && p.message && p.quote ? await deps.message(thread, p.message).catch(() => null) : null;
    const quote = one(p.quote ?? "");
    // a real message of the task's own chat, written after the task last moved, that says those words
    if (!msg || quote.length < 8 || msg.at <= t.updatedAt || msg.at <= t.createdAt || !one(msg.body).includes(quote)) {
      rejected += 1;
      continue;
    }
    if (putOnCard(ctx, t, "Looks done", { quote: cut(quote, 120), by: msg.by, at: msg.at })) done += 1;
  }
  ctx.db.run(
    "INSERT INTO tasks_look_log (at, model, tasks, asked, done, rejected, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    now,
    answer.model,
    tasks.length,
    asked,
    done,
    rejected,
    answer.tokensIn,
    answer.tokensOut,
  );
  return { ran: true, asked, done, rejected };
}

type AccountRow = { ref: string; driver: string; kind: string; status: string; spaceKey?: boolean; mine?: boolean };

/** The real model and chat, through the capabilities every module may call: the cheapest model of the first working Space AI account that is not someone's own. */
export function realDeps(ctx: TasksCtx): LookDeps | null {
  const call = ctx.call;
  if (!call) return null;
  const pick = async (): Promise<{ account: AccountRow; model: string } | null> => {
    const accounts = (
      (await call("engine.accounts.list", { place: "space", runsAs: "space" })) as { accounts?: AccountRow[] }
    ).accounts;
    const account = (accounts ?? []).find((a) => a.mine !== true && a.status === "ok" && a.kind === "api_key");
    if (!account) return null;
    const listed =
      ((await call("engine.models.list", { accountRef: account.ref, probe: false })) as { models?: ListedModel[] })
        .models ?? [];
    const model = cheapestModel(account.driver, listed);
    return model ? { account, model } : null;
  };
  return {
    async ready() {
      return (await pick()) !== null;
    },
    async readable(threadId, people) {
      const r = (await call("threads.get", { threadId })) as { thread?: { kind: string; members: { id: string }[] } };
      const th = r.thread;
      if (!th || !["chat", "channel", "thread"].includes(th.kind)) return false;
      const here = new Set(th.members.map((m) => m.id));
      return people.length > 0 && people.every((p) => here.has(p));
    },
    async ask(system, prompt) {
      const chosen = await pick();
      if (!chosen) return null;
      const { account, model } = chosen;
      const r = (await call("engine.complete", { accountRef: account.ref, model, system, prompt })) as {
        text?: string;
        tokensIn?: number;
        tokensOut?: number;
      };
      return {
        text: String(r.text ?? ""),
        model,
        tokensIn: Number(r.tokensIn ?? 0),
        tokensOut: Number(r.tokensOut ?? 0),
      };
    },
    async message(threadId, messageId) {
      const r = (await call("chat.message.get", { threadId, messageId })) as {
        message?: { body: string; createdAt: number; enc?: number; author?: { id?: string } };
      };
      const m = r.message;
      return m && !m.enc ? { body: m.body, at: m.createdAt, by: String(m.author?.id ?? "") } : null;
    },
    async recent(threadId) {
      const r = (await call("chat.messages.list", { threadId, limit: 3 })) as {
        messages?: { messageId: string; body: string; createdAt: number; kind: string; enc?: number }[];
      };
      return (r.messages ?? [])
        .filter((m) => m.kind !== "system" && !m.enc)
        .map((m) => ({ id: m.messageId, at: m.createdAt, text: m.body }));
    },
  };
}

/** The periodic job: once a day, when due. */
export async function lookDaily(ctx: TasksCtx): Promise<unknown> {
  const deps = realDeps(ctx);
  return deps ? lookOnce(ctx, deps) : { ran: false };
}
