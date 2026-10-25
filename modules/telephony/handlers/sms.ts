// Texts (spec 2.18 Sending, Single send API; 2.19 sending side; ARCH 8.2): telephony.send_sms is the SMS half of the single send API, and telephony.sms.list reads the texts of a number or contact.
// One door for every outgoing text, checked the way mail.send checks mail: the suppression list, SMS consent, send windows, caps per number, then Twilio. The Gate (spec 2.14) runs in the invoke
// pipeline before this code: an agent, an automation or a campaign is held for approval, a person typing a text is not.
// DECISION: windows and caps apply to every non-person actor, as in mail.send. A person who texts is not made to wait for a window; suppression and consent still apply.
// DECISION: Space setting contacts.sms_requires_consent (default on) means a text needs smsConsent `granted` on the contact. A reply to a text the person sent us (replyToId) counts as consent for that
// conversation. A number with no contact has no consent on file, so with the setting on it is refused as `no_consent`. STOP and UNSUBSCRIBE (telephony.ingest_sms) suppress the sender.
// DECISION: the window and caps are the mail ones (mail.send_window, mail.sender_caps); the recipient's zone is not known in v1 data, so the sender's profile.timezone applies.
// DECISION: a refusal that depends on the person (suppressed, no consent, do not contact) is a status `suppressed` and a message.suppressed event, not an error. Over the cap is an error
// (rate_limit.exceeded): waiting a day silently is worse than telling the sender. Outside the window the text is queued and sent by a scheduled call.
// DECISION: pictures (mediaFileIds) need a public address for each file, which the Space does not give Twilio yet, so a text with pictures is refused with a plain message rather than sent without them.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import {
  actorOf, bad, ensure, first, isId, isInt, keyOf, liveNumber, list, newId, num, obj, pageOf, paging, parseJson, patch, phone, refuse, rowsOf, setting, smsOut, str, strOrNull, strOrUndef, text, validZone,
} from "../projections.ts";
import type { Json, Row, TelCtx } from "../projections.ts";

interface Caps { perHour: number; perDay: number }
interface Window { days: number[]; startHour: number; endHour: number; zone: "recipient" | "space" }
const DEFAULT_CAPS: Caps = { perHour: 30, perDay: 150 };
const DEFAULT_WINDOW: Window = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18, zone: "recipient" };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STEP = 15 * 60_000;
const MAX_BODY = 1600;

const capsOk = (v: unknown): v is Caps => isInt(obj(v).perHour) && isInt(obj(v).perDay) && (obj(v).perHour as number) > 0 && (obj(v).perDay as number) > 0;
const windowOk = (v: unknown): v is Window => {
  const w = obj(v);
  return Array.isArray(w.days) && w.days.length > 0 && w.days.every((d) => isInt(d) && d >= 1 && d <= 7) && isInt(w.startHour) && w.startHour >= 0 && w.startHour <= 23
    && isInt(w.endHour) && w.endHour >= 1 && w.endHour <= 24 && (w.zone === "recipient" || w.zone === "space");
};
const boolOk = (v: unknown): v is boolean => typeof v === "boolean";
const zoneOk = (v: unknown): v is string => validZone(v);

// ---- send windows (ISO weekday, 1 Monday to 7 Sunday)

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
function isoLocal(ms: number, zone: string): { day: number; hour: number } {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", hourCycle: "h23" });
    formatters.set(zone, f);
  }
  let day = 1;
  let hour = 0;
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type === "weekday") day = WEEKDAY[part.value] ?? 1;
    if (part.type === "hour") hour = Number(part.value) % 24;
  }
  return { day, hour };
}
export function inWindow(ms: number, zone: string, w: Pick<Window, "days" | "startHour" | "endHour">): boolean {
  const { day, hour } = isoLocal(ms, zone);
  if (!w.days.includes(day)) return false;
  return w.startHour < w.endHour ? hour >= w.startHour && hour < w.endHour : hour >= w.startHour || hour < w.endHour;
}
export function nextWindowStart(ms: number, zone: string, w: Pick<Window, "days" | "startHour" | "endHour">): number | null {
  if (inWindow(ms, zone, w)) return ms;
  let t = ms - (ms % STEP) + STEP;
  for (let i = 0; i < 8 * 96; i++, t += STEP) if (inWindow(t, zone, w)) return t;
  return null;
}

// ---- the plan

interface Prefs { doNotContact?: boolean; smsConsent?: string; optedOut?: string[] }

async function contactOf(ctx: TelCtx, to: string, given: string | undefined): Promise<string | undefined> {
  if (given !== undefined) return given;
  return strOrUndef(obj(list(obj(await ctx.call("contacts.resolve", { phone: to })).sure)[0]).recordId);
}

async function prefsOf(ctx: TelCtx, contactId: string): Promise<Prefs | null> {
  try {
    return obj(await ctx.call("contacts.preferences.get", { contactId })) as Prefs;
  } catch (e) {
    if (e instanceof HostError && e.error.code === "validation.not_found") return null;   // a missing record has no preferences; any other failure stops the send
    throw e;
  }
}

/** Why this text may not go to this number, or null. */
async function refusalFor(ctx: TelCtx, to: string, contactId: string | undefined, replyTo: Row | null): Promise<string | null> {
  const checked = obj(await ctx.call("contacts.suppression.check", { channel: "sms", addresses: [to] }));
  const hit = list(checked.suppressed).map(obj).find((s) => s.address === to);
  if (hit) return text(hit.reason) || "suppressed";
  const prefs = contactId ? await prefsOf(ctx, contactId) : null;
  if (prefs?.doNotContact === true) return "do_not_contact";
  if (prefs?.smsConsent === "denied") return "consent_denied";
  if (Array.isArray(prefs?.optedOut) && prefs?.optedOut.includes("sms")) return "opted_out";
  const requires = await setting(ctx, "contacts.sms_requires_consent", true, boolOk);
  const repliesToThem = replyTo !== null && str(replyTo, "direction") === "in" && str(replyTo, "from") === to;
  if (requires && !repliesToThem && prefs?.smsConsent !== "granted") return "no_consent";
  return null;
}

function capCheck(ctx: TelCtx, numberId: string, caps: Caps, now: number): void {
  let hour = 0;
  let day = 0;
  let oldestHour = 0;
  let oldestDay = 0;
  for (const r of rowsOf(ctx.db.all(`SELECT * FROM telephony_send_log WHERE "numberId" = ?`, numberId))) {
    const at = num(r, "at");
    if (at <= now - DAY - HOUR) { ctx.db.run(`DELETE FROM telephony_send_log WHERE id = ?`, str(r, "id")); continue; }
    if (at > now - DAY) { day++; oldestDay = oldestDay === 0 ? at : Math.min(oldestDay, at); }
    if (at > now - HOUR) { hour++; oldestHour = oldestHour === 0 ? at : Math.min(oldestHour, at); }
  }
  if (hour + 1 > caps.perHour) {
    throw fail("rate_limit.exceeded", ctx.trace.traceId, { message: "This number reached its hourly text limit.", details: { limit: "perHour", max: caps.perHour, resetAt: (oldestHour || now) + HOUR } });
  }
  if (day + 1 > caps.perDay) {
    throw fail("rate_limit.exceeded", ctx.trace.traceId, { message: "This number reached its daily text limit.", details: { limit: "perDay", max: caps.perDay, resetAt: (oldestDay || now) + DAY } });
  }
}

interface SendIn {
  numberId: string; to: string; body: string; mediaFileIds?: string[]; contactId?: string; replyToId?: string; campaignId?: string; sendAt?: number; idempotencyKey: string;
}
interface SendOut { smsId?: string; status: "queued" | "sent" | "held" | "suppressed"; taskId?: string }

function check(ctx: TelCtx, input: SendIn): void {
  keyOf(ctx, input);
  if (!isId("num", input.numberId)) bad(ctx, "Number id is not valid.");
  phone(ctx, input.to, "The number to text");
  if (typeof input.body !== "string" || input.body === "" || input.body.length > MAX_BODY) bad(ctx, `A text is 1 to ${MAX_BODY} characters.`);
  if (input.mediaFileIds !== undefined && (!Array.isArray(input.mediaFileIds) || input.mediaFileIds.some((f) => !isId("fil", f)))) bad(ctx, "Picture ids are not valid.");
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (input.replyToId !== undefined && !isId("sms", input.replyToId)) bad(ctx, "Reply target id is not valid.");
  if (input.campaignId !== undefined && !isId("cmp", input.campaignId)) bad(ctx, "Campaign id is not valid.");
  if (input.sendAt !== undefined && !isInt(input.sendAt)) bad(ctx, "Send time is not valid.");
}

export async function sendSms(ctx: TelCtx, input: SendIn): Promise<SendOut> {
  ensure(ctx);
  check(ctx, input);
  if ((input.mediaFileIds ?? []).length > 0) refuse(ctx, "Texts with pictures are not available yet. Send the text on its own, or email the file.");
  const n = liveNumber(ctx, input.numberId);
  if (str(n, "state") !== "active") refuse(ctx, "That number is not active.");
  if (!parseJson<string[]>(n.capabilities, []).includes("sms")) refuse(ctx, "That number cannot send texts.");
  const actor = actorOf(ctx);
  const replyTo = input.replyToId === undefined ? null : first(ctx.db.all(`SELECT * FROM telephony_sms WHERE id = ?`, input.replyToId));
  if (input.replyToId !== undefined && !replyTo) throw fail("validation.not_found", ctx.trace.traceId, { message: "The text you are replying to is not in this Space." });
  const now = ctx.now();

  // a scheduled call coming back for a text that waited in the queue
  const due = input.sendAt !== undefined && input.sendAt <= now
    ? rowsOf(ctx.db.all(`SELECT * FROM telephony_sms WHERE "numberId" = ?`, input.numberId)).find((r) => str(r, "status") === "queued" && str(r, "to") === input.to && str(r, "body") === input.body && num(r, "at") === input.sendAt) ?? null
    : null;

  const contactId = await contactOf(ctx, input.to, input.contactId ?? strOrUndef(strOrNull(due, "contactId")));
  const why = await refusalFor(ctx, input.to, contactId, replyTo);
  if (why !== null) {
    ctx.emit("message.suppressed", `address/${input.to}`, { channel: "sms", address: input.to, reason: why, ...(input.campaignId ? { campaignId: input.campaignId } : {}) });
    if (due) patch(ctx, "telephony_sms", str(due, "id"), { status: "failed" });
    return { status: "suppressed" };
  }

  const bulk = actor !== "person";
  const wanted = Math.max(now, input.sendAt ?? now);
  let when = wanted;
  if (bulk) {
    const win = await setting<Window>(ctx, "mail.send_window", DEFAULT_WINDOW, windowOk);
    const zone = await setting<string>(ctx, "profile.timezone", "UTC", zoneOk);
    const open = nextWindowStart(wanted, zone, win);
    if (open === null) return refuse(ctx, "The send window has no open time in the next week. Change the send window in Console, Comms.");
    when = open;
    capCheck(ctx, input.numberId, await setting<Caps>(ctx, "mail.sender_caps", DEFAULT_CAPS, capsOk), now);
  }

  if (when > now) {
    if (!ctx.schedule) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Scheduling is not available right now." });
    const id = due ? str(due, "id") : newId("sms", now);
    if (due) patch(ctx, "telephony_sms", id, { at: when });
    else insertSms(ctx, id, { n, input, contactId, status: "queued", at: when, direction: "out" });
    await ctx.schedule(when, "telephony.send_sms", { ...stripUndefined(input), sendAt: when, idempotencyKey: `${input.idempotencyKey}:due` });
    return { smsId: id, status: "queued" };
  }

  const id = due ? str(due, "id") : newId("sms", now);
  if (!due) insertSms(ctx, id, { n, input, contactId, status: "queued", at: now, direction: "out" });
  let sent: Json;
  try {
    sent = obj(await ctx.call("twilio.sms.send", { from: str(n, "e164"), to: input.to, body: input.body, idempotencyKey: `${input.idempotencyKey}:send` }));
  } catch (e) {
    patch(ctx, "telephony_sms", id, { status: "failed" });
    ctx.emit("message.failed", `entity/${id}`, { messageId: id, channel: "sms", reason: (e as { error?: { code?: string } } | null)?.error?.code ?? "failed" });
    throw e;
  }
  const sid = text(sent.sid);
  if (sid === "") {
    patch(ctx, "telephony_sms", id, { status: "failed" });
    ctx.emit("message.failed", `entity/${id}`, { messageId: id, channel: "sms", reason: "provider.bad_response" });
    throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the text." });
  }
  const status = text(sent.status) === "queued" || text(sent.status) === "accepted" ? "queued" : "sent";
  patch(ctx, "telephony_sms", id, { status: status === "queued" ? "queued" : "sent", twilioSid: sid, at: now });
  if (bulk) ctx.db.run(`INSERT INTO telephony_send_log ("id", "numberId", "at") VALUES (?, ?, ?)`, newId("tsl", now), input.numberId, now);
  ctx.emit("message.sent", `entity/${id}`, { messageId: id, channel: "sms", ...(contactId ? { contactId } : {}), ...(input.campaignId ? { campaignId: input.campaignId } : {}) });
  await ctx.call("inbox.link_message", {
    channel: "sms", ref: { kind: "sms", id }, address: input.to, direction: "out", at: now, numberId: input.numberId, ...(input.campaignId ? { campaignId: input.campaignId } : {}), preview: input.body.slice(0, 140),
  });
  return { smsId: id, status: status === "queued" ? "queued" : "sent" };
}

function stripUndefined(input: SendIn): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

export function insertSms(ctx: TelCtx, id: string, o: { n: Row; input: Pick<SendIn, "to" | "body" | "campaignId">; contactId: string | undefined; status: string; at: number; direction: "in" | "out" }): void {
  ctx.db.run(
    `INSERT INTO telephony_sms ("id", "numberId", "direction", "from", "to", "body", "status", "contactId", "mediaFileIds", "campaignId", "at", "traceId", "version", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(o.n, "id"), o.direction, str(o.n, "e164"), o.input.to, o.input.body, o.status, o.contactId ?? null, "[]", o.input.campaignId ?? null, o.at, ctx.trace.traceId, 0, ctx.now(),
  );
}

// ---- telephony.sms.list

export async function smsList(ctx: TelCtx, input: { numberId?: string; contactId?: string; direction?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  if (input.direction !== undefined && input.direction !== "in" && input.direction !== "out") bad(ctx, "Direction is in or out.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM telephony_sms`)).filter((r) => (r.deleted_at === null || r.deleted_at === undefined)
    && (input.numberId === undefined || str(r, "numberId") === input.numberId) && (input.contactId === undefined || str(r, "contactId") === input.contactId)
    && (input.direction === undefined || str(r, "direction") === input.direction));
  rows.sort((a, b) => num(b, "at") - num(a, "at") || str(b, "id").localeCompare(str(a, "id")));
  const p = pageOf(rows, cursor, limit);
  return { messages: p.page.map(smsOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

