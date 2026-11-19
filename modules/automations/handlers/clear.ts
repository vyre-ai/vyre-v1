// Automations that explain themselves (rc.41): the sentence under each name, what an Automation is missing before anyone turns it on, how often it would have started last week, and why it did not
// run for one record. Every answer is worked out from the saved definition and the event log by the same code that starts Runs (explainMatch in triggers.ts), so the page never says something the engine
// would not do. Nothing here starts, sends or changes anything.
import { registry } from "../../../generated/registry.ts";
import { flowSentence, inRunOrder } from "../../../lib/flow-sentence.ts";
import { cap, fieldWord, namesFor, typeWord, valueWord, words } from "../names.ts";
import type { Names } from "../names.ts";
import { stepWords } from "../../../lib/words/steps.ts";
import {
  allAutomations,
  clean,
  findDraft,
  findRunByEvent,
  getAutomation,
  raise,
  readPolicy,
  versionDefinition,
} from "../projections.ts";
import type { AutoCtx, Automation, Definition, Node, TriggerRef } from "../projections.ts";
import { APP_STEPS, aiAccountIssues, canView, connectedApps, senderIssues, validateDefinition } from "./defs.ts";
import { dropReason, explainMatch } from "./triggers.ts";
import type { LoggedEvent, MatchCheck } from "./triggers.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TRIGGERS = new Map(registry.triggers.map((t) => [t.key, t] as const));
const STEP_TITLES = new Map(registry.steps.map((s) => [s.key, s.title] as const));
const WEEK = 7 * 86_400_000;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const an = (noun: string): string => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const orList = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

// ---- readiness: what is missing, before anyone presses Turn on ----

export interface Blocked {
  automationId?: string | undefined;
  nodeId?: string | undefined;
  /** a few words for a list row: "No mailbox" */ short: string;
  /** one sentence for the page: which step, and what is missing */ line: string;
  button: "Connect" | "Fix";
  fix: { kind: "ai_account" | "mailbox" | "number" | "connection" | "file" | "step"; connector?: string };
}

interface Seen {
  apps?: Promise<{ apps: Set<string>; checked: boolean }>;
  files: Map<string, Promise<boolean>>;
  mailboxes?: Promise<number | null>;
}
const APP_NAMES: Readonly<Record<string, string>> = { google: "Google", microsoft: "Microsoft", github: "GitHub" };

/** Is this file still there for the caller? A read that fails for any other reason says nothing: the step itself still checks. */
function fileThere(ctx: AutoCtx, seen: Seen, fileId: string): Promise<boolean> {
  let p = seen.files.get(fileId);
  if (!p) {
    p = ctx.call!("files.get", { fileId }).then(
      () => true,
      (e: unknown) => {
        const code = (e as { error?: { code?: string } } | null)?.error?.code ?? "";
        return !/not_found|no_grant/.test(code);
      },
    );
    seen.files.set(fileId, p);
  }
  return p;
}

/** How many mailboxes the caller could send or draft from; null when it cannot be read. */
function mailboxCount(ctx: AutoCtx, seen: Seen): Promise<number | null> {
  seen.mailboxes ??= ctx.call!("comms.senders.list", {}).then(
    (o) =>
      ((o as { senders?: { channel?: string }[] } | null)?.senders ?? []).filter((s) => s.channel === "email").length,
    () => null,
  );
  return seen.mailboxes;
}

const stepName = (def: Definition, n: Node): string => {
  const at = inRunOrder(def).findIndex((x) => x.id === n.id);
  return `Step ${at + 1}, ${stepWords(n, STEP_TITLES.get(n.key), at + 1).toLowerCase()}`;
};

/**
 * The first thing that would stop this definition when it is turned on or when it next runs, in the order a person can fix it: an AI account, a mailbox or number, an app that is not connected, a file
 * that is gone, then a step that is not finished. One thing, one button: the next shows when this one is done.
 */
export async function blockedOf(
  ctx: AutoCtx,
  kind: Automation["kind"],
  def: Definition,
  seen: Seen,
): Promise<Blocked | null> {
  if (!ctx.call || !Array.isArray(def?.nodes) || def.nodes.length === 0) return null;
  const node = (id: string | undefined): Node | undefined => def.nodes.find((n) => n.id === id);
  const said = (n: Node | undefined, what: string): string => (n ? `${stepName(def, n)}: ${what}` : cap(what));
  // 1. an AI step with nothing to run on
  if (def.nodes.some((n) => n.key === "ai")) {
    const ai = (await aiAccountIssues(ctx, kind, def).catch(() => []))[0];
    if (ai)
      return clean({
        nodeId: ai.nodeId,
        short: "No AI account",
        line: said(
          node(ai.nodeId),
          kind === "space"
            ? "no Space AI account pays for automations."
            : "you have no AI account that works on the server.",
        ),
        button: "Connect" as const,
        fix: { kind: "ai_account" as const },
      });
  }
  // 2. a step that sends or drafts with nothing to send from (a draft needs a mailbox to sit in, too)
  const drafts = def.nodes.filter((n) => n.key === "send_email" && n.input?.["draftOnly"] === true);
  const sender = (await senderIssues(ctx, def).catch(() => []))[0];
  if (sender) {
    const n = node(sender.nodeId);
    const text = n?.key === "send_sms";
    const none = /No (mailbox|texting number) is connected/.test(sender.message);
    return clean({
      nodeId: sender.nodeId,
      short: none
        ? text
          ? "No texting number"
          : "No mailbox"
        : text
          ? "The number cannot send"
          : "The mailbox cannot send",
      line: said(
        n,
        none ? (text ? "no texting number is connected." : "no mailbox is connected.") : lowerFirst(sender.message),
      ),
      button: none ? ("Connect" as const) : ("Fix" as const),
      fix: { kind: none ? (text ? ("number" as const) : ("mailbox" as const)) : ("step" as const) },
    });
  }
  if (drafts.length > 0 && (await mailboxCount(ctx, seen)) === 0)
    return {
      nodeId: drafts[0]!.id,
      short: "No mailbox",
      line: said(drafts[0], "no mailbox is connected, so there is nowhere to keep the draft."),
      button: "Connect",
      fix: { kind: "mailbox" },
    };
  // 3. a step of an app nobody connected
  const appStep = def.nodes.find((n) => APP_STEPS.some((a) => n.key.startsWith(a.start)));
  if (appStep) {
    seen.apps ??= connectedApps(ctx);
    const got = await seen.apps;
    for (const n of def.nodes) {
      const app = APP_STEPS.find((a) => n.key.startsWith(a.start));
      if (!app || !got.checked || got.apps.has(app.connector)) continue;
      const name = APP_NAMES[app.connector] ?? cap(app.connector);
      return {
        nodeId: n.id,
        short: `${name} is not connected`,
        line: said(n, `${name} is not connected.`),
        button: "Connect",
        fix: { kind: "connection", connector: app.connector },
      };
    }
  }
  // 4. a file a step names that is not there any more
  for (const n of def.nodes) {
    for (const [k, v] of Object.entries(n.input ?? {})) {
      if (!/fileId$/i.test(k) || typeof v !== "string" || !/^fil_[a-z0-9]+$/.test(v)) continue;
      if (!(await fileThere(ctx, seen, v)))
        return {
          nodeId: n.id,
          short: "A file is missing",
          line: said(n, "the file it uses is gone or you cannot open it."),
          button: "Fix",
          fix: { kind: "file" },
        };
    }
  }
  // 5. a step that is not finished
  const bad = validateDefinition(def, readPolicy(ctx.db)).find((i) => i.severity === "error");
  if (bad)
    return clean({
      nodeId: bad.nodeId,
      short: "A step is not finished",
      line: bad.message,
      button: "Fix" as const,
      fix: { kind: "step" as const },
    });
  return null;
}
const lowerFirst = (s: string): string => (s === "" ? s : s[0]!.toLowerCase() + s.slice(1));

/** What each Automation the caller can see is missing; for one Automation (or the draft on its page), what it is missing and its one sentence. */
export async function readiness(ctx: AutoCtx, input: In): Promise<unknown> {
  const seen: Seen = { files: new Map() };
  if (typeof input.automationId === "string") {
    const a = getAutomation(ctx, input.automationId);
    if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
    const def = (input.draft === true ? findDraft(ctx.db, a.id)?.definition : undefined) ?? a.definition;
    const b = await blockedOf(ctx, a.kind, def, seen).catch(() => null);
    return { blocked: b ? [{ ...b, automationId: a.id }] : [], sentence: flowSentence(def, await namesFor(ctx)) };
  }
  const blocked: Blocked[] = [];
  for (const a of allAutomations(ctx.db)
    .filter((x) => canView(ctx, x))
    .slice(0, 200)) {
    const b = await blockedOf(ctx, a.kind, a.definition, seen).catch(() => null);
    if (b) blocked.push({ ...b, automationId: a.id });
  }
  return { blocked };
}

// ---- the event log, read from a time on ----

interface EventRow {
  seq: number;
  id: string;
  type: string;
  at: number;
  actor?: string;
  origin?: string;
  depth?: number;
  payload: Record<string, unknown>;
}
const asLogged = (e: EventRow): LoggedEvent =>
  clean({
    id: e.id,
    type: e.type,
    payload: isRec(e.payload) ? e.payload : {},
    origin: e.origin,
    depth: e.depth,
  }) as LoggedEvent;

/**
 * Events of these kinds from a moment on, newest first. The log is read by position, so the position of that moment is found first (a handful of one-row reads), then only the events after it are read:
 * a Space with a year of history costs the same as one with a week.
 */
export async function eventsSince(
  ctx: AutoCtx,
  types: readonly string[],
  from: number,
  cap = 2000,
): Promise<{ events: EventRow[]; capped: boolean }> {
  if (!ctx.call || types.length === 0) return { events: [], capped: false };
  const since = async (
    after: number,
    limit: number,
    only?: readonly string[],
  ): Promise<{ events: EventRow[]; head: number; next: number }> => {
    const r = (await ctx.call!("events.since", { after, limit, ...(only ? { types: [...only] } : {}) })) as {
      events?: EventRow[];
      head?: number;
      next?: number;
    } | null;
    return { events: r?.events ?? [], head: r?.head ?? 0, next: r?.next ?? after };
  };
  let lo = 0;
  let hi = (await since(0, 1)).head;
  // the last position whose event is older than a day before `from` (a day of slack: an offline write lands late)
  const edge = from - 86_400_000;
  for (let i = 0; i < 40 && hi - lo > 64; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const one = (await since(mid, 1)).events[0];
    if (one && one.at < edge) lo = one.seq;
    else hi = mid;
  }
  const out: EventRow[] = [];
  let after = lo;
  let capped = false;
  for (;;) {
    const page = await since(after, 500, types);
    for (const e of page.events) if (e.at >= from) out.push(e);
    if (page.events.length < 500 || page.next <= after) break;
    after = page.next;
    if (out.length >= cap) {
      capped = true;
      break;
    }
  }
  return { events: out.sort((a, b) => b.at - a.at || b.seq - a.seq), capped };
}

const eventsOf = (ref: TriggerRef): string[] => {
  const src = TRIGGERS.get(ref.key)?.source as { event?: string; events?: string[] } | undefined;
  return src?.events ?? (src?.event ? [src.event] : []);
};

// ---- words for what a filter looked at ----

/** What happened, in the trigger's own terms: "A customer changed", "A form was submitted". */
function happened(ref: TriggerRef, ev: LoggedEvent, names: Names): string {
  if (ref.key === "record_change") {
    const type = typeWord(names, ev.payload["type"]);
    return `${cap(an(type))} ${ev.type === "record.created" ? "was added" : ev.type === "record.deleted" ? "was deleted" : "changed"}`;
  }
  return TRIGGERS.get(ref.key)?.title ?? cap(words(ref.key));
}

export interface CheckLine {
  ok: boolean;
  line: string;
  detail?: string | undefined;
}

/** One filter check as a line a person reads: what the Automation waits for, and when it did not hold, what was there instead. */
export function checkLine(c: MatchCheck, ev: LoggedEvent, names: Names): CheckLine {
  const type = ev.payload["type"];
  const made = ev.type === "record.created";
  if (c.key === "type")
    return clean({
      ok: c.ok,
      line: `It is ${an(typeWord(names, c.want))}`,
      detail: c.ok ? undefined : `It is ${an(typeWord(names, c.got))}.`,
    });
  if (c.key === "op") {
    const want =
      c.want === "created" ? "It was just added" : c.want === "deleted" ? "It was deleted" : "It was changed";
    const got =
      c.got === "created"
        ? "It was just added."
        : c.got === "deleted"
          ? "It was deleted."
          : "It was changed, not added.";
    return clean({ ok: c.ok, line: want, detail: c.ok ? undefined : got });
  }
  if (c.key === "fields") {
    const want = (Array.isArray(c.want) ? c.want : []).map((k) => fieldWord(names, type, String(k)));
    const got = (Array.isArray(c.got) ? c.got : []).map((k) => fieldWord(names, type, String(k)));
    return clean({
      ok: c.ok,
      line: `${cap(orList(want))} ${made ? "is set" : "changed"}`,
      detail: c.ok
        ? undefined
        : got.length > 0
          ? `This change was to ${got.slice(0, 3).join(", ")}.`
          : "Nothing it watches changed.",
    });
  }
  const field = c.key === "where" ? fieldWord(names, type, c.field ?? "") : cap(words(c.field ?? ""));
  const want = valueWord(names, type, c.field ?? "", c.want);
  const line = c.key === "where" && !made ? `${field} becomes ${want}` : `${field} is ${want}`;
  if (c.ok) return { ok: true, line };
  const got = valueWord(names, type, c.field ?? "", c.got);
  return {
    ok: false,
    line,
    detail:
      c.got === undefined
        ? `${field} did not change.`
        : c.key === "where" && !made
          ? `It became ${got}.`
          : `It is ${got}.`,
  };
}

// ---- last week: how often would it have started ----

interface TitleCache {
  by: Map<string, Promise<string | undefined>>;
}
/** A record's own name, as its type names it. Nothing when the caller cannot read it. */
function titleOf(
  ctx: AutoCtx,
  names: Names,
  cache: TitleCache,
  type: unknown,
  recordId: unknown,
  fallback?: unknown,
): Promise<string | undefined> {
  if (typeof type !== "string" || typeof recordId !== "string" || !ctx.call) return Promise.resolve(undefined);
  let p = cache.by.get(recordId);
  if (!p) {
    const key = names.types.get(type)?.titleField ?? "name";
    const fromFields = (f: unknown): string | undefined =>
      isRec(f) && typeof f[key] === "string" && f[key] !== "" ? (f[key] as string) : undefined;
    p = ctx.call("records.get", { type, recordId }).then(
      (r) => fromFields((r as { record?: { fields?: unknown } } | null)?.record?.fields) ?? fromFields(fallback),
      () => fromFields(fallback),
    );
    cache.by.set(recordId, p);
  }
  return p;
}

/** What one event is called in a list: the record's name for a record change, else what happened. */
async function eventName(ctx: AutoCtx, names: Names, cache: TitleCache, ref: TriggerRef, e: EventRow): Promise<string> {
  const p = e.payload;
  const title = await titleOf(ctx, names, cache, p["type"], p["recordId"], {
    ...(isRec(p["prev"]) ? p["prev"] : {}),
    ...(isRec(p["fields"]) ? p["fields"] : {}),
  });
  if (title) return title;
  if (typeof p["subject"] === "string" && p["subject"] !== "") return p["subject"];
  return happened(ref, asLogged(e), names);
}

/** What changed, in a few words: "Stage became Signed", "Added", "Owner and 2 more changed". */
export function changeWords(e: Pick<EventRow, "type" | "payload">, names: Names): string {
  if (e.type === "record.created") return "Added";
  if (e.type === "record.deleted") return "Deleted";
  if (e.type !== "record.updated") return cap(words(e.type.split(".").slice(-1)[0] ?? e.type));
  const type = e.payload["type"];
  const fields = isRec(e.payload["fields"]) ? Object.entries(e.payload["fields"]) : [];
  if (fields.length === 0) return "Changed";
  const [k, v] = fields[0]!;
  const one = `${fieldWord(names, type, k)} became ${valueWord(names, type, k, isRec(v) && typeof v["sealed"] === "string" ? "hidden" : v)}`;
  if (fields.length === 1) return one.length > 60 ? `${fieldWord(names, type, k)} changed` : one;
  return `${fieldWord(names, type, k)} and ${fields.length - 1} more changed`;
}

/**
 * How often this Automation (or the draft on its page) would have started in the last week, read from what really happened: every event of the kind its trigger listens for, each put through the
 * trigger's own filter. Nothing runs. A trigger that no event starts (a schedule, a button, a web request) has no answer here.
 */
export async function wouldRun(ctx: AutoCtx, input: In): Promise<unknown> {
  const a = getAutomation(ctx, input.automationId);
  if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
  const def = (input.draft === true ? findDraft(ctx.db, a.id)?.definition : undefined) ?? a.definition;
  const refs = def.triggers.filter((t) => eventsOf(t).length > 0);
  if (refs.length === 0) return { supported: false, days: 7, n: 0, of: 0, capped: false, starts: [] };
  const names = await namesFor(ctx);
  const kinds = [...new Set(refs.flatMap(eventsOf))];
  const { events, capped } = await eventsSince(ctx, kinds, ctx.now() - WEEK);
  const cache: TitleCache = { by: new Map() };
  let n = 0;
  let of = 0;
  const starts: Record<string, unknown>[] = [];
  for (const e of events) {
    const ev = asLogged(e);
    // the first trigger that listens for it and whose record type it is; a change to another type is not one of "its" events
    let best: { ref: TriggerRef; ok: boolean; why?: CheckLine | undefined } | undefined;
    for (const ref of refs) {
      const m = explainMatch(ref, ev);
      if (!m.listens) continue;
      const last = m.checks[m.checks.length - 1];
      if (!m.ok && last && last.key === "type") continue;
      const why = !m.ok
        ? last
          ? checkLine(last, ev, names)
          : { ok: false, line: "Its filter could not be read" }
        : undefined;
      if (!best || (m.ok && !best.ok)) best = clean({ ref, ok: m.ok && !m.error, why });
      if (m.ok) break;
    }
    if (!best) continue;
    of += 1;
    if (best.ok) n += 1;
    if (starts.length < 60)
      starts.push(
        clean({
          eventId: e.id,
          at: e.at,
          starts: best.ok,
          name: await eventName(ctx, names, cache, best.ref, e),
          change: changeWords(e, names),
          why: best.ok ? undefined : (best.why?.detail ?? best.why?.line),
          recordId: typeof e.payload["recordId"] === "string" ? e.payload["recordId"] : undefined,
          type: typeof e.payload["type"] === "string" ? e.payload["type"] : undefined,
        }),
      );
  }
  const first = refs[0]!;
  const type = isRec(first.filter) ? first.filter["type"] : undefined;
  return clean({
    supported: true,
    days: 7,
    n,
    of,
    capped,
    // what the "of" counts, in words: "changes to Customers", "forms submitted"
    what:
      first.key === "record_change"
        ? `changes to ${typeof type === "string" ? cap(names.plural(type)) : "records"}`
        : `times ${lowerFirst(TRIGGERS.get(first.key)?.title ?? "it happened")}`,
    noun: first.key === "record_change" ? typeWord(names, type) : undefined,
    // for "Find a customer": the type to search and the field its records are named by
    recordType: first.key === "record_change" && typeof type === "string" ? type : undefined,
    titleField:
      first.key === "record_change" && typeof type === "string"
        ? (names.types.get(type)?.titleField ?? "name")
        : undefined,
    starts,
  });
}

// ---- why didn't this run? ----

type Verdict = "not_started" | "stopped" | "failed" | "waiting" | "running" | "ran" | "off";
const VERDICT_ORDER: Verdict[] = ["not_started", "stopped", "failed", "waiting", "running", "ran", "off"];

interface StepRow {
  step: string;
  state: string;
  error?: { message?: string };
  startedAt?: number;
}

/** What became of the Run an event started: how far it got and what stopped it, from the Run's own step log. */
async function runStory(
  ctx: AutoCtx,
  a: Automation,
  runId: string,
  version: number,
): Promise<{ verdict: Verdict; line: string; checks: CheckLine[] }> {
  const def = versionDefinition(ctx.db, a.id, version) ?? a.definition;
  const order = inRunOrder(def);
  const numberOf = (id: string): number => order.findIndex((n) => n.id === id) + 1;
  const nameOf = (id: string): string => {
    const n = order.find((x) => x.id === id);
    return n ? stepWords(n, STEP_TITLES.get(n.key), numberOf(id)) : "A step";
  };
  let status = "running";
  let steps: StepRow[] = [];
  try {
    status = ((await ctx.call!("runs.get", { runId })) as { run?: { status?: string } } | null)?.run?.status ?? status;
    steps = ((await ctx.call!("runs.steps", { runId, limit: 500 })) as { steps?: StepRow[] } | null)?.steps ?? [];
  } catch {
    return { verdict: "ran", line: "Started", checks: [{ ok: true, line: "It started a run" }] };
  }
  // the newest row of each step, in the order they ran
  const latest = new Map<string, StepRow>();
  for (const s of steps) latest.set(s.step, s);
  const ran = [...latest.values()].filter((s) => order.some((n) => n.id === s.step));
  const done = ran.filter((s) => s.state === "succeeded").length;
  const total = order.length;
  const started: CheckLine = { ok: true, line: "It started a run" };
  const failed = ran.find((s) => s.state === "failed");
  if (status === "failed" || failed) {
    const at = failed ?? ran[ran.length - 1];
    const n = at ? numberOf(at.step) : 0;
    return {
      verdict: "failed",
      line: n > 0 ? `Failed at step ${n}` : "Failed",
      checks: [
        started,
        clean({
          ok: false,
          line: at ? `Step ${n}, ${nameOf(at.step).toLowerCase()}` : "A step failed",
          detail: at?.error?.message,
        }),
      ],
    };
  }
  if (status === "waiting" || status === "queued" || status === "running") {
    const at = ran.find((s) => s.state === "waiting" || s.state === "running") ?? ran[ran.length - 1];
    const n = at ? numberOf(at.step) : 0;
    const waiting = status === "waiting";
    return {
      verdict: waiting ? "waiting" : "running",
      line: waiting ? (n > 0 ? `Waiting at step ${n}` : "Waiting") : "Running now",
      checks: [
        started,
        {
          ok: true,
          line: at ? `Step ${n}, ${nameOf(at.step).toLowerCase()}` : "It is on its way",
          detail: waiting ? "It is waiting here, for a person or for a time." : "It is running now.",
        },
      ],
    };
  }
  if (status === "stopped" || status === "cancelled")
    return {
      verdict: "stopped",
      line: "Stopped by a person",
      checks: [started, { ok: false, line: `${done} of ${total} steps ran`, detail: "Someone stopped this run." }],
    };
  // finished: did it reach the end, or did a step end it early?
  const lastRan = ran[ran.length - 1];
  const lastNode = lastRan ? order.find((n) => n.id === lastRan.step) : undefined;
  if (lastNode && done < total && ["if", "paths", "stop", "loop"].includes(lastNode.key)) {
    const n = numberOf(lastNode.id);
    return {
      verdict: "stopped",
      line: `Stopped at step ${n}`,
      checks: [
        started,
        {
          ok: false,
          line: `Step ${n}, ${nameOf(lastNode.id).toLowerCase()}`,
          detail:
            lastNode.key === "stop"
              ? "The steps say to stop here."
              : "It took the path that ends here, so the steps after it did not run.",
        },
      ],
    };
  }
  return {
    verdict: "ran",
    line: "Ran",
    checks: [
      started,
      {
        ok: true,
        line:
          done >= total ? (total === 1 ? "Its step ran" : `All ${total} steps ran`) : `${done} of ${total} steps ran`,
      },
    ],
  };
}

const DROP_WORDS: Readonly<Record<string, string>> = {
  self_trigger: "It made this change itself, and an automation does not start itself again.",
  depth_limit: "This change came at the end of a long chain of automations, and the chain stops there.",
  filter_error: "Its filter cannot be read. Open it and choose what starts it again.",
  outsider: "The change was made by a guest, and a guest does not start automations.",
};

/**
 * For one record and one thing that happened to it: every Automation that watches that kind of record, and what became of each. Did not start (and the check that stopped it), stopped or failed at a
 * step, waiting, ran, or off. The checks are the trigger's own filter read by the code that starts Runs; the rest is the Run's own log.
 */
export async function whyNot(ctx: AutoCtx, input: In): Promise<unknown> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "This is not available right now.");
  const names = await namesFor(ctx);
  const got = (await ctx
    .call("records.get", { ...(input.type ? { type: input.type } : {}), recordId: input.recordId })
    .catch(() => null)) as {
    record?: { type?: string; fields?: Record<string, unknown> };
  } | null;
  const type =
    typeof got?.record?.type === "string" ? got.record.type : typeof input.type === "string" ? input.type : undefined;
  const titleField = type ? (names.types.get(type)?.titleField ?? "name") : "name";
  const title =
    typeof got?.record?.fields?.[titleField] === "string" ? (got.record.fields[titleField] as string) : undefined;
  // what happened to this record, newest first
  const kinds = [...new Set(registry.triggers.flatMap((t) => eventsOf({ key: t.key } as TriggerRef)))];
  const page = (await ctx
    .call("events.list", { subject: { type: "record", id: input.recordId }, limit: 500 })
    .catch(() => null)) as {
    events?: EventRow[];
  } | null;
  const all = (page?.events ?? []).filter((e) => kinds.includes(e.type)).sort((x, y) => y.at - x.at || y.seq - x.seq);
  const changes = all
    .slice(0, 12)
    .map((e) => clean({ eventId: e.id, at: e.at, line: changeWords(e, names), by: e.actor }));
  const chosen = (typeof input.eventId === "string" ? all.find((e) => e.id === input.eventId) : undefined) ?? all[0];
  const record = clean({
    id: input.recordId as string,
    type,
    typeName: type ? cap(typeWord(names, type)) : undefined,
    typePlural: type ? cap(names.plural(type)) : undefined,
    title,
  });
  if (!chosen) return { record, changes: [], automations: [] };
  const ev = asLogged(chosen);
  const policy = readPolicy(ctx.db);
  const rows: { order: number; row: Record<string, unknown> }[] = [];
  for (const a of allAutomations(ctx.db)) {
    if (!canView(ctx, a)) continue;
    // the trigger of this Automation that listens for what happened, on this record's type
    let pick: { ref: TriggerRef; m: ReturnType<typeof explainMatch> } | undefined;
    for (const ref of a.definition.triggers) {
      const m = explainMatch(ref, ev);
      if (!m.listens) continue;
      const last = m.checks[m.checks.length - 1];
      if (!m.ok && last?.key === "type") continue;
      if (!pick || (m.ok && !pick.m.ok)) pick = { ref, m };
    }
    if (!pick) continue;
    const checks: CheckLine[] = [
      { ok: true, line: happened(pick.ref, ev, names) },
      ...pick.m.checks.filter((c) => c.key !== "type").map((c) => checkLine(c, ev, names)),
    ];
    let verdict: Verdict;
    let line: string;
    let runId: string | undefined;
    const link = findRunByEvent(ctx.db, a.id, chosen.id);
    if (link) {
      const s = await runStory(ctx, a, link.runId, link.version);
      verdict = s.verdict;
      line = s.line;
      runId = link.runId;
      checks.push(...s.checks);
    } else if (pick.m.error) {
      verdict = "not_started";
      line = "Did not start";
      checks.push({ ok: false, line: "Its filter", detail: DROP_WORDS["filter_error"]! });
    } else if (!pick.m.ok) {
      verdict = "not_started";
      line = "Did not start";
    } else if (a.status !== "on") {
      verdict = "off";
      line = a.status === "paused" ? "Paused" : "Off";
      checks.push({
        ok: false,
        line: a.status === "paused" ? "It is paused" : "It is off",
        detail:
          a.status === "paused"
            ? (a.pausedReason ?? "Turn it back on to let it run.")
            : a.status === "draft"
              ? "It has never been turned on."
              : "Turn it on to let it run.",
      });
    } else {
      const drop = dropReason(a, pick.ref, clean({ origin: chosen.origin, depth: chosen.depth ?? 0 }), policy);
      verdict = "not_started";
      line = "Did not start";
      checks.push({
        ok: false,
        line: "It did not start a run",
        detail:
          drop && DROP_WORDS[drop]
            ? DROP_WORDS[drop]!
            : a.updatedAt > chosen.at
              ? "It was turned on or changed after this happened."
              : "No run was kept for this. It may have been off at the time.",
      });
    }
    rows.push({
      order: VERDICT_ORDER.indexOf(verdict),
      row: clean({ automationId: a.id, name: a.name, status: a.status, verdict, line, checks, runId }),
    });
  }
  rows.sort((x, y) => x.order - y.order || String(x.row["name"]).localeCompare(String(y.row["name"])));
  return { record, changes, eventId: chosen.id, automations: rows.map((r) => r.row) };
}


/**
 * The Automations that already start on a Journey's stages without belonging to it (rc.41): one that watches a change of the type's stage field (or a record entering a Journey stage) and is not among the stages' members.
 * The Path page offers each under the stage it listens for, with one press to add it. A listing is read only, and an Automation that names no one stage is offered nowhere.
 */
export async function stageOffers(ctx: AutoCtx, input: In): Promise<unknown> {
  const type = String(input.recordType);
  const field = typeof input.stageField === "string" && input.stageField ? input.stageField : "stage";
  const members = new Set<string>(Array.isArray(input.members) ? (input.members as string[]) : []);
  const stages = new Set<string>(Array.isArray(input.stages) ? (input.stages as string[]) : []);
  const offers: { automationId: string; name: string; stage: string; on: boolean }[] = [];
  for (const a of allAutomations(ctx.db)) {
    if (members.has(a.id) || a.kind !== "space") continue;
    for (const t of a.definition.triggers) {
      const f = (t.filter ?? {}) as { type?: unknown; fields?: unknown; where?: Record<string, unknown>; stage?: unknown };
      let stage: unknown;
      if (t.key === "record_change" && f.type === type) {
        const watches = Array.isArray(f.fields) ? f.fields.includes(field) : f.where !== undefined && field in f.where;
        if (watches) stage = f.where?.[field];
      } else if (t.key === "journey_stage_entered") stage = f.stage;
      if (typeof stage === "string" && stages.has(stage)) {
        offers.push({ automationId: a.id, name: a.name, stage, on: a.status === "on" });
        break;
      }
    }
  }
  return { offers };
}
