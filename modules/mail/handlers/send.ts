// The single send API (spec 2.18 Sending, Single send API, Message status; ARCH 8.2): mail.send, mail.send_preview, mail.send_as.
//
// One door for every outgoing email. Automations, agents and people all arrive here, and every send is checked the same way:
//   suppression list, consent flags, then the provider. Regular email (a welcome, a nurture step, an appointment confirmation, a newsletter) is an Automation, so it must leave when
//   the flow says: this door holds no send windows, no per-mailbox caps and no throttling. A provider that pushes back answers provider.rate_limited, and the step retries.
// Space sending goes out through the Space's Resend or Mailgun domain; a member's reply goes out through the member's own Gmail or
// Graph mailbox. The "Drafted by an agent" line is added to every message an agent sent or drafted. Every send carries the trace id
// in an X-Vyre-Trace header and on the message row.
//
// The Gate (spec 2.14) is applied by the invoke pipeline before this code runs: mail.send and mail.send_as declare `gate: 'send'`, and
// `sendGateApplies` below is the rule the Gate hook asks. An agent or an automation is held for approval; an ordinary
// person's send is not. Code that runs here has already passed the Gate or never needed it.
//
// DECISION: `unsubscribe: true` puts a link and the List-Unsubscribe headers on the message (handlers/unsubscribe.ts). The Automations send step always sets it. A link is one person's, so such a
// message to several people goes out once per recipient.
// DECISION: with no public address there is no link to give. A mailing to several people is refused in those words; one email to one person (an appointment confirmation) goes out without the link.
// DECISION: consent 'unknown' sends (opt-out regime: STOP, UNSUBSCRIBE and bounces write the suppression list). Only an explicit
// 'denied', Do-not-contact or an email opt-out refuses.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { isTenantService } from "../../../lib/trust.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  allow, bad, EMAIL, ensure, first, isId, missing, newId, normalizeEmail, num, partyJson, readStrings, rowsOf, snippetOf, statements, str, strOrNull,
} from "../projections.ts";
import type { MailCtx, Party, Row } from "../projections.ts";
import { footerHtml, footerText, hasPublicAddress, unsubscribeLink } from "./unsubscribe.ts";

// ---- shapes

export interface SendCtx extends MailCtx {
  /** Where the call came from: 'user' for a person at a screen, anything else for automations and other engines. */
  origin?: string;
  schedule?(at: number, cap: string, input: unknown): Promise<string>;
}

export type Route = "mailbox" | "space_domain";
export type Actor = "person" | "agent" | "automation";

export interface SendIn {
  mailboxId: string;
  /** An id from comms.senders.list; for email it is the mailbox id, so it must equal mailboxId. Present: the sender is also checked for being connected before anything is sent. */
  senderId?: string;
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
  draftId?: string;
  sendAt?: number;
  /** Carry an unsubscribe link and the List-Unsubscribe headers. */
  unsubscribe?: boolean;
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
  senderId?: string;
  to: Party[];
  cc?: Party[];
  bcc?: Party[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: string[];
  replyToMessageId?: string;
  contactId?: string;
  draftId?: string;
  idempotencyKey: string;
}

export interface PreviewIn {
  mailboxId: string;
  senderId?: string;
  channel?: "email";
  to: Party[];
}

export interface PreviewOut {
  allowed: string[];
  suppressed: { address: string; reason: string }[];
  providerRoute: Route;
}

export const TRACE_HEADER = "X-Vyre-Trace";
export const AGENT_LINE = "Drafted by an agent";
const AGENT_TEXT = `\n\n-- \n${AGENT_LINE}`;
const AGENT_HTML = `<p style="margin-top:24px;color:#6b6b6b;font-size:12px">${AGENT_LINE}</p>`;

// ---- the Gate rule (spec 2.14: "Ordinary human sends do not pass the Gate")

/** Who is sending, as the Gate sees it. Automations run with an origin other than 'user'. */
export function actorOf(principalKind: MailCtx["principal"]["kind"], origin: string | undefined): Actor {
  if (principalKind === "agent") return "agent";
  const from = origin ?? "user";
  if (from !== "user" || principalKind === "service" || principalKind === "actor") return "automation";
  return "person";
}

/**
 * The question the Gate hook asks before mail.send and mail.send_as run: does the 'send' act apply to this call?
 * An agent or an automation is held for approval (unless the effective rule allows it, which the Gate decides);
 * a person sending their own mail is not.
 */
export function sendGateApplies(call: { principalKind: MailCtx["principal"]["kind"]; origin?: string | undefined }): { act: "send" } | null {
  return actorOf(call.principalKind, call.origin) === "person" ? null : { act: "send" };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/0003_unsubscribe.sql", import.meta.url)), "utf8");

function ensureSend(ctx: SendCtx): void {
  ensure(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT token_hash FROM mail_unsub WHERE token_hash = ?`, "probe");
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

const providerOk = (v: unknown): v is "resend" | "mailgun" => v === "resend" || v === "mailgun";
const boolOk = (v: unknown): v is boolean => typeof v === "boolean";
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
  /** The address of this person's unsubscribe link, once the message carries one. */
  listUnsubscribe?: string;
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
  // A top-level contact names the first To recipient when that recipient carries none.
  const firstTo = lists.to[0];
  if (input.contactId && firstTo && !firstTo.contactId) firstTo.contactId = input.contactId;
  return {
    ...lists, subject: input.subject, text: textBody, html: htmlBody, files, contactId: input.contactId ?? strOrNull(draft, "contactId") ?? undefined,
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

/** Use of the mailbox, plus comms.shared_send on a shared inbox. An agent acting for a person sends from what that person may send from (the kernel's ceiling); a Space rule can turn agent sending off. */
function authorizeSender(ctx: SendCtx, box: Row): void {
  // a Space Automation holds `use` on the mailboxes a person's press gave it (modules/automations/grants.ts), so that grant is the whole answer: it has no role to carry comms.shared_send
  const perm = str(box, "kind") === "shared" && !isTenantService(ctx.principal) ? "comms.shared_send" : null;
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
  // a Personal Automation runs as its owner, so their own Gmail or Outlook is theirs to send from; a Space Automation goes through the Space domain
  const asked = ctx.principal.kind === "agent" && ctx.actingFor === strOrNull(box, "ownerId");   // an agent sends from its person's own Gmail or Outlook as that person would
  return memberProvider(box) && (actor === "person" || ctx.principal.kind === "person" || asked) ? "mailbox" : "space_domain";
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

// ---- the plan: everything decided before a byte leaves

interface Plan {
  box: Row;
  actor: Actor;
  route: Route;
  composed: Composed;
  allowed: Party[];
  suppressed: { address: string; reason: string }[];
  /** the Space sending domain row and provider, when the route is space_domain */
  domain: Row | null;
  provider: "resend" | "mailgun";
  now: number;
}

/** A sender chosen from comms.senders.list must still be there, allowed and connected at send time; the refusal says what to do. A connection still waiting for its first sync can send (the first send proves it). */
function checkChosenSender(ctx: SendCtx, box: Row): void {
  const state = str(box, "state");
  if (state === "disconnected") refuse(ctx, "That sender is disconnected. Connect it again in Console, Comms, or pick another sender.");
  if (state === "paused" || num(box, "paused") === 1) refuse(ctx, "That sender is paused. Resume it in Console, Comms, or pick another sender.");
  if (state === "error") refuse(ctx, "That sender needs to be reconnected. Sign in again in Console, Comms, or pick another sender.");
}

/** senderId is the mailbox id for email; naming two different ones is a mistake, not a choice. */
function agreeSender(ctx: SendCtx, input: { mailboxId: string; senderId?: string }): void {
  if (input.senderId === undefined) return;
  if (!isId("mbx", input.senderId)) bad(ctx, "That sender is not an email sender. Pick one from the list of senders for email.");
  if (input.senderId !== input.mailboxId) bad(ctx, "The sender and the mailbox name different senders. Pass the same id for both.");
}

async function makePlan(ctx: SendCtx, input: SendIn | PreviewIn | SendAsIn, composed: Composed, requested: Route | undefined, enforce: boolean): Promise<Plan> {
  agreeSender(ctx, input);
  const box = loadMailbox(ctx, input.mailboxId);
  if (ctx.principal.kind === "agent" && !(await setting(ctx, "comms.agents_may_send", true, (v): v is boolean => typeof v === "boolean"))) refuse(ctx, "Agent sending is off in this Space. An admin can turn it on in Console.");
  authorizeSender(ctx, box);
  if (input.senderId !== undefined && enforce) checkChosenSender(ctx, box);
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
  return { box, actor, route, composed, allowed: flat(composed).filter((p) => !refusedSet.has(p.address)), suppressed, domain, provider, now: ctx.now() };
}

// ---- mail.send_preview

export async function sendPreview(ctx: SendCtx, input: PreviewIn): Promise<PreviewOut> {
  ensureSend(ctx);
  if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const to = cleanParties(ctx, input.to, "To");
  if (to.length === 0) bad(ctx, "At least one recipient is required.");
  const composed: Composed = { to: dedupe(to, [], []).to, cc: [], bcc: [], subject: "", text: undefined, html: undefined, files: [], contactId: undefined };
  const p = await makePlan(ctx, input, composed, undefined, false);
  return { allowed: p.allowed.map((a) => a.address), suppressed: p.suppressed, providerRoute: p.route };
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
    ctx.emit("message.suppressed", `address/${s.address}`, { channel: "email", address: s.address, reason: s.reason });
  }
  const refused = p.suppressed.map((s) => s.address);
  if (p.allowed.length === 0) {
    // a queued message whose recipients were all suppressed while it waited will never leave: it is marked failed, not left queued
    if (pending && str(pending, "status") === "queued") ctx.db.run(`UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`, "failed", num(pending, "version") + 1, now, str(pending, "id"));
    return remember(ctx, input.idempotencyKey, { status: "suppressed", suppressed: refused });
  }

  const sendable: Composed = narrow(composed, p.allowed);
  if (p.route === "space_domain" && !p.domain) refuse(ctx, `No verified ${p.provider} sending domain. Add and verify one in Console, Comms.`);

  // a link is one person's, so a message that carries links goes out once per recipient
  if (input.unsubscribe === true && p.allowed.length > 1 && !pending) {
    if (!hasPublicAddress()) refuse(ctx, "This Space has no public address yet, so its emails could not carry an unsubscribe link.");
    const { cc: _cc, bcc: _bcc, ...one } = input;
    const each: SendOut[] = [];
    for (const party of p.allowed) each.push(await send(ctx, { ...one, to: [party], idempotencyKey: `${input.idempotencyKey}:${party.address}` }));
    const lead = each.find((e) => e.messageId !== undefined)?.messageId;
    return remember(ctx, input.idempotencyKey, { ...(lead ? { messageId: lead } : {}), status: each.some((e) => e.status === "sent") ? "sent" : "queued", suppressed: refused });
  }

  const when = Math.max(now, input.sendAt ?? now);
  const row = pending ? str(pending, "id") : newId("eml", now);

  if (when > now) {
    // scheduled: the message waits as a queued row and a scheduled call delivers it
    if (!ctx.schedule) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Scheduling is not available right now." });
    writeRow(ctx, p, sendable, parent, pending, row, "queued", when, null);
    const again: Record<string, unknown> = { ...stripUndefined(input), to: sendable.to, cc: sendable.cc, bcc: sendable.bcc, draftId: row, idempotencyKey: `${input.idempotencyKey}:due` };
    delete again.sendAt;
    await ctx.schedule(when, "mail.send", again);
    return remember(ctx, input.idempotencyKey, { messageId: row, status: "queued", suppressed: refused });
  }

  const sent = await deliver(ctx, p, sendable, parent, pending, row, input.unsubscribe === true);
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
async function deliver(ctx: SendCtx, p: Plan, c: Composed, parent: Row | null, pending: Row | null, id: string, unsubscribe = false): Promise<Delivered> {
  const agentLine = (await agentLabelOn(ctx)) && (p.actor === "agent" || strOrNull(pending, "draftedByAgent") !== null);
  const signed: Composed = agentLine ? { ...c, text: c.text === undefined ? undefined : c.text + AGENT_TEXT, html: c.html === undefined ? undefined : withAgentHtml(c.html) } : c;
  if (agentLine && signed.text === undefined && signed.html === undefined) bad(ctx, "A message needs a text or an html body.");
  const everyone = flat(signed);
  const link = unsubscribe && everyone.length === 1 ? await unsubscribeLink(ctx, (everyone[0] as Party).address) : null;
  const final: Composed = link === null ? signed : {
    ...signed, listUnsubscribe: link, text: signed.text === undefined ? undefined : signed.text + footerText(link),
    html: signed.html === undefined ? undefined : beforeBodyEnd(signed.html, footerHtml(link)),
  };
  const domain = p.domain ? str(p.domain, "name") : domainOf(str(p.box, "address"));
  const rfcId = p.route === "space_domain" ? `<${id}@${domain}>` : null;
  const now = ctx.now();
  writeRow(ctx, p, final, parent, pending, id, "queued", now, rfcId);
  let providerId: string | null;
  try {
    providerId = p.route === "space_domain" ? await viaSpaceDomain(ctx, p, final, parent, id, rfcId) : await viaMailbox(ctx, p.box, final, id);
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

function beforeBodyEnd(html: string, tail: string): string {
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? html + tail : html.slice(0, at) + tail + html.slice(at);
}

function withAgentHtml(html: string): string {
  return beforeBodyEnd(html, AGENT_HTML);
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
        attachments = ?, "draftedByAgent" = ?, "traceId" = ?, "rfcMessageId" = ?, version = ?, updated_at = ? WHERE id = ?`,
      status, own, partyJson(c.to), partyJson(c.cc), c.subject, snippetOf(c.text, c.subject), bodyText, at, contactId, files, draftedBy,
      ctx.trace.traceId, rfcId, num(pending, "version") + 1, now, id,
    );
    ctx.db.run(`UPDATE mail_body SET text = ?, html = ?, bcc = ?, headers = ? WHERE "messageId" = ?`, c.text ?? null, c.html ?? null, partyJson(c.bcc), headers, id);
    return;
  }
  ctx.db.run(
    `INSERT INTO mail_message (
      id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
      "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
      "isPrivate", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(p.box, "id"), JSON.stringify([str(p.box, "id")]), null, rfcId, threadId, "out", status,
    own, partyJson(c.to), partyJson(c.cc), c.subject, snippetOf(c.text, c.subject), bodyText, at, contactId,
    str(p.box, "privacy") === "private" ? 1 : 0, files, draftedBy, ctx.trace.traceId, 1, now, null,
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
    mailboxId: str(p.box, "id"), from, to: c.to.map((x) => x.address), subject: c.subject,
    headers: { ...outHeaders(ctx, parent, rfcId), ...(c.listUnsubscribe ? { "List-Unsubscribe": `<${c.listUnsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}) },
    idempotencyKey: id,   // the provider capabilities need a key; the message id is stable across the one delivery of this message
  };
  if (title && title !== own) body.fromName = title;
  if (c.cc.length) body.cc = c.cc.map((x) => x.address);
  if (c.bcc.length) body.bcc = c.bcc.map((x) => x.address);
  if (from !== own) body.replyTo = own;
  if (c.text !== undefined) body.text = c.text;
  if (c.html !== undefined) body.html = c.html;
  if (c.files.length) body.attachments = await attachmentsOf(ctx, c.files);
  const tags = [{ name: "message_id", value: id }];
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
async function viaMailbox(ctx: SendCtx, box: Row, c: Composed, id: string): Promise<string | null> {
  const body: Record<string, unknown> = {
    connectionId: str(box, "connectionId"), as: str(box, "address"), to: c.to.map((x) => x.address), subject: c.subject, idempotencyKey: id,
  };
  if (c.cc.length) body.cc = c.cc.map((x) => x.address);
  if (c.bcc.length) body.bcc = c.bcc.map((x) => x.address);
  if (c.text !== undefined) body.text = c.text;
  if (c.html !== undefined) body.html = c.html;
  if (c.files.length) body.attachments = c.files;
  // a mailbox made by a person's own sign-in sends through that account (google.user.*, ms.user.*), not through the Space's delegation
  const own = /^(gua|mua)_/.test(str(box, "connectionId"));
  if (own) {
    const { connectionId, as: _as, ...rest } = body;
    const mine = { ...rest, accountId: connectionId };
    if (str(box, "provider") === "google") return text(obj(await ctx.call("google.user.send_message", mine)).id) ?? null;
    await ctx.call("ms.user.send_message", mine);
    return null;
  }
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
  const payload: { messageId: string; channel: "email"; mailboxId: string; contactId?: string } = { messageId: id, channel: "email", mailboxId: str(p.box, "id") };
  const contactId = c.contactId ?? c.to[0]?.contactId;
  if (contactId) payload.contactId = contactId;
  ctx.emit("message.sent", `mail_message/${id}`, payload);
}

// ---- mail.send_as

/**
 * Send through a member's own Gmail, Graph or IMAP mailbox: the door for replies and for a person's own mail. Suppression and consent
 * still apply, because one list is consulted for every sender; a suppressed recipient refuses the send instead of being dropped from
 * a reply without the person noticing.
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
