// The single send API (spec 2.18 Sending, Single send API, Message status; ARCH 8.2): mail.send, mail.send_preview, mail.send_as.
//
// One door for every outgoing email. Campaigns, automations, agents and people all arrive here, and every send is checked the same way:
//   suppression list, consent flags, caps per sender, send windows, throttling per sending domain (or mailbox), then the provider.
// Space sending goes out through the Space's Resend or Mailgun domain; a member's reply goes out through the member's own Gmail or
// Graph mailbox. The "Drafted by an agent" line is added to every message an agent sent or drafted. Every send carries the trace id
// in an X-Vyre-Trace header and on the message row.
//
// The Gate (spec 2.14) is applied by the invoke pipeline before this code runs: mail.send and mail.send_as declare `gate: 'send'`, and
// `sendGateApplies` below is the rule the Gate hook asks. An agent, an automation or a campaign is held for approval; an ordinary
// person's send is not. Code that runs here has already passed the Gate or never needed it.
//
// DECISION: windows, throttling and caps apply to Space sending and to every non-person actor. A person who sends or replies through
// their own mailbox is not made to wait for a window or counted against a cold-email cap; suppression and consent still apply.
// DECISION: the recipient time zone is not stored anywhere in v1 data (contacts have no zone field), so `zone: 'recipient'` falls back
// to the sender's own `profile.timezone`. A message outside the window is queued, not refused, and delivered by a scheduled call.
// DECISION: a hit on a cap is refused (rate_limit.exceeded), because waiting a day silently is worse than telling the sender;
// a window or throttle miss is queued, because the sender did nothing wrong.
// DECISION: consent 'unknown' sends (opt-out regime: STOP, UNSUBSCRIBE and bounces write the suppression list). Only an explicit
// 'denied', Do-not-contact or an email opt-out refuses.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  allow, bad, EMAIL, ensure, first, isId, missing, newId, normalizeEmail, num, partyJson, readStrings, rowsOf, snippetOf, statements, str, strOrNull,
} from "../projections.ts";
import type { MailCtx, Party, Row } from "../projections.ts";

// ---- shapes

export interface SendCtx extends MailCtx {
  /** Where the call came from: 'user' for a person at a screen, anything else for automations, campaigns and other engines. */
  origin?: string;
  schedule?(at: number, cap: string, input: unknown): Promise<string>;
}

export type Route = "mailbox" | "space_domain";
export type Actor = "person" | "agent" | "automation" | "campaign";

export interface SendIn {
  mailboxId: string;
  route?: Route;
  to: Party[];
  cc?: Party[];
  bcc?: Party[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: string[];
  replyToMessageId?: string;
  contactId?: string;
  campaignId?: string;
  draftId?: string;
  sendAt?: number;
  idempotencyKey: string;
}

export interface SendOut {
  messageId?: string;
  status: "queued" | "sent" | "held" | "suppressed";
  taskId?: string;
  suppressed: string[];
}

export interface SendAsIn {
  mailboxId: string;
  to: Party[];
  cc?: Party[];
  bcc?: Party[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: string[];
  replyToMessageId?: string;
  contactId?: string;
  campaignId?: string;
  draftId?: string;
  idempotencyKey: string;
}

export interface PreviewIn {
  mailboxId: string;
  channel?: "email";
  to: Party[];
  campaignId?: string;
}

export interface PreviewOut {
  allowed: string[];
  suppressed: { address: string; reason: string }[];
  outsideWindow: string[];
  capRemainingToday?: number;
  nextWindowAt?: number;
  providerRoute: Route;
}

interface Caps { perHour: number; perDay: number }
interface Window { days: number[]; startHour: number; endHour: number; zone: "recipient" | "space" }
interface Throttle { perMinute: number }

// The manifest defaults (manifests/mail.ts settings); used when the settings service gives nothing usable.
const DEFAULT_CAPS: Caps = { perHour: 30, perDay: 150 };
const DEFAULT_WINDOW: Window = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18, zone: "recipient" };
const DEFAULT_THROTTLE: Throttle = { perMinute: 60 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const STEP = 15 * MINUTE;
const KEEP = DAY + HOUR;   // send-log rows older than this are pruned

export const TRACE_HEADER = "X-Vyre-Trace";
export const AGENT_LINE = "Drafted by an agent";
const AGENT_TEXT = `\n\n-- \n${AGENT_LINE}`;
const AGENT_HTML = `<p style="margin-top:24px;color:#6b6b6b;font-size:12px">${AGENT_LINE}</p>`;

// ---- the Gate rule (spec 2.14: "Ordinary human sends do not pass the Gate")

/** Who is sending, as the Gate sees it. Campaign and automation engines run with an origin other than 'user'. */
export function actorOf(principalKind: MailCtx["principal"]["kind"], origin: string | undefined): Actor {
  if (principalKind === "agent") return "agent";
  const from = origin ?? "user";
  if (from.startsWith("campaign")) return "campaign";
  if (from !== "user" || principalKind === "service" || principalKind === "actor") return "automation";
  return "person";
}

/**
 * The question the Gate hook asks before mail.send and mail.send_as run: does the 'send' act apply to this call?
 * An agent, an automation or a campaign is held for approval (unless the effective rule allows it, which the Gate decides);
 * a person sending their own mail is not.
 */
export function sendGateApplies(call: { principalKind: MailCtx["principal"]["kind"]; origin?: string | undefined }): { act: "send" } | null {
  return actorOf(call.principalKind, call.origin) === "person" ? null : { act: "send" };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/0002_send_log.sql", import.meta.url)), "utf8");

function ensureSend(ctx: SendCtx): void {
  ensure(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT id FROM mail_send_log WHERE id = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- small helpers

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const refuse = (ctx: SendCtx, message: string): never => {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
};
const domainOf = (address: string): string => address.split("@")[1] ?? "";

async function setting<T>(ctx: SendCtx, key: string, fallback: T, ok: (v: unknown) => v is T): Promise<T> {
  try {
    const value = obj(obj(await ctx.call("settings.get", { key })).row).value;
    return ok(value) ? value : fallback;
  } catch {
    return fallback;   // the manifest default stands when the settings service gives nothing
  }
}

const capsOk = (v: unknown): v is Caps => isInt(obj(v).perHour) && isInt(obj(v).perDay) && (obj(v).perHour as number) > 0 && (obj(v).perDay as number) > 0;
const throttleOk = (v: unknown): v is Throttle => isInt(obj(v).perMinute) && (obj(v).perMinute as number) > 0;
const windowOk = (v: unknown): v is Window => {
  const w = obj(v);
  return Array.isArray(w.days) && w.days.length > 0 && w.days.every((d) => isInt(d) && d >= 1 && d <= 7)
    && isInt(w.startHour) && w.startHour >= 0 && w.startHour <= 23 && isInt(w.endHour) && w.endHour >= 1 && w.endHour <= 24
    && (w.zone === "recipient" || w.zone === "space");
};
const providerOk = (v: unknown): v is "resend" | "mailgun" => v === "resend" || v === "mailgun";
const boolOk = (v: unknown): v is boolean => typeof v === "boolean";
const zoneOk = (v: unknown): v is string => typeof v === "string" && validZone(v);

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ---- send windows

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** ISO weekday (1 Monday to 7 Sunday) and hour (0 to 23) of an instant in a zone. */
function localTime(ms: number, zone: string): { day: number; hour: number } {
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

/** An instant is inside the window when its local weekday is listed and its local hour is from start (inclusive) to end (exclusive); start at or after end wraps past midnight. */
export function inWindow(ms: number, zone: string, w: Pick<Window, "days" | "startHour" | "endHour">): boolean {
  const { day, hour } = localTime(ms, zone);
  if (!w.days.includes(day)) return false;
  return w.startHour < w.endHour ? hour >= w.startHour && hour < w.endHour : hour >= w.startHour || hour < w.endHour;
}

/** The first quarter hour at or after `ms` that is inside the window; the grid hits every zone's hour boundary. Null when the window never opens within a week. */
export function nextWindowStart(ms: number, zone: string, w: Pick<Window, "days" | "startHour" | "endHour">): number | null {
  if (inWindow(ms, zone, w)) return ms;
  let t = ms - (ms % STEP) + STEP;
  for (let i = 0; i < 8 * 96; i++, t += STEP) if (inWindow(t, zone, w)) return t;
  return null;
}

// ---- recipients

function cleanParties(ctx: SendCtx, list: unknown, label: string): Party[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return bad(ctx, `${label} must be a list.`);
  return list.map((raw: unknown) => {
    const p = obj(raw);
    const address = normalizeEmail(typeof p.address === "string" ? p.address : "");
    if (!EMAIL.test(address)) bad(ctx, `${label} has an address that is not an email.`);
    const out: Party = { address };
    if (typeof p.name === "string" && p.name) out.name = p.name;
    if (p.contactId !== undefined) {
      if (!isId("rec", p.contactId)) bad(ctx, "Contact id is not valid.");
      out.contactId = p.contactId as string;
    }
    return out;
  });
}

/** One recipient field everywhere (spec 2.18): an address appears once, To before Cc before Bcc. */
function dedupe(to: Party[], cc: Party[], bcc: Party[]): { to: Party[]; cc: Party[]; bcc: Party[] } {
  const seen = new Set<string>();
  const keep = (list: Party[]): Party[] => list.filter((p) => {
    if (seen.has(p.address)) return false;
    seen.add(p.address);
    return true;
  });
  const a = keep(to);
  const b = keep(cc);
  return { to: a, cc: b, bcc: keep(bcc) };
}

interface Composed {
  to: Party[];
  cc: Party[];
  bcc: Party[];
  subject: string;
  text: string | undefined;
  html: string | undefined;
  files: string[];
  contactId: string | undefined;
  campaignId: string | undefined;
}

function compose(ctx: SendCtx, input: SendAsIn | SendIn, draft: Row | null): Composed {
  if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (typeof input.subject !== "string") bad(ctx, "Subject is required.");
  const to = cleanParties(ctx, input.to, "To");
  if (to.length === 0) bad(ctx, "At least one recipient is required.");
  const lists = dedupe(to, cleanParties(ctx, input.cc, "Cc"), cleanParties(ctx, input.bcc, "Bcc"));
  const body = draft ? bodyOf(ctx, str(draft, "id")) : null;
  const textBody = input.text ?? strOrNull(body, "text") ?? undefined;
  const htmlBody = input.html ?? strOrNull(body, "html") ?? undefined;
  if (!textBody && !htmlBody) bad(ctx, "A message needs a text or an html body.");
  const files = input.attachments ?? [];
  for (const f of files) if (!isId("fil", f)) bad(ctx, "Attachment id is not valid.");
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (input.campaignId !== undefined && !isId("cmp", input.campaignId)) bad(ctx, "Campaign id is not valid.");
  // A top-level contact names the first To recipient when that recipient carries none.
  const firstTo = lists.to[0];
  if (input.contactId && firstTo && !firstTo.contactId) firstTo.contactId = input.contactId;
  return {
    ...lists, subject: input.subject, text: textBody, html: htmlBody, files, contactId: input.contactId ?? strOrNull(draft, "contactId") ?? undefined,
    campaignId: input.campaignId ?? strOrNull(draft, "campaignId") ?? undefined,
  };
}

function bodyOf(ctx: SendCtx, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_body WHERE "messageId" = ?`, id));
}

const flat = (c: Pick<Composed, "to" | "cc" | "bcc">): Party[] => [...c.to, ...c.cc, ...c.bcc];

// ---- mailbox, route, sender

function loadMailbox(ctx: SendCtx, id: string): Row {
  const box = first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, id));
  return box ?? missing(ctx, "Mailbox does not exist.");
}

/** Use of the mailbox, plus the sender's own permission: comms.agent_send for an agent, comms.shared_send for a person on a shared inbox. */
function authorizeSender(ctx: SendCtx, box: Row): void {
  const perm = ctx.principal.kind === "agent" ? "comms.agent_send" : str(box, "kind") === "shared" ? "comms.shared_send" : null;
  const resource = { type: "mailbox", id: str(box, "id") };
  if (!perm) return allow(ctx, "use", resource);
  const decision = ctx.authorize({ perm, level: "use" }, resource);
  if (decision.effect !== "allow") throw fail("permission.no_grant", ctx.trace.traceId, { details: { perm } });
}

const memberProvider = (box: Row): boolean => ["google", "microsoft"].includes(str(box, "provider"));

function resolveRoute(ctx: SendCtx, box: Row, actor: Actor, requested: Route | undefined): Route {
  if (requested !== undefined && requested !== "mailbox" && requested !== "space_domain") bad(ctx, "Route is not valid.");
  if (requested === "mailbox") {
    if (!memberProvider(box)) refuse(ctx, "This mailbox cannot send mail. Send through the Space domain instead.");
    return "mailbox";
  }
  if (requested === "space_domain") return "space_domain";
  return memberProvider(box) && actor === "person" ? "mailbox" : "space_domain";
}

function pickDomain(ctx: SendCtx, provider: string, mailboxAddress: string): Row | null {
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_domain WHERE verified = ? AND deleted_at IS NULL`, 1)).filter((r) => str(r, "provider") === provider);
  const host = domainOf(mailboxAddress);
  return rows.find((r) => str(r, "name") === host) ?? rows.find((r) => num(r, "isDefault") === 1) ?? rows[0] ?? null;
}

// ---- suppression and consent (spec 2.18: one Suppression list is consulted by the single send API for every sender)

async function screen(ctx: SendCtx, parties: Party[]): Promise<{ address: string; reason: string }[]> {
  const refused = new Map<string, string>();
  const checked = obj(await ctx.call("contacts.suppression.check", { channel: "email", addresses: parties.map((p) => p.address) }));
  for (const row of Array.isArray(checked.suppressed) ? checked.suppressed : []) {
    const r = obj(row);
    if (typeof r.address === "string") refused.set(normalizeEmail(r.address), typeof r.reason === "string" ? r.reason : "suppressed");
  }
  const prefsOf = new Map<string, Record<string, unknown> | null>();
  for (const p of parties) {
    if (refused.has(p.address) || !p.contactId) continue;
    if (!prefsOf.has(p.contactId)) {
      try {
        prefsOf.set(p.contactId, obj(await ctx.call("contacts.preferences.get", { contactId: p.contactId })));
      } catch (e) {
        if (!(e instanceof HostError) || e.error.code !== "validation.not_found") throw e;   // a missing record has no preferences; any other failure stops the send
        prefsOf.set(p.contactId, null);
      }
    }
    const prefs = prefsOf.get(p.contactId);
    if (!prefs) continue;
    if (prefs.doNotContact === true) refused.set(p.address, "do_not_contact");
    else if (prefs.emailConsent === "denied") refused.set(p.address, "consent_denied");
    else if (Array.isArray(prefs.optedOut) && prefs.optedOut.includes("email")) refused.set(p.address, "opted_out");
  }
  return parties.filter((p) => refused.has(p.address)).map((p) => ({ address: p.address, reason: refused.get(p.address) ?? "suppressed" }));
}

// ---- caps and throttle counters

interface Usage { hour: number; day: number; oldestHour: number; oldestDay: number }

function usageOf(ctx: SendCtx, mailboxId: string, now: number): Usage {
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_send_log WHERE "mailboxId" = ?`, mailboxId));
  const u: Usage = { hour: 0, day: 0, oldestHour: 0, oldestDay: 0 };
  for (const r of rows) {
    const at = num(r, "at");
    if (at <= now - KEEP) { ctx.db.run(`DELETE FROM mail_send_log WHERE id = ?`, str(r, "id")); continue; }
    if (at > now - DAY) { u.day++; u.oldestDay = u.oldestDay === 0 ? at : Math.min(u.oldestDay, at); }
    if (at > now - HOUR) { u.hour++; u.oldestHour = u.oldestHour === 0 ? at : Math.min(u.oldestHour, at); }
  }
  return u;
}

/** When the throttle has room for `n` more recipients on a key: now, or the instant enough older sends leave the minute. Null when `n` alone is over the limit. */
function throttleAt(ctx: SendCtx, key: string, n: number, limit: number, now: number): number | null {
  if (n > limit) return null;
  const recent = rowsOf(ctx.db.all(`SELECT * FROM mail_send_log WHERE "throttleKey" = ?`, key)).map((r) => num(r, "at")).filter((at) => at > now - MINUTE).sort((a, b) => a - b);
  const over = recent.length + n - limit;
  if (over <= 0) return now;
  return (recent[over - 1] ?? now) + MINUTE;
}

// ---- the plan: everything decided before a byte leaves

interface Plan {
  box: Row;
  actor: Actor;
  route: Route;
  /** windows, throttling and caps apply */
  bulk: boolean;
  composed: Composed;
  allowed: Party[];
  suppressed: { address: string; reason: string }[];
  caps: Caps;
  window: Window;
  throttle: Throttle;
  zone: string;
  /** the Space sending domain row and provider, when the route is space_domain */
  domain: Row | null;
  provider: "resend" | "mailgun";
  throttleKey: string;
  now: number;
}

async function makePlan(ctx: SendCtx, input: SendIn | PreviewIn | SendAsIn, composed: Composed, requested: Route | undefined, enforce: boolean): Promise<Plan> {
  const box = loadMailbox(ctx, input.mailboxId);
  authorizeSender(ctx, box);
  const actor = actorOf(ctx.principal.kind, ctx.origin);
  const route = resolveRoute(ctx, box, actor, requested);
  if (route === "mailbox" && enforce) {
    if (["paused", "disconnected", "error"].includes(str(box, "state")) || num(box, "paused") === 1) refuse(ctx, "This mailbox is not connected. Resume or reconnect it first.");
    if (!strOrNull(box, "connectionId")) refuse(ctx, "This mailbox has no connection to send through.");
  }
  const provider = await setting<"resend" | "mailgun">(ctx, "mail.provider", "resend", providerOk);
  const domain = route === "space_domain" ? pickDomain(ctx, provider, str(box, "address")) : null;
  const suppressed = await screen(ctx, flat(composed));
  const refusedSet = new Set(suppressed.map((s) => s.address));
  const profileZone = await setting<string>(ctx, "profile.timezone", "UTC", zoneOk);
  const win = await setting<Window>(ctx, "mail.send_window", DEFAULT_WINDOW, windowOk);
  return {
    box, actor, route, bulk: route === "space_domain" || actor !== "person", composed, allowed: flat(composed).filter((p) => !refusedSet.has(p.address)), suppressed,
    caps: await setting<Caps>(ctx, "mail.sender_caps", DEFAULT_CAPS, capsOk), window: win, throttle: await setting<Throttle>(ctx, "mail.throttle", DEFAULT_THROTTLE, throttleOk),
    // the recipient's own zone is not known in v1 data: both settings read the sender's zone
    zone: profileZone, domain, provider,
    throttleKey: route === "space_domain" ? `domain:${domain ? str(domain, "name") : "none"}` : `mailbox:${str(box, "id")}`, now: ctx.now(),
  };
}

/** The earliest instant this send may leave: the requested time, moved forward past the window and the throttle. Null when the window never opens. */
function earliest(ctx: SendCtx, p: Plan, wanted: number): number | null {
  let when = Math.max(p.now, wanted);
  if (!p.bulk) return when;
  for (let i = 0; i < 4; i++) {
    const open = nextWindowStart(when, p.zone, p.window);
    if (open === null) return null;
    when = open;
    const room = throttleAt(ctx, p.throttleKey, p.allowed.length, p.throttle.perMinute, when);
    if (room === null) return refuse(ctx, `The throttle allows ${p.throttle.perMinute} recipients a minute. Send to fewer people at once.`);
    if (room <= when) return when;
    when = room;
  }
  return when;
}

function capCheck(ctx: SendCtx, p: Plan): void {
  const used = usageOf(ctx, str(p.box, "id"), p.now);
  const n = p.allowed.length;
  if (used.hour + n > p.caps.perHour) {
    throw fail("rate_limit.exceeded", ctx.trace.traceId, { message: "This mailbox reached its hourly send limit.", details: { limit: "perHour", max: p.caps.perHour, resetAt: (used.oldestHour || p.now) + HOUR } });
  }
  if (used.day + n > p.caps.perDay) {
    throw fail("rate_limit.exceeded", ctx.trace.traceId, { message: "This mailbox reached its daily send limit.", details: { limit: "perDay", max: p.caps.perDay, resetAt: (used.oldestDay || p.now) + DAY } });
  }
}

// ---- mail.send_preview

export async function sendPreview(ctx: SendCtx, input: PreviewIn): Promise<PreviewOut> {
  ensureSend(ctx);
  if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const to = cleanParties(ctx, input.to, "To");
  if (to.length === 0) bad(ctx, "At least one recipient is required.");
  const composed: Composed = { to: dedupe(to, [], []).to, cc: [], bcc: [], subject: "", text: undefined, html: undefined, files: [], contactId: undefined, campaignId: input.campaignId };
  const p = await makePlan(ctx, input, composed, undefined, false);
  const out: PreviewOut = { allowed: p.allowed.map((a) => a.address), suppressed: p.suppressed, outsideWindow: [], providerRoute: p.route };
  if (p.bulk) {
    const used = usageOf(ctx, str(p.box, "id"), p.now);
    out.capRemainingToday = Math.max(0, Math.min(p.caps.perDay - used.day, p.caps.perHour - used.hour));
    if (!inWindow(p.now, p.zone, p.window)) {
      out.outsideWindow = out.allowed;
      const next = nextWindowStart(p.now, p.zone, p.window);
      if (next !== null) out.nextWindowAt = next;
    }
  }
  return out;
}

// ---- mail.send

export async function send(ctx: SendCtx, input: SendIn): Promise<SendOut> {
  ensureSend(ctx);
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0) bad(ctx, "Idempotency key is required.");
  if (input.sendAt !== undefined && !isInt(input.sendAt)) bad(ctx, "Send time is not valid.");
  const prior = strOrNull(first(ctx.db.all(`SELECT "refId" FROM mail_idem WHERE "idemKey" = ? AND kind = ?`, input.idempotencyKey, "send")), "refId");
  if (prior) return JSON.parse(prior) as SendOut;

  const pending = input.draftId === undefined ? null : loadPending(ctx, input.draftId, input.mailboxId);
  const parent = input.replyToMessageId === undefined ? null : loadParent(ctx, input.replyToMessageId, input.mailboxId);
  const composed = compose(ctx, input, pending);
  const p = await makePlan(ctx, input, composed, input.route, true);
  const now = p.now;

  // everyone suppressed: nothing is sent, nothing is stored; the refusal is an event per address
  for (const s of p.suppressed) {
    const payload: { channel: "email"; address: string; reason: string; campaignId?: string } = { channel: "email", address: s.address, reason: s.reason };
    if (composed.campaignId) payload.campaignId = composed.campaignId;
    ctx.emit("message.suppressed", `address/${s.address}`, payload);
  }
  const refused = p.suppressed.map((s) => s.address);
  if (p.allowed.length === 0) {
    // a queued message whose recipients were all suppressed while it waited will never leave: it is marked failed, not left queued
    if (pending && str(pending, "status") === "queued") ctx.db.run(`UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`, "failed", num(pending, "version") + 1, now, str(pending, "id"));
    return remember(ctx, input.idempotencyKey, { status: "suppressed", suppressed: refused });
  }

  const sendable: Composed = narrow(composed, p.allowed);
  if (p.bulk) capCheck(ctx, p);
  if (p.route === "space_domain" && !p.domain) refuse(ctx, `No verified ${p.provider} sending domain. Add and verify one in Console, Comms.`);

  const when = earliest(ctx, p, input.sendAt ?? now);
  if (when === null) return refuse(ctx, "The send window has no open time in the next week. Change the send window in Console, Comms.");
  const row = pending ? str(pending, "id") : newId("eml", now);

  if (when > now) {
    // outside the window, over the throttle or scheduled: the message waits as a queued row and a scheduled call delivers it
    if (!ctx.schedule) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Scheduling is not available right now." });
    writeRow(ctx, p, sendable, parent, pending, row, "queued", when, null);
    const again: Record<string, unknown> = { ...stripUndefined(input), to: sendable.to, cc: sendable.cc, bcc: sendable.bcc, draftId: row, idempotencyKey: `${input.idempotencyKey}:due` };
    delete again.sendAt;
    await ctx.schedule(when, "mail.send", again);
    return remember(ctx, input.idempotencyKey, { messageId: row, status: "queued", suppressed: refused });
  }

  const sent = await deliver(ctx, p, sendable, parent, pending, row);
  return remember(ctx, input.idempotencyKey, { messageId: sent.messageId, status: "sent", suppressed: refused });
}

function narrow(c: Composed, allowed: Party[]): Composed {
  const keep = new Set(allowed.map((a) => a.address));
  return { ...c, to: c.to.filter((p) => keep.has(p.address)), cc: c.cc.filter((p) => keep.has(p.address)), bcc: c.bcc.filter((p) => keep.has(p.address)) };
}

function stripUndefined(input: SendIn): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

function remember(ctx: SendCtx, key: string, out: SendOut): SendOut {
  ctx.db.run(`INSERT OR IGNORE INTO mail_idem ("idemKey", kind, "refId") VALUES (?, ?, ?)`, key, "send", JSON.stringify(out));
  return out;
}

function loadPending(ctx: SendCtx, id: string, mailboxId: string): Row {
  if (!isId("eml", id)) bad(ctx, "Draft id is not valid.");
  const row = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, id));
  if (!row) return missing(ctx, "Draft does not exist.");
  if (str(row, "mailboxId") !== mailboxId) bad(ctx, "That draft belongs to another mailbox.");
  if (!["draft", "queued"].includes(str(row, "status"))) refuse(ctx, "That message was already sent.");
  return row;
}

function loadParent(ctx: SendCtx, id: string, mailboxId: string): Row {
  if (!isId("eml", id)) bad(ctx, "Reply target id is not valid.");
  const parent = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, id));
  if (!parent || !readStrings(str(parent, "inboxIds")).includes(mailboxId)) return missing(ctx, "The message you are replying to is not in this mailbox.");
  return parent;
}

// ---- delivery

interface Delivered { messageId: string; providerId: string | null }

/** Write the row for a message, send it through the route's provider and settle the row. */
async function deliver(ctx: SendCtx, p: Plan, c: Composed, parent: Row | null, pending: Row | null, id: string): Promise<Delivered> {
  const agentLine = (await agentLabelOn(ctx)) && (p.actor === "agent" || strOrNull(pending, "draftedByAgent") !== null);
  const final: Composed = agentLine ? { ...c, text: c.text === undefined ? undefined : c.text + AGENT_TEXT, html: c.html === undefined ? undefined : withAgentHtml(c.html) } : c;
  if (agentLine && final.text === undefined && final.html === undefined) bad(ctx, "A message needs a text or an html body.");
  const domain = p.domain ? str(p.domain, "name") : domainOf(str(p.box, "address"));
  const rfcId = p.route === "space_domain" ? `<${id}@${domain}>` : null;
  const now = ctx.now();
  writeRow(ctx, p, final, parent, pending, id, "queued", now, rfcId);
  let providerId: string | null;
  try {
    providerId = p.route === "space_domain" ? await viaSpaceDomain(ctx, p, final, parent, id, rfcId) : await viaMailbox(ctx, p.box, final);
  } catch (e) {
    ctx.db.run(`UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`, "failed", nextVersion(ctx, id), ctx.now(), id);
    ctx.log.warn("mail.send failed", { messageId: id, route: p.route, traceId: ctx.trace.traceId });
    throw e;
  }
  settle(ctx, p, final, id, providerId, rfcId);
  return { messageId: id, providerId };
}

function nextVersion(ctx: SendCtx, id: string): number {
  return num(first(ctx.db.all(`SELECT version FROM mail_message WHERE id = ?`, id)), "version") + 1;
}

async function agentLabelOn(ctx: SendCtx): Promise<boolean> {
  return setting<boolean>(ctx, "gate.drafted_by_label", true, boolOk);
}

function withAgentHtml(html: string): string {
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? html + AGENT_HTML : html.slice(0, at) + AGENT_HTML + html.slice(at);
}

/** Insert the message row, or turn the draft or queued row into this message. */
function writeRow(ctx: SendCtx, p: Plan, c: Composed, parent: Row | null, pending: Row | null, id: string, status: string, at: number, rfcId: string | null): void {
  const now = ctx.now();
  const agentId = ctx.principal.kind === "agent" && isId("agt", ctx.principal.id) ? ctx.principal.id : null;
  const draftedBy = strOrNull(pending, "draftedByAgent") ?? (p.actor === "agent" ? agentId : null);
  const contactId = c.contactId ?? c.to[0]?.contactId ?? null;
  const own = str(p.box, "address");
  const threadId = strOrNull(pending, "threadId") ?? strOrNull(parent, "threadId") ?? id;
  const headers = JSON.stringify(outHeaders(ctx, parent, rfcId));
  const files = JSON.stringify(c.files.map((fileId) => ({ fileId })));
  const bodyText = c.text ?? c.html ?? "";
  if (pending) {
    ctx.db.run(
      `UPDATE mail_message SET status = ?, "fromAddress" = ?, "toAddresses" = ?, "ccAddresses" = ?, subject = ?, snippet = ?, body = ?, "sentAt" = ?, "contactId" = ?,
        "campaignId" = ?, attachments = ?, "draftedByAgent" = ?, "traceId" = ?, "rfcMessageId" = ?, version = ?, updated_at = ? WHERE id = ?`,
      status, own, partyJson(c.to), partyJson(c.cc), c.subject, snippetOf(c.text, c.subject), bodyText, at, contactId, c.campaignId ?? null, files, draftedBy,
      ctx.trace.traceId, rfcId, num(pending, "version") + 1, now, id,
    );
    ctx.db.run(`UPDATE mail_body SET text = ?, html = ?, bcc = ?, headers = ? WHERE "messageId" = ?`, c.text ?? null, c.html ?? null, partyJson(c.bcc), headers, id);
    return;
  }
  ctx.db.run(
    `INSERT INTO mail_message (
      id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
      "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
      "isPrivate", "campaignId", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(p.box, "id"), JSON.stringify([str(p.box, "id")]), null, rfcId, threadId, "out", status,
    own, partyJson(c.to), partyJson(c.cc), c.subject, snippetOf(c.text, c.subject), bodyText, at, contactId,
    str(p.box, "privacy") === "private" ? 1 : 0, c.campaignId ?? null, files, draftedBy, ctx.trace.traceId, 1, now, null,
  );
  ctx.db.run(
    `INSERT INTO mail_body ("messageId", text, html, "fromName", bcc, headers) VALUES (?, ?, ?, ?, ?, ?)`,
    id, c.text ?? null, c.html ?? null, null, partyJson(c.bcc), headers,
  );
}

function outHeaders(ctx: SendCtx, parent: Row | null, rfcId: string | null): Record<string, string> {
  const headers: Record<string, string> = { [TRACE_HEADER]: ctx.trace.traceId };
  if (rfcId) headers["Message-ID"] = rfcId;
  const parentRfc = strOrNull(parent, "rfcMessageId");
  if (parentRfc) {
    headers["In-Reply-To"] = parentRfc;
    headers.References = parentRfc;
  }
  return headers;
}

async function attachmentsOf(ctx: SendCtx, files: string[]): Promise<{ name: string; fileId: string }[]> {
  const out: { name: string; fileId: string }[] = [];
  for (const fileId of files) {
    const meta = obj(obj(await ctx.call("files.get", { fileId })).file);
    out.push({ name: text(meta.name) ?? fileId, fileId });
  }
  return out;
}

async function viaSpaceDomain(ctx: SendCtx, p: Plan, c: Composed, parent: Row | null, id: string, rfcId: string | null): Promise<string> {
  const domain = p.domain ? str(p.domain, "name") : "";
  const own = str(p.box, "address");
  const from = domainOf(own) === domain ? own : `${own.split("@")[0] ?? "mail"}@${domain}`;
  const title = str(p.box, "title");
  const body: Record<string, unknown> = {
    from, to: c.to.map((x) => x.address), subject: c.subject, headers: { ...outHeaders(ctx, parent, rfcId) },
  };
  if (title && title !== own) body.fromName = title;
  if (c.cc.length) body.cc = c.cc.map((x) => x.address);
  if (c.bcc.length) body.bcc = c.bcc.map((x) => x.address);
  if (from !== own) body.replyTo = own;
  if (c.text !== undefined) body.text = c.text;
  if (c.html !== undefined) body.html = c.html;
  if (c.files.length) body.attachments = await attachmentsOf(ctx, c.files);
  const tags = [{ name: "message_id", value: id }];
  if (c.campaignId) tags.push({ name: "campaign_id", value: c.campaignId });
  if (p.provider === "resend") {
    body.tags = tags;
    return acceptedId(ctx, await ctx.call("resend.send_email", body));
  }
  body.domain = domain;
  body.tags = tags.map((t) => `${t.name}:${t.value}`);
  return acceptedId(ctx, await ctx.call("mailgun.send_email", body));
}

function acceptedId(ctx: SendCtx, result: unknown): string {
  return text(obj(result).providerId) ?? (() => { throw fail("provider.bad_response", ctx.trace.traceId, { message: "The sending provider did not return a message id." }); })();
}

/** Send through the member's own Gmail or Graph mailbox, as the member. IMAP has no send path in v1. */
async function viaMailbox(ctx: SendCtx, box: Row, c: Composed): Promise<string | null> {
  const body: Record<string, unknown> = { connectionId: str(box, "connectionId"), as: str(box, "address"), to: c.to.map((x) => x.address), subject: c.subject };
  if (c.cc.length) body.cc = c.cc.map((x) => x.address);
  if (c.bcc.length) body.bcc = c.bcc.map((x) => x.address);
  if (c.text !== undefined) body.text = c.text;
  if (c.html !== undefined) body.html = c.html;
  if (c.files.length) body.attachments = c.files;
  if (str(box, "provider") === "google") return text(obj(await ctx.call("google.gmail.send_message", body)).id) ?? null;
  await ctx.call("ms.mail.send_message", body);   // Graph answers sent: true and no id; the Sent folder copy arrives through sync
  return null;
}

/** The provider accepted the message: the row becomes sent, the counters move, the event goes out. */
function settle(ctx: SendCtx, p: Plan, c: Composed, id: string, providerId: string | null, rfcId: string | null): void {
  const now = ctx.now();
  ctx.db.run(`UPDATE mail_message SET status = ?, "providerId" = ?, "sentAt" = ?, version = ?, updated_at = ? WHERE id = ?`, "sent", providerId, now, nextVersion(ctx, id), now, id);
  if (rfcId) ctx.db.run(`INSERT OR IGNORE INTO mail_rfc ("rfcMessageId", "messageId") VALUES (?, ?)`, rfcId, id);
  if (providerId) ctx.db.run(`INSERT OR IGNORE INTO mail_seen (source, "providerId", "messageId") VALUES (?, ?, ?)`, p.route === "space_domain" ? p.provider : str(p.box, "provider"), providerId, id);
  for (const r of flat(c)) {
    ctx.db.run(
      `INSERT INTO mail_send_log (id, "mailboxId", "throttleKey", address, "messageId", at) VALUES (?, ?, ?, ?, ?, ?)`,
      newId("snd", now), str(p.box, "id"), p.throttleKey, r.address, id, now,
    );
  }
  const payload: { messageId: string; channel: "email"; mailboxId: string; contactId?: string; campaignId?: string } = { messageId: id, channel: "email", mailboxId: str(p.box, "id") };
  const contactId = c.contactId ?? c.to[0]?.contactId;
  if (contactId) payload.contactId = contactId;
  if (c.campaignId) payload.campaignId = c.campaignId;
  ctx.emit("message.sent", `mail_message/${id}`, payload);
}

// ---- mail.send_as

/**
 * Send through a member's own Gmail, Graph or IMAP mailbox: the door for replies and for a person's own mail. Suppression and consent
 * still apply, because one list is consulted for every sender; a suppressed recipient refuses the send instead of being dropped from
 * a reply without the person noticing. Windows, throttling and caps do not apply to a person's own mail.
 */
export async function sendAs(ctx: SendCtx, input: SendAsIn): Promise<{ messageId: string; providerId?: string }> {
  ensureSend(ctx);
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0) bad(ctx, "Idempotency key is required.");
  const prior = strOrNull(first(ctx.db.all(`SELECT "refId" FROM mail_idem WHERE "idemKey" = ? AND kind = ?`, input.idempotencyKey, "send_as")), "refId");
  if (prior) return JSON.parse(prior) as { messageId: string; providerId?: string };
  try {
    const pending = input.draftId === undefined ? null : loadPending(ctx, input.draftId, input.mailboxId);
    const parent = input.replyToMessageId === undefined ? null : loadParent(ctx, input.replyToMessageId, input.mailboxId);
    const composed = compose(ctx, input, pending);
    const p = await makePlan(ctx, input, composed, "mailbox", true);
    if (p.suppressed.length > 0) {
      // nothing is sent and nothing is stored; the refusal names the addresses (mail.send_as declares no message.suppressed event)
      refuse(ctx, `Not sent. ${p.suppressed.map((s) => `${s.address} (${s.reason})`).join(", ")} cannot be emailed.`);
    }
    const id = pending ? str(pending, "id") : newId("eml", p.now);
    const sent = await deliver(ctx, p, composed, parent, pending, id);
    const out = sent.providerId ? { messageId: sent.messageId, providerId: sent.providerId } : { messageId: sent.messageId };
    ctx.db.run(`INSERT OR IGNORE INTO mail_idem ("idemKey", kind, "refId") VALUES (?, ?, ?)`, input.idempotencyKey, "send_as", JSON.stringify(out));
    return out;
  } catch (e) {
    // mail.send_as declares bad_input but not precondition_failed: the caller gets the same message under the declared code
    if (e instanceof HostError && e.error.code === "validation.precondition_failed") throw fail("validation.bad_input", ctx.trace.traceId, { message: e.error.message });
    throw e;
  }
}
