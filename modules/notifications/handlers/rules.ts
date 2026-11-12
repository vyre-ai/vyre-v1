// Notification rules (spec 2.24): the levels, collapse, the agent interrupt cap, working hours, mutes, away and delegates, the lists and counts, and the digest collector.
// notifications.send is the one door: it decides the level a notification lands at (kind default, then away, hours, the 3 an hour agent cap), collapses repeats into one row, and
// asks push.ts to deliver an Interrupt. Everything is per person; a caller reads and changes only their own settings.
import { makeId } from "../../../packages/contracts/src/ids.ts";
import {
  NOT_SENT_KINDS,
  AGENT_INTERRUPTS_PER_HOUR, COLLAPSE_WINDOW_MS, DIRECT_KINDS, HOUR, KINDS, NEEDS_YOU_KINDS, UNMUTABLE_KINDS, activeMutes, clean, isMuted, isService, kindOf, meOf, outRow,
  raise, readAway, readChain, readRules, render, rowOf, sourcesOf, withinHours, writeRules,
} from "../projections.ts";
import type { Delegate, Hours, KindDef, Level, NotifCtx, ResourceRef, Row, Target } from "../projections.ts";
import { deliverPush, pushPort } from "./push.ts";
import type { NoticeEmail } from "./push.ts";
import { levelOverride, readChoice } from "./kinds.ts";
import { alertLevel, heldByQuiet, readSettings, scheduleQuietSummary } from "./deliver.ts";

/** The title of a reply.thread row that holds more than one reply. */
const REPLIES_TITLE = "{{count}} new replies in {{where}}";
const RANK: Record<Level, number> = { digest: 0, badge: 1, interrupt: 2 };
/** In the contract's kind enum: a kind outside it can be neither sent nor listed. */
const LISTED = KINDS.filter((k) => k.key !== "vault.rotation_due");

interface SendIn {
  to: string; kind: string; subject?: ResourceRef; data?: Record<string, unknown>; title?: string; body?: string; collapseKey?: string; runId?: string;
}
type Outcome = "interrupt" | "badge" | "digest" | "dropped_muted" | "capped";

/** The level a notification lands at: the kind's own, raised by Alerts, lowered by away, working hours and quiet hours. `quietEnd` is set when quiet hours held it. */
function levelFor(ctx: NotifCtx, def: KindDef, person: string, urgent: boolean): { level: Level; quietEnd?: number } {
  const settings = readSettings(ctx.db, person);
  let level = alertLevel(def, levelOverride(ctx.db, person, def), settings, readChoice(ctx.db, person, def.key) !== undefined);   // my own choice for the kind (kind.set_level) wins over the Alerts setting
  if (level !== "interrupt") return { level };
  if (readAway(ctx.db, person, ctx.now()) && def.key !== "call.incoming") return { level: "digest" };   // while away only calls interrupt
  const rules = readRules(ctx.db, person);
  if (def.respectHours && !urgent && !withinHours(rules.workingHours, ctx.now())) return { level: "badge" };
  const quietEnd = heldByQuiet(def, level, settings, rules.workingHours?.tz ?? "UTC", ctx.now(), NEEDS_YOU_KINDS.has(def.key));
  if (quietEnd !== undefined) return { level: "digest", quietEnd };
  return { level };
}

/** The notifications.send capability: what an agent, a module or the schedule asks for. A kind nothing files and nobody can switch off is refused (NOT_SENT_KINDS). */
export async function sendCap(ctx: NotifCtx, input: SendIn): Promise<{ outcome: Outcome; notificationId?: string }> {
  if (NOT_SENT_KINDS.has(input.kind)) raise(ctx, "validation.bad_input", "That kind of notification is Vyre's own and is not sent this way. Use a direct message or a task instead.", { errors: ["/kind: not sent"] });
  return send(ctx, input);
}

/** notifications.send. */
export async function send(ctx: NotifCtx, input: SendIn, handed = false): Promise<{ outcome: Outcome; notificationId?: string }> {
  const r = await sendOne(ctx, input, handed);
  return r.notificationId === undefined ? { outcome: r.outcome } : { outcome: r.outcome, notificationId: r.notificationId };
}

/**
 * One notification. `emailFailed`: an email that is the point of this kind (EMAIL_KINDS, the approval reminder) did not go out. `redo`: this recipient was cut off mid-send before (the fanout's
 * mark has no notification), so the kind's email goes out even when the row collapses into the one already filed: whether it went is unknown, and never told is worse than told twice.
 */
/**
 * The kinds a person or an agent may send themselves through notifications.send (depth 0, not the service): the ones that are about them talking to someone. Their line always names the real
 * sender (callerName below), never a name the call carries. Every other kind is a system notice (an approval, a reminder, health, an incident, the Space's deletion) and comes from Vyre itself or
 * from another module's code (a call one level down, whose code chose the kind). The kinds that email are Vyre's alone: the Space's mailbox never sends words a member or an agent wrote.
 */
export const SENDABLE_KINDS: ReadonlySet<string> = new Set(["dm", "mention", "item.shared", "agent.task_finished"]);
/** Calls the host makes for the Space and not for a person's own words: a scheduled job (the Gate's approval reminder runs as the owner who asked), the Gate itself, a module hook or seam. */
const SYSTEM_ORIGINS: ReadonlySet<string> = new Set(["schedule", "gate", "hook", "seam", "module", "routine"]);
/** The name the line shows for the caller: theirs as the Space knows it, never one they typed. */
async function callerName(ctx: NotifCtx): Promise<string> {
  try {
    const r = (await ctx.call?.("access.principals.get", { principal: { kind: ctx.principal.kind, id: ctx.principal.id } })) as { principal?: { name?: unknown } } | undefined;
    if (typeof r?.principal?.name === "string" && r.principal.name.trim() !== "") return r.principal.name.trim();
  } catch { /* a name is not always readable */ }
  return ctx.principal.kind === "agent" ? "An agent" : "Someone";
}

export async function sendOne(ctx: NotifCtx, input: SendIn, handed = false, redo = false, mail: MailState = { down: false }): Promise<{ outcome: Outcome; notificationId?: string; emailFailed?: true }> {
  const system = isService(ctx) || (ctx.depth ?? 0) > 0 || SYSTEM_ORIGINS.has(ctx.origin ?? "");
  if (EMAIL_KINDS.has(input.kind) && !isService(ctx)) raise(ctx, "permission.no_grant", "Only Vyre itself sends notices about deleting the Space.", { reason: "system_kind", kind: input.kind });
  if (!system && !SENDABLE_KINDS.has(input.kind)) raise(ctx, "permission.no_grant", "That kind of notice is sent by Vyre itself, not by a person or an agent.", { reason: "system_kind", kind: input.kind });
  if (!system) {
    const name = await callerName(ctx);
    input = { ...input, data: { ...(input.data ?? {}), ...(input.kind === "agent.task_finished" ? { agent: name } : { from: name }) } };
  }
  const def = kindOf(input.kind);
  if (!def || !LISTED.includes(def)) raise(ctx, "validation.bad_input", "That kind of notification does not exist.", { errors: ["/kind: unknown"] });
  let person = input.to;
  const now = ctx.now();
  // While away, Needs you goes to the person named in While you are away (an away delegate set with notifications.away.set keeps its own way: tasks route it)
  if (!handed && NEEDS_YOU_KINDS.has(def.key)) {
    const away = readAway(ctx.db, person, now);
    const hand = readSettings(ctx.db, person).handTo;
    if (away && away.delegate.kind === "none" && hand && hand !== person) {
      return sendOne(ctx, { ...input, to: hand, data: { ...(input.data ?? {}), handedFrom: person } }, true, redo, mail);
    }
  }
  const rules = readRules(ctx.db, person);
  const sources = sourcesOf(input.data, input.subject, ctx.principal);
  if (!UNMUTABLE_KINDS.has(def.key) && isMuted(ctx.db, rules, person, sources, now)) return { outcome: "dropped_muted" };

  // an approval reminder for something that is done or withdrawn has nothing left to say
  if (def.key === "approval.backstop" && input.subject?.type === "task" && ctx.call) {
    const t = (await ctx.call("tasks.get", { taskId: input.subject.id }).catch(() => undefined)) as { task?: { state?: string } } | undefined;
    if (t?.task?.state === "done" || t?.task?.state === "canceled") return { outcome: "dropped_muted" };
  }

  const landed = levelFor(ctx, def, person, input.data?.urgent === true);
  let level = landed.level;
  if (landed.quietEnd !== undefined) await scheduleQuietSummary(ctx, person, landed.quietEnd);
  const vars: Record<string, unknown> = { space: ctx.space, ...(input.data ?? {}), ...(input.title !== undefined ? { title: input.title } : {}) };
  const title = render(def.title, vars) || def.title.replace(/\{\{\w+\}\}/g, "").trim() || def.key;
  const collapseKey = input.collapseKey ?? (input.subject ? `${def.key}:${input.subject.id}` : undefined);
  const agent = sources.find((s) => s.kind === "agent");

  // same key, still unseen: one row with a count, not another banner
  const existing = collapseKey
    ? (ctx.db.all("SELECT * FROM notifications_items WHERE person = ? AND collapse_key = ? AND seen_at IS NULL AND deleted_at IS NULL AND at > ? ORDER BY at DESC, id DESC LIMIT 1", person, collapseKey, now - COLLAPSE_WINDOW_MS)[0] as Record<string, unknown> | undefined)
    : undefined;
  const prior = existing ? rowOf(existing) : undefined;
  const alreadyLoud = prior?.level === "interrupt";   // the row already interrupted: a repeat is the same banner, not another push or another use of the cap

  // an agent can interrupt a person 3 times an hour; the rest go to the digest and the agent is told
  let capped = false;
  if (level === "interrupt" && def.agentRateKey && agent && !alreadyLoud) {
    const used = Number((ctx.db.all("SELECT COUNT(*) AS n FROM notifications_agent_interrupts WHERE person = ? AND agent = ? AND at > ?", person, agent.id, now - HOUR)[0] as { n: number }).n);
    if (used >= AGENT_INTERRUPTS_PER_HOUR) { capped = true; level = "digest"; }
    else ctx.db.run("INSERT INTO notifications_agent_interrupts (person, agent, at) VALUES (?, ?, ?)", person, agent.id, now);
  }
  if (!capped && prior && RANK[prior.level] > RANK[level]) level = prior.level;   // a repeat never lowers a row that was louder

  let row: Row;
  let collapsed = false;
  if (prior) {
    collapsed = true;
    // a burst of replies in one thread is one row that says how many: "3 new replies in #intake"
    const many = def.key === "reply.thread" ? render(REPLIES_TITLE, { ...vars, count: prior.count + 1 }) : title;
    row = { ...prior, level, title: many, count: prior.count + 1, at: now, ...(input.body !== undefined ? { body: input.body } : {}) };
    ctx.db.run("UPDATE notifications_items SET level = ?, title = ?, body = ?, count = ?, at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      row.level, row.title, row.body ?? null, row.count, now, now, row.id);
  } else {
    row = clean({
      id: makeId("ntf", globalThis.crypto.getRandomValues(new Uint8Array(14))), person, kind: def.key, level, place: def.place, title, body: input.body, subject: input.subject, count: 1, at: now, actions: def.actions,
      collapseKey, runId: input.runId ?? ctx.run, traceId: ctx.trace.traceId,
    }) as Row;
    ctx.db.run(
      `INSERT INTO notifications_items (id, person, kind, level, place, title, body, subject_type, subject_id, collapse_key, count, at, seen_at, actions, run_id, trace_id, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`,
      row.id, person, row.kind, row.level, row.place, row.title, row.body ?? null, row.subject?.type ?? null, row.subject?.id ?? null, collapseKey ?? null, 1, now,
      JSON.stringify(row.actions), row.runId ?? null, row.traceId ?? null, now,
    );
  }

  const push = row.level === "interrupt" && !alreadyLoud ? await deliverPush(ctx, person, row, def) : { pushed: false as const };
  if (capped) ctx.emit("notification.capped", `entity/${person}`, { person, agentId: agent!.id, kind: def.key, perHour: AGENT_INTERRUPTS_PER_HOUR }, { vis: "owner" });
  ctx.emit("notification.delivered", `entity/${row.id}`, clean({
    notificationId: row.id, person, kind: def.key, level: row.level, place: row.place, subject: row.subject, collapsed, pushed: push.pushed, device: (push as { device?: string }).device,
  }), { vis: "owner" });

  if (def.key === "approval.requested" && !collapsed) await scheduleBackstop(ctx, def, person, rules.emailBackstop, input, title);
  let emailed = true;
  if (def.key === "approval.backstop" && rules.emailBackstop) {
    emailed = await sendBackstopEmail(ctx, person, row, collapseKey ?? row.id, mail);
    // not sent after its tries: the reminder is scheduled once more, a while later (the mail server may be back); a reminder that was already the second try is not rescheduled again
    if (!emailed && input.data?.["emailRetry"] !== true && ctx.schedule) {
      try { await ctx.schedule(ctx.now() + BACKSTOP_RETRY_MS, "notifications.send", { ...input, data: { ...(input.data ?? {}), emailRetry: true } }); }
      catch (e) { ctx.log?.warn("reminder not rescheduled", (e as Error).message); }
    }
  }
  if (EMAIL_KINDS.has(def.key) && (!collapsed || redo)) emailed = await sendKindEmail(ctx, person, row, mail);
  return { outcome: capped ? "capped" : row.level, notificationId: row.id, ...(emailed ? {} : { emailFailed: true as const }) };
}

/** One reminder, four hours after an approval starts waiting (the Gate schedules its own for held calls, with the same collapse key, so they land on one row). */
async function scheduleBackstop(ctx: NotifCtx, def: KindDef, person: string, wanted: boolean, input: SendIn, title: string): Promise<void> {
  if (!wanted || !def.backstopEmailAfterHours || !input.subject || !ctx.schedule) return;
  try {
    await ctx.schedule(ctx.now() + def.backstopEmailAfterHours * HOUR, "notifications.send", {
      to: person, kind: "approval.backstop", subject: input.subject, title: input.title ?? title, collapseKey: `approval.backstop:${input.subject.id}`,
    });
  } catch (e) { ctx.log?.warn("backstop not scheduled", (e as Error).message); }
}
/** Kinds that also go out as one email to the person, whatever their backstop setting: a Space scheduled for deletion, and the deletion cancelled. */
export const EMAIL_KINDS: ReadonlySet<string> = new Set(["space.deletion_scheduled", "space.deletion_cancelled"]);
/**
 * How an email that is the point of its kind is tried: up to three tries, `retryMs` apart, each given `tryMs` to answer (a try that does not answer counts as failed; it may still arrive).
 * A test may change these.
 */
export const emailTiming = { retryMs: [300, 1_000] as readonly number[], tryMs: 10_000 };
/** One delivery's view of the mail server: once an email has failed every try, the rest of the delivery does not try (a dead mail server must not hold the fanout). */
export interface MailState { down: boolean }
/** How long before a reminder whose email failed every try is sent once more. */
const BACKSTOP_RETRY_MS = 15 * 60_000;
/** What became of one email, kept for the record (notifications_email_log): sent, or why not. */
export type EmailOutcome = "sent" | "no_transport" | "no_mailbox" | "no_address" | "suppressed" | "held" | "off" | "failed";
function record(ctx: NotifCtx, person: string, kind: string, ref: string, outcome: EmailOutcome): void {
  try { ctx.db.run("INSERT INTO notifications_email_log (person, kind, ref, outcome, at) VALUES (?, ?, ?, ?, ?)", person, kind, ref, outcome, ctx.now()); } catch { /* the record is a courtesy; the send stands */ }
}
/**
 * False when the email was meant to go and did not (it is tried again: the next delivery of the event, the periodic pass, or the reminder's reschedule). True when it went, and also when it was
 * never going to: no email transport, no sending mailbox in this Space (the host's health line says so to admins), no address for the person, the person turned email off for this kind, a
 * suppressed address. Those are recorded with their reason and never counted as sent, and nothing retries them.
 */
async function emailWithRetry(ctx: NotifCtx, msg: NoticeEmail, kind: string, mail: MailState): Promise<boolean> {
  const p = pushPort();
  if (!p?.email) { ctx.log?.warn(`${kind} email not sent: this server has no email transport`); record(ctx, msg.to, kind, msg.key, "no_transport"); return true; }
  const choice = readChoice(ctx.db, msg.to, kind);
  if (choice && !choice.channels.includes("email")) { record(ctx, msg.to, kind, msg.key, "off"); return true; }
  if (mail.down) return false;
  for (let i = 0; ; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const said = await Promise.race([p.email(msg), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${emailTiming.tryMs} ms`)), emailTiming.tryMs); })]);
      const outcome: EmailOutcome = said === undefined || said === "sent" ? "sent" : said;
      // the first email that could not go because the Space has no sending mailbox, since the last one that went: admins hear it once, in Console (no standing "degraded" state)
      if (outcome === "no_mailbox" && lastMailboxOutcome(ctx) !== "no_mailbox") await tellAdmins(ctx, { service: "Notice email", state: "off: this Space has no sending mailbox, so people see notices in the app only. Set one up in Console, Messaging, Email, Sending domains." }, "health.degraded:email_notices");
      record(ctx, msg.to, kind, msg.key, outcome);
      return true;
    } catch (e) {
      if (i >= emailTiming.retryMs.length) { ctx.log?.warn(`${kind} email failed`, (e as Error).message); record(ctx, msg.to, kind, msg.key, "failed"); mail.down = true; return false; }
      await new Promise((r) => setTimeout(r, emailTiming.retryMs[i]));
    } finally { if (timer) clearTimeout(timer); }
  }
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A day as people write it: 18 November 2026 (UTC, the day the server holds). */
export const dayOf = (ms: number): string => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/**
 * What a notice email says: fixed copy per kind, filled only with values the server holds. The deletion date is the number the fanout read from space.deletion_scheduled into the row's
 * collapse key (impl.ts plan); a row's title is never used, so no caller's words reach a mailbox. Null for a kind with no email copy.
 */
export function emailCopy(kind: string, row: { collapseKey?: string | undefined; subject?: ResourceRef | undefined }): { subject: string; line: string; open: { kind: string; id: string } } | null {
  if (kind === "space.deletion_scheduled") {
    const at = Number(String(row.collapseKey ?? "").split(":")[1]);
    const day = Number.isFinite(at) && at > 0 ? dayOf(at) : null;
    return day
      ? { subject: `Scheduled for deletion on ${day}`, line: `Everything in this Space is removed on ${day}. An admin can cancel the deletion in Console until then.`, open: { kind: "place", id: "console" } }
      : { subject: "Scheduled for deletion", line: "Everything in this Space is going to be removed. An admin can cancel the deletion in Console.", open: { kind: "place", id: "console" } };
  }
  if (kind === "space.deletion_cancelled") return { subject: "Deletion cancelled", line: "The scheduled deletion of this Space was cancelled. Nothing will be removed.", open: { kind: "place", id: "console" } };
  if (kind === "approval.backstop") return { subject: "Something is waiting on you", line: "An approval or an answer is waiting on you in Vyre.", open: row.subject ? { kind: row.subject.type, id: row.subject.id } : { kind: "place", id: "inbox" } };
  return null;
}
/** The last email whose answer said something about the Space's mailbox: "sent" (it works) or "no_mailbox". */
function lastMailboxOutcome(ctx: NotifCtx): string | null {
  try { return (ctx.db.all("SELECT outcome FROM notifications_email_log WHERE outcome IN ('sent', 'no_mailbox') ORDER BY at DESC, rowid DESC LIMIT 1")[0] as { outcome?: string } | undefined)?.outcome ?? null; } catch { return null; }
}
/** Files one line for every admin (impl.ts registers how: its adminsOf, the owner included). Set once the module loads. */
let admins: ((ctx: NotifCtx, data: { service: string; state: string }, collapseKey: string) => Promise<void>) | null = null;
export function setTellAdmins(f: typeof admins): void { admins = f; }
async function tellAdmins(ctx: NotifCtx, data: { service: string; state: string }, collapseKey: string): Promise<void> {
  try { await admins?.(ctx, data, collapseKey); } catch (e) { ctx.log?.warn("notifications: admins could not be told about notice email", (e as Error).message); }
}
/** An email the periodic pass gave up on: every admin's Console names the person, once. */
export async function tellEmailGaveUp(ctx: NotifCtx, person: string, kind: string): Promise<void> {
  let name = "a person";
  try {
    const r = (await ctx.call?.("access.principals.get", { principal: { kind: "person", id: person } })) as { principal?: { name?: unknown } } | undefined;
    if (typeof r?.principal?.name === "string" && r.principal.name.trim() !== "") name = r.principal.name.trim();
  } catch { /* a name is not always readable */ }
  const what = kind.startsWith("space.deletion") ? "a notice about deleting this Space" : "a reminder";
  await tellAdmins(ctx, { service: `Notice email to ${name}`, state: `failing: ${what} could not be emailed.` }, `health.degraded:email_failed:${person}:${kind}`);
}
async function sendKindEmail(ctx: NotifCtx, person: string, row: Row, mail: MailState): Promise<boolean> {
  const copy = emailCopy(String(row.kind), row);
  if (!copy) return true;
  return emailWithRetry(ctx, { to: person, ...copy, key: row.id }, String(row.kind), mail);
}
/** The email of a notification already filed, again (the fanout's next delivery, or the periodic pass, for a recipient whose email failed). */
export async function resendKindEmail(ctx: NotifCtx, person: string, notificationId: string, mail: MailState = { down: false }): Promise<boolean> {
  const r = ctx.db.all("SELECT * FROM notifications_items WHERE id = ? AND person = ?", notificationId, person)[0] as Record<string, unknown> | undefined;
  if (!r || !EMAIL_KINDS.has(String(r["kind"]))) return true;
  return sendKindEmail(ctx, person, { id: notificationId, kind: String(r["kind"]), title: String(r["title"]), ...(typeof r["collapse_key"] === "string" ? { collapseKey: r["collapse_key"] } : {}) } as Row, mail);
}
async function sendBackstopEmail(ctx: NotifCtx, person: string, row: Row, key: string, mail: MailState): Promise<boolean> {
  if (!pushPort()?.email) { ctx.log?.warn("approval.backstop email not sent: this server has no email transport"); record(ctx, person, "approval.backstop", key, "no_transport"); return true; }
  const fresh = ctx.db.run("INSERT OR IGNORE INTO notifications_backstops (key, at) VALUES (?, ?)", key, ctx.now()).changes > 0;
  if (!fresh) return true;   // once per approval
  const ok = await emailWithRetry(ctx, { to: person, ...emailCopy("approval.backstop", row)!, key }, "approval.backstop", mail);
  // not sent after its tries: the once-mark goes, so the next reminder for this approval (the Gate's own, which lands on the same key) sends it, rather than "once" meaning never
  if (!ok) ctx.db.run("DELETE FROM notifications_backstops WHERE key = ?", key);
  return ok;
}

// ---- lists and counts ----

export async function list(ctx: NotifCtx, input: { place?: string; level?: string; unseenOnly?: boolean; cursor?: string; limit?: number }): Promise<Record<string, unknown>> {
  const me = meOf(ctx);
  const where = ["person = ?", "deleted_at IS NULL"]; const args: unknown[] = [me];
  if (input.place) { where.push("place = ?"); args.push(input.place); }
  if (input.level) { where.push("level = ?"); args.push(input.level); }
  if (input.unseenOnly) where.push("seen_at IS NULL");
  const total = Number((ctx.db.all(`SELECT COUNT(*) AS n FROM notifications_items WHERE ${where.join(" AND ")}`, ...args)[0] as { n: number }).n);
  if (input.cursor) {
    const m = /^(\d+):(.+)$/.exec(input.cursor);
    if (!m) raise(ctx, "validation.bad_input", "That page marker is not valid.", { errors: ["/cursor: not from this list"] });
    where.push("(at < ? OR (at = ? AND id < ?))"); args.push(Number(m[1]), Number(m[1]), m[2]);
  }
  const limit = input.limit ?? 50;
  const rows = (ctx.db.all(`SELECT * FROM notifications_items WHERE ${where.join(" AND ")} ORDER BY at DESC, id DESC LIMIT ?`, ...args, limit + 1) as Record<string, unknown>[]).map(rowOf);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return clean({ notifications: page.map((r) => outRow(r, ctx.space)), next: rows.length > limit && last ? `${last.at}:${last.id}` : undefined, total });
}

/** The rail counts only Needs you and direct conversations; every other place gets a quiet dot (its unseen badge-or-louder rows). Digest rows never count. */
export async function counts(ctx: NotifCtx): Promise<{ rail: { needsYou: number; directConversations: number }; dots: Record<string, number>; otherSpaces: { spaceId: string; needsYou: number }[] }> {
  const rows = (ctx.db.all("SELECT kind, place, count FROM notifications_items WHERE person = ? AND seen_at IS NULL AND deleted_at IS NULL AND level != 'digest'", meOf(ctx)) as { kind: string; place: string; count: number }[]);
  let needsYou = 0, direct = 0;
  const dots: Record<string, number> = {};
  for (const r of rows) {
    const n = Math.max(1, Number(r.count));
    if (NEEDS_YOU_KINDS.has(r.kind)) needsYou += n;
    else if (DIRECT_KINDS.has(r.kind)) direct += n;
    else dots[r.place] = (dots[r.place] ?? 0) + n;
  }
  // one server is one Space (v1): another Space that needs this person arrives through its own server, not through this table
  return { rail: { needsYou, directConversations: direct }, dots, otherSpaces: [] };
}

export async function markSeen(ctx: NotifCtx, input: { notificationIds?: string[]; place?: string }): Promise<{ marked: number }> {
  const me = meOf(ctx);
  const where = ["person = ?", "seen_at IS NULL", "deleted_at IS NULL"]; const args: unknown[] = [me];
  if (input.notificationIds) {
    if (input.notificationIds.length === 0) return { marked: 0 };
    where.push(`id IN (${input.notificationIds.map(() => "?").join(", ")})`); args.push(...input.notificationIds);
  }
  if (input.place) { where.push("place = ?"); args.push(input.place); }
  const ids = (ctx.db.all(`SELECT id FROM notifications_items WHERE ${where.join(" AND ")} ORDER BY at, id`, ...args) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { marked: 0 };
  ctx.db.run(`UPDATE notifications_items SET seen_at = ?, updated_at = ?, version = version + 1 WHERE ${where.join(" AND ")}`, ctx.now(), ctx.now(), ...args);
  ctx.emit("notification.seen", `entity/${me}`, clean({ person: me, notificationIds: ids.slice(0, 500), place: input.place }), { vis: "owner" });
  return { marked: ids.length };
}

/** The subject of these notifications closed: they stop counting for everyone they went to. The rows stay, so the person can still read what happened. */
export function clearForSubject(ctx: NotifCtx, type: string, id: string): string[] {
  const rows = ctx.db.all("SELECT id, person FROM notifications_items WHERE subject_type = ? AND subject_id = ? AND seen_at IS NULL AND deleted_at IS NULL", type, id) as { id: string; person: string }[];
  if (rows.length === 0) return [];
  ctx.db.run("UPDATE notifications_items SET seen_at = ?, updated_at = ?, version = version + 1 WHERE subject_type = ? AND subject_id = ? AND seen_at IS NULL AND deleted_at IS NULL", ctx.now(), ctx.now(), type, id);
  for (const person of new Set(rows.map((r) => r.person))) ctx.emit("notification.seen", `entity/${person}`, clean({ person, notificationIds: rows.filter((r) => r.person === person).map((r) => r.id).slice(0, 500) }), { vis: "owner" });
  return rows.map((r) => r.id);
}

export async function kindsList(ctx: NotifCtx): Promise<{ kinds: Record<string, unknown>[] }> {
  const me = meOf(ctx);
  return {
    kinds: LISTED.map((k) => {
      const mine = readChoice(ctx.db, me, k.key);
      return { key: k.key, level: k.level, place: k.place, title: k.title, respectHours: k.respectHours, ...(mine ? { mine } : {}) };
    }),
  };
}

export async function digestCollect(ctx: NotifCtx, input: { person: string; since: number; until?: number }): Promise<{ items: Record<string, unknown>[] }> {
  if (input.person !== meOf(ctx) && !isService(ctx)) raise(ctx, "permission.no_grant", "You can only gather your own digest.");
  const until = input.until ?? ctx.now();
  const rows = (ctx.db.all("SELECT * FROM notifications_items WHERE person = ? AND level = 'digest' AND deleted_at IS NULL AND at > ? AND at <= ? ORDER BY at, id", input.person, input.since, until) as Record<string, unknown>[]).map(rowOf);
  return { items: rows.map((r) => clean({ kind: r.kind, title: r.title, at: r.at, subject: r.subject, count: r.count })) };
}

// ---- settings ----

const validHours = (ctx: NotifCtx, h: Hours): Hours => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: h.tz }); } catch { raise(ctx, "validation.bad_input", "That time zone is not known.", { errors: ["/workingHours/tz: unknown zone"] }); }
  if (new Set(h.days).size !== h.days.length) raise(ctx, "validation.bad_input", "A day is listed twice.", { errors: ["/workingHours/days: duplicate"] });
  return { days: [...h.days].sort((a, b) => a - b), from: h.from, to: h.to, tz: h.tz };
};

export async function rulesGet(ctx: NotifCtx): Promise<{ rules: Record<string, unknown> }> {
  return { rules: readRules(ctx.db, meOf(ctx)) as unknown as Record<string, unknown> };
}
export async function rulesSet(ctx: NotifCtx, input: { workingHours?: Hours | null; emailBackstop?: boolean; mutedAgents?: string[]; mutedChannels?: string[]; mutedRecords?: string[] }): Promise<{ rules: Record<string, unknown> }> {
  const me = meOf(ctx);
  const was = readRules(ctx.db, me);
  const next = { ...was };
  const fields: string[] = [];
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (input.workingHours !== undefined) {
    const h = input.workingHours === null ? undefined : validHours(ctx, input.workingHours);
    if (!same(h, was.workingHours)) { fields.push("workingHours"); if (h) next.workingHours = h; else delete next.workingHours; }
  }
  if (input.emailBackstop !== undefined && input.emailBackstop !== was.emailBackstop) { fields.push("emailBackstop"); next.emailBackstop = input.emailBackstop; }
  for (const k of ["mutedAgents", "mutedChannels", "mutedRecords"] as const) {
    const v = input[k];
    if (v !== undefined) { const u = [...new Set(v)]; if (!same(u, was[k])) { fields.push(k); next[k] = u; } }
  }
  if (fields.length) {
    writeRules(ctx.db, me, next);
    ctx.emit("notification.rules_changed", `entity/${me}`, { person: me, fields }, { vis: "owner" });
  }
  return { rules: next as unknown as Record<string, unknown> };
}

// ---- mutes ----

export async function muteSet(ctx: NotifCtx, input: { target: Target; minutes?: number }): Promise<{ until: number }> {
  const me = meOf(ctx);
  const until = ctx.now() + (input.minutes ?? 60) * 60_000;
  ctx.db.run(
    `INSERT INTO notifications_mutes (person, target_kind, target_id, until) VALUES (?, ?, ?, ?)
     ON CONFLICT(person, target_kind, target_id) DO UPDATE SET until = excluded.until`, me, input.target.kind, input.target.id, until,
  );
  ctx.emit("notification.muted", `entity/${me}`, { person: me, target: input.target, until }, { vis: "owner" });
  return { until };
}
export async function muteClear(ctx: NotifCtx, input: { target: Target }): Promise<{ cleared: boolean }> {
  const me = meOf(ctx);
  const cleared = ctx.db.run("DELETE FROM notifications_mutes WHERE person = ? AND target_kind = ? AND target_id = ?", me, input.target.kind, input.target.id).changes > 0;
  if (cleared) ctx.emit("notification.unmuted", `entity/${me}`, { person: me, target: input.target }, { vis: "owner" });
  return { cleared };
}
export async function muteList(ctx: NotifCtx): Promise<{ mutes: { target: Target; until: number }[] }> {
  return { mutes: activeMutes(ctx.db, meOf(ctx), ctx.now()) };
}

// ---- away and delegates ----

function cleanChain(ctx: NotifCtx, me: string, chain: Delegate[]): Delegate[] {
  const out: Delegate[] = [];
  for (const [i, d] of chain.entries()) {
    if (d.kind === "none") { out.push({ kind: "none" }); continue; }
    if (!d.id) raise(ctx, "validation.bad_input", "Say who.", { errors: [`/chain/${i}/id: required for ${d.kind}`] });
    if (d.kind === "person" && d.id === me) raise(ctx, "validation.precondition_failed", "You cannot be your own delegate.", { reason: "self_delegate" });
    if (out.some((o) => o.kind === d.kind && o.id === d.id)) raise(ctx, "validation.bad_input", "Someone is listed twice.", { errors: [`/chain/${i}: duplicate`] });
    out.push({ kind: d.kind, id: d.id });
  }
  return out;
}

export async function awaySet(ctx: NotifCtx, input: { until: number; delegate: Delegate }): Promise<{ until: number }> {
  const me = meOf(ctx);
  if (input.until <= ctx.now()) raise(ctx, "validation.bad_input", "Pick a time in the future.", { errors: ["/until: must be in the future"] });
  const delegate = cleanChain(ctx, me, [input.delegate])[0]!;
  const since = readAway(ctx.db, me, ctx.now())?.since ?? ctx.now();
  ctx.db.run(
    `INSERT INTO notifications_away (person, until, delegate, since) VALUES (?, ?, ?, ?)
     ON CONFLICT(person) DO UPDATE SET until = excluded.until, delegate = excluded.delegate`, me, input.until, JSON.stringify(delegate), since,
  );
  ctx.emit("away.set", `entity/${me}`, { person: me, until: input.until, delegate });
  return { until: input.until };
}
export async function awayClear(ctx: NotifCtx): Promise<{ waitedApprovals: number; waitedDigest: number; digestId?: string }> {
  const me = meOf(ctx);
  const r = ctx.db.all("SELECT since FROM notifications_away WHERE person = ?", me)[0] as { since: number } | undefined;
  if (!r) return { waitedApprovals: 0, waitedDigest: 0 };
  const since = Number(r.since);
  const n = (sql: string): number => Number((ctx.db.all(sql, me, since)[0] as { n: number }).n);
  const waitedApprovals = n("SELECT COUNT(*) AS n FROM notifications_items WHERE person = ? AND at >= ? AND seen_at IS NULL AND deleted_at IS NULL AND kind IN ('approval.requested', 'approval.backstop')");
  const waitedDigest = n("SELECT COUNT(*) AS n FROM notifications_items WHERE person = ? AND at >= ? AND level = 'digest' AND deleted_at IS NULL");
  ctx.db.run("DELETE FROM notifications_away WHERE person = ?", me);
  ctx.emit("away.cleared", `entity/${me}`, { person: me, waitedApprovals, waitedDigest });
  // I'm Back after real time away: home writes the While you were away digest for it (it writes nothing when nothing happened); a failure there never keeps the person away
  let digestId: string | undefined;
  if (ctx.call && ctx.now() - since >= AWAY_DIGEST_MIN_MS) {
    try { digestId = ((await ctx.call("home.away_digest", { since })) as { digestId?: string } | null)?.digestId; } catch { /* the digest is a courtesy */ }
  }
  return { waitedApprovals, waitedDigest, ...(digestId ? { digestId } : {}) };
}
/** Away shorter than this writes no digest on I'm Back. */
export const AWAY_DIGEST_MIN_MS = 30 * 60_000;
/** Who is away right now and until when: what a teammate's dot shows. Never the delegate, never why. Every member may read it. */
export async function awayWho(ctx: NotifCtx): Promise<{ people: { person: string; until: number }[] }> {
  const now = ctx.now();
  const rows = ctx.db.all("SELECT person, until FROM notifications_away WHERE until > ? ORDER BY person", now) as { person: string; until: number }[];
  return { people: rows.map((r) => ({ person: String(r.person), until: Number(r.until) })) };
}
export async function awayGet(ctx: NotifCtx): Promise<Record<string, unknown>> {
  const a = readAway(ctx.db, meOf(ctx), ctx.now());
  return a ? { away: true, until: a.until, delegate: a.delegate } : { away: false };
}

export async function delegateGet(ctx: NotifCtx): Promise<{ chain: Delegate[] }> {
  return { chain: readChain(ctx.db, meOf(ctx)) };
}
export async function delegateSet(ctx: NotifCtx, input: { chain: Delegate[] }): Promise<{ chain: Delegate[] }> {
  const me = meOf(ctx);
  const chain = cleanChain(ctx, me, input.chain);
  ctx.db.run(`INSERT INTO notifications_delegates (person, chain) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET chain = excluded.chain`, me, JSON.stringify(chain));
  ctx.emit("notification.delegate_changed", `entity/${me}`, { person: me, chain }, { vis: "owner" });
  return { chain };
}
/** Walk the person's away delegate, then the standing chain, and return the first holder who can act on the item. A person is checked with the access checker (a delegate never
 * gains access); a role is returned as is (each holder is checked when they act). With no way to check, a person is skipped. */
export async function delegateResolve(ctx: NotifCtx, input: { person: string; resource: ResourceRef }): Promise<{ delegate?: { kind: "person" | "role"; id: string }; walked: number }> {
  const away = readAway(ctx.db, input.person, ctx.now());
  const chain = [...(away ? [away.delegate] : []), ...readChain(ctx.db, input.person)];
  let walked = 0;
  for (const d of chain) {
    if (d.kind === "none") break;
    walked++;
    if (!d.id || d.id === input.person) continue;
    if (d.kind === "role") return { delegate: { kind: "role", id: d.id }, walked };
    if (!ctx.call) continue;
    try {
      const r = (await ctx.call("access.check", { principal: { kind: "person", id: d.id }, action: { level: "use" }, resource: input.resource })) as { decision?: { effect?: string } };
      if (r.decision?.effect === "allow") return { delegate: { kind: "person", id: d.id }, walked };
    } catch { /* a delegate we cannot check is not a delegate */ }
  }
  return { walked };
}
