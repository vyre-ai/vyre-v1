// The Resend backend (spec 2.18 Sending, 2.19; ARCH 8, 8.2): the send.email backend behind mail.send, the Space's sending domains with the DNS records to
// publish, delivery events from /hooks/resend (applied with mail.status_update), inbound routes from /hooks/mail/resend (landed with mail.ingest).
//
// Nothing here decides whether to send: mail.send applies the caps, windows, throttling, suppression and the Gate before it calls resend.send_email.
// The raw webhook payloads are verified by the host (the connector source says `verify: 'hmac'`; Resend signs with Svix); `parseWebhook` and
// `parseInbound` turn a verified payload into the input of resend.receive_webhook and resend.receive_inbound for the host's webhook route.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { api, bad, ensure, first, list, needHost, obj, parseAddress, raw, strOrUndef, text } from "../projections.ts";
import type { Json, ResendCtx } from "../projections.ts";

type Dns = "pass" | "fail" | "pending";
type EventType = "sent" | "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "delayed";
const EVENT_TYPES: readonly EventType[] = ["sent", "delivered", "bounced", "complained", "opened", "clicked", "failed", "delayed"];

export interface DomainRow {
  providerDomainId: string;
  name: string;
  status: "not_started" | "pending" | "verified" | "failed";
  spf: Dns;
  dkim: Dns;
  dmarc: Dns;
  region?: string;
}
export interface DnsRecord {
  purpose: "spf" | "dkim" | "dmarc" | "mx" | "verify";
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  state: Dns;
}

// ---- resend.send_email

export interface SendIn {
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: { name: string; fileId: string }[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  idempotencyKey: string;
}

/** A display name that cannot break out of the address header. */
const cleanName = (name: string): string => name.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
/** Resend tags are letters, numbers, underscores and dashes, up to 256 characters. */
const cleanTag = (v: string): string => v.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

export async function sendEmail(ctx: ResendCtx, input: SendIn): Promise<{ providerId: string }> {
  if (!input.text && !input.html) bad(ctx, "An email needs a text or an html body.");
  const name = input.fromName ? cleanName(input.fromName) : "";
  const body: Json = { from: name ? `${name} <${input.from}>` : input.from, to: input.to, subject: input.subject };
  if (input.cc?.length) body.cc = input.cc;
  if (input.bcc?.length) body.bcc = input.bcc;
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.text) body.text = input.text;
  if (input.html) body.html = input.html;
  if (input.headers && Object.keys(input.headers).length) body.headers = input.headers;
  if (input.tags?.length) body.tags = input.tags.map((t) => ({ name: cleanTag(t.name), value: cleanTag(t.value) }));
  if (input.attachments?.length) {
    const host = needHost(ctx);
    const files: { filename: string; content: string }[] = [];
    for (const a of input.attachments) {
      const f = await host.fileBytes(ctx, a.fileId);
      files.push({ filename: a.name || f.name, content: Buffer.from(f.bytes).toString("base64") });
    }
    body.attachments = files;
  }
  const out = await api(ctx, { method: "POST", path: "/emails", body, headers: { "idempotency-key": input.idempotencyKey } }, { send: true });
  const id = strOrUndef(out.id);
  if (!id) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Resend did not return an email id." });
  return { providerId: id };
}

// ---- resend.get_email

export async function getEmail(ctx: ResendCtx, input: { providerId: string }): Promise<{ status: string; lastEvent?: EventType; at?: number }> {
  const j = await api(ctx, { path: `/emails/${encodeURIComponent(input.providerId)}` });
  const last = text(j.last_event);
  const event = last === "delivery_delayed" ? "delayed" : last;
  const out: { status: string; lastEvent?: EventType; at?: number } = { status: last || "unknown" };
  if (EVENT_TYPES.includes(event as EventType)) out.lastEvent = event as EventType;
  const at = Date.parse(text(j.created_at));
  if (Number.isFinite(at)) out.at = at;
  return out;
}

// ---- domains

const stateOf = (s: unknown): Dns => (s === "verified" ? "pass" : s === "failed" ? "fail" : "pending");
const statusOf = (s: unknown): DomainRow["status"] => (s === "verified" || s === "failed" || s === "not_started" ? s : "pending");

/** The worst state of a group of records: any failed fails, all verified passes, anything else is still pending. */
function groupState(records: DnsRecord[], purpose: DnsRecord["purpose"]): Dns {
  const mine = records.filter((r) => r.purpose === purpose);
  if (mine.length === 0) return "pending";
  if (mine.some((r) => r.state === "fail")) return "fail";
  return mine.every((r) => r.state === "pass") ? "pass" : "pending";
}

export function dnsRecords(j: Json): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const raw of list(j.records)) {
    const r = obj(raw);
    const kind = text(r.record);
    const type = text(r.type) === "MX" ? "MX" : text(r.type) === "CNAME" ? "CNAME" : "TXT";
    const name = text(r.name);
    const purpose: DnsRecord["purpose"] = kind === "SPF" ? "spf" : kind === "DKIM" ? "dkim" : kind === "Receiving" ? "mx" : name.startsWith("_dmarc") ? "dmarc" : "verify";
    const value = r.priority !== undefined && type === "MX" ? `${String(r.priority)} ${text(r.value)}` : text(r.value);
    out.push({ purpose, type, name, value, state: stateOf(r.status) });
  }
  return out;
}

export function domainRow(j: Json, records: DnsRecord[]): DomainRow {
  const status = statusOf(j.status);
  const overall: Dns = status === "verified" ? "pass" : status === "failed" ? "fail" : "pending";
  const row: DomainRow = {
    providerDomainId: text(j.id), name: text(j.name), status,
    spf: records.length ? groupState(records, "spf") : overall, dkim: records.length ? groupState(records, "dkim") : overall, dmarc: groupState(records, "dmarc"),
  };
  const region = strOrUndef(j.region);
  if (region) row.region = region;
  return row;
}

export async function domainsList(ctx: ResendCtx): Promise<{ domains: DomainRow[] }> {
  const j = await api(ctx, { path: "/domains" });
  return { domains: list(j.data).map((d) => domainRow(obj(d), [])) };
}

export async function domainsGet(ctx: ResendCtx, input: { providerDomainId: string }): Promise<{ domain: DomainRow; records: DnsRecord[] }> {
  const j = await api(ctx, { path: `/domains/${encodeURIComponent(input.providerDomainId)}` });
  const records = dnsRecords(j);
  return { domain: domainRow(j, records), records };
}

export async function domainsCreate(ctx: ResendCtx, input: { name: string; region?: string }): Promise<{ domain: DomainRow; records: DnsRecord[] }> {
  const name = input.name.trim().toLowerCase();
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) bad(ctx, "That is not a domain name, like mail.example.com.");
  const j = await api(ctx, { method: "POST", path: "/domains", body: { name, ...(input.region ? { region: input.region } : {}) } });
  const records = dnsRecords(j);
  return { domain: domainRow(j, records), records };
}

export async function domainsVerify(ctx: ResendCtx, input: { providerDomainId: string }): Promise<{ domain: DomainRow }> {
  const id = encodeURIComponent(input.providerDomainId);
  await api(ctx, { method: "POST", path: `/domains/${id}/verify` });
  const j = await api(ctx, { path: `/domains/${id}` });   // verification runs on Resend's side; the row after the ask shows what it found so far
  return { domain: domainRow(j, dnsRecords(j)) };
}

export async function domainsDelete(ctx: ResendCtx, input: { providerDomainId: string }): Promise<{ deleted: boolean }> {
  await api(ctx, { method: "DELETE", path: `/domains/${encodeURIComponent(input.providerDomainId)}` });
  return { deleted: true };
}

// ---- resend.health

export async function health(ctx: ResendCtx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const t0 = ctx.now();
  try {
    const a = await raw(ctx, { path: "/domains", query: { limit: "1" } });
    const latencyMs = Math.max(0, ctx.now() - t0);
    if (a.status < 300) return { state: "healthy", latencyMs };
    if (a.status === 401 || a.status === 403) return { state: "down", detail: "Resend did not accept the API key. Check Resend_Key in the Vault." };
    if (a.status === 429) return { state: "degraded", detail: "Resend is asking us to slow down.", latencyMs };
    return { state: "degraded", detail: "Resend is not answering well right now.", latencyMs };
  } catch (e) {
    if (e instanceof HostError && e.error.code === "internal.unavailable") return { state: "down", detail: "Resend is not set up on this server." };
    if (e instanceof HostError && e.error.code === "provider.network") return { state: "down", detail: "Resend could not be reached." };
    throw e;
  }
}

// ---- delivery events (/hooks/resend)

export interface WebhookIn {
  eventId: string;
  type: EventType;
  providerId: string;
  address?: string;
  bounceKind?: "hard" | "soft";
  reason?: string;
  url?: string;
  at: number;
}

const WEBHOOK_TYPES: Record<string, EventType> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.complained": "complained", "email.bounced": "bounced",
  "email.opened": "opened", "email.clicked": "clicked", "email.failed": "failed",
};

/**
 * A verified Resend webhook body to the input of resend.receive_webhook. `eventId` is the Svix message id from the headers: the payload has none.
 * Returns null for a type this module does not act on (inbound mail, contact events).
 */
export function parseWebhook(eventId: string, body: unknown, now: number): WebhookIn | null {
  const b = obj(body);
  const type = WEBHOOK_TYPES[text(b.type)];
  const data = obj(b.data);
  const providerId = text(data.email_id);
  if (!type || !providerId || !eventId) return null;
  const out: WebhookIn = { eventId, type, providerId, at: Number.isFinite(Date.parse(text(b.created_at))) ? Date.parse(text(b.created_at)) : now };
  const to = list(data.to).find((x): x is string => typeof x === "string");
  if (to) out.address = parseAddress(to).address;
  const bounce = obj(data.bounce);
  if (type === "bounced") {
    out.bounceKind = text(bounce.type).toLowerCase() === "permanent" ? "hard" : "soft";
    const reason = strOrUndef(bounce.message) ?? strOrUndef(bounce.subType);
    if (reason) out.reason = reason;
  }
  if (type === "failed") {
    const reason = strOrUndef(obj(data.failed).reason) ?? strOrUndef(data.reason);
    if (reason) out.reason = reason;
  }
  const link = strOrUndef(obj(data.click).link);
  if (type === "clicked" && link) out.url = link;
  return out;
}

const STATUS: Record<EventType, "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed" | null> = {
  sent: null, delayed: null, delivered: "delivered", bounced: "bounced", complained: "complained", opened: "opened", clicked: "clicked", failed: "failed",
};

export async function receiveWebhook(ctx: ResendCtx, input: WebhookIn): Promise<{ accepted: boolean }> {
  ensure(ctx);
  if (!input.eventId || !input.providerId) bad(ctx, "An event needs its id and the email id.");
  if (first(ctx.db.all(`SELECT "eventId" FROM resend_event_log WHERE "eventId" = ?`, input.eventId))) return { accepted: true };   // sent twice: applied once
  const status = STATUS[input.type];
  if (status) {
    const update: Json = { providerId: input.providerId, status, at: input.at };
    if (input.bounceKind && status === "bounced") update.kind = input.bounceKind;
    if (input.reason) update.reason = input.reason;
    if (input.address) update.address = input.address;
    if (input.url) update.url = input.url;
    await ctx.call("mail.status_update", update);
  }
  ctx.db.run(`INSERT OR IGNORE INTO resend_event_log ("eventId", "providerId", "type", "appliedAs", "at") VALUES (?, ?, ?, ?, ?)`, input.eventId, input.providerId, input.type, status, ctx.now());
  ctx.emit("resend.event_received", `entity/${input.eventId}`, { eventId: input.eventId, type: input.type, providerId: input.providerId });
  return { accepted: true };
}

// ---- inbound mail (/hooks/mail/resend)

interface Inbound {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  messageId: string;
  receivedAt: number;
  attachments: { name: string; mime: string; size: number; blobId: string }[];
  headers: Record<string, string>;
}

async function fetchInbound(ctx: ResendCtx, emailId: string): Promise<Inbound> {
  const id = encodeURIComponent(emailId);
  const j = await api(ctx, { path: `/emails/receiving/${id}` });
  const host = needHost(ctx);
  const attachments: Inbound["attachments"] = [];
  for (const raw of list(j.attachments)) {
    const a = obj(raw);
    let url = strOrUndef(a.download_url);
    if (!url && strOrUndef(a.id)) url = strOrUndef((await api(ctx, { path: `/emails/receiving/${id}/attachments/${encodeURIComponent(text(a.id))}` })).download_url);
    if (!url) continue;   // an attachment Resend will not hand over is left out, not guessed
    const mime = text(a.content_type) || "application/octet-stream";
    const blob = await host.download(ctx, { url, mime });
    attachments.push({ name: text(a.filename) || "attachment", mime: blob.mime || mime, size: blob.size, blobId: blob.blobId });
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(j.headers))) if (typeof v === "string") headers[k.toLowerCase()] = v;
  const created = Date.parse(text(j.created_at));
  const out: Inbound = {
    from: text(j.from), to: list(j.to).filter((x): x is string => typeof x === "string"), subject: text(j.subject),
    messageId: text(j.message_id) || `<${emailId}@inbound.resend.test>`, receivedAt: Number.isFinite(created) ? created : ctx.now(), attachments, headers,
  };
  const body = strOrUndef(j.text);
  const html = strOrUndef(j.html);
  if (body) out.text = body;
  if (html) out.html = html;
  return out;
}

export async function inboundGetEmail(ctx: ResendCtx, input: { emailId: string }): Promise<Omit<Inbound, "headers">> {
  const mail = await fetchInbound(ctx, input.emailId);
  const out: Omit<Inbound, "headers"> = { from: mail.from, to: mail.to, subject: mail.subject, messageId: mail.messageId, receivedAt: mail.receivedAt, attachments: mail.attachments };
  if (mail.text) out.text = mail.text;
  if (mail.html) out.html = mail.html;
  return out;
}

/** A verified Resend inbound webhook body to the input of resend.receive_inbound. Null for any other type. */
export function parseInbound(body: unknown): { emailId: string; route?: string } | null {
  const b = obj(body);
  const data = obj(b.data);
  const emailId = text(data.email_id);
  if (text(b.type) !== "email.received" || !emailId) return null;
  const to = list(data.to).find((x): x is string => typeof x === "string");
  return to ? { emailId, route: parseAddress(to).address } : { emailId };
}

export async function receiveInbound(ctx: ResendCtx, input: { emailId: string; route?: string }): Promise<{ accepted: boolean; messageId?: string }> {
  ensure(ctx);
  if (!input.emailId) bad(ctx, "An inbound email needs its id.");
  const seen = first(ctx.db.all(`SELECT "messageId" FROM resend_inbound_log WHERE "emailId" = ?`, input.emailId));
  if (seen) {
    const id = typeof seen.messageId === "string" ? seen.messageId : undefined;
    return id ? { accepted: true, messageId: id } : { accepted: true };
  }
  const mail = await fetchInbound(ctx, input.emailId);
  const from = parseAddress(mail.from);
  const to = mail.to.map(parseAddress);
  const route = input.route && /^[^\s@]+@[^\s@]+$/.test(input.route) ? input.route.toLowerCase() : to[0]?.address;
  const ingest: Json = {
    source: "resend", providerId: input.emailId, rfcMessageId: mail.messageId, direction: "in", from, to, subject: mail.subject, receivedAt: mail.receivedAt,
  };
  if (route) ingest.envelopeTo = route;
  if (mail.text) ingest.text = mail.text;
  if (mail.html) ingest.html = mail.html;
  if (mail.attachments.length) ingest.attachments = mail.attachments;
  if (Object.keys(mail.headers).length) ingest.headers = mail.headers;
  const landed = obj(await ctx.call("mail.ingest", ingest));
  const messageId = strOrUndef(landed.messageId);
  ctx.db.run(`INSERT OR IGNORE INTO resend_inbound_log ("emailId", "messageId", route, "at") VALUES (?, ?, ?, ?)`, input.emailId, messageId ?? null, route ?? null, ctx.now());
  const payload: { emailId: string; route?: string } = { emailId: input.emailId };
  if (route) payload.route = route;
  ctx.emit("resend.inbound_received", `entity/${input.emailId}`, payload);
  return messageId ? { accepted: true, messageId } : { accepted: true };
}
