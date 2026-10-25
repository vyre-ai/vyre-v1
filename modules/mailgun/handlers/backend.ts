// The Mailgun backend (spec 2.18 Sending, 2.19; ARCH 8, 8.2): the send.email backend behind mail.send, the Space's sending domains with the DNS records to
// publish, delivery events from /hooks/mailgun (applied with mail.status_update), inbound routes whose mail arrives at /hooks/mail/mailgun (landed with mail.ingest).
//
// Nothing here decides whether to send: mail.send applies the caps, windows, throttling, suppression and the Gate before it calls mailgun.send_email.
// Webhook signatures are verified by the host (the connector source says `verify: 'hmac'`); `parseWebhook` and `parseInbound` turn a verified body into
// the input of mailgun.receive_webhook and mailgun.receive_inbound for the host's webhook route.
// Inbound: the route Mailgun is given forwards to /hooks/mail/mailgun and also stores the message. The forward says who and which Message-Id; the body and
// attachments are read from the stored copy, found through the stored event of that Message-Id.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { API, api, bad, ensure, first, list, needHost, obj, parse, parseAddress, raw, refusal, regionOf, strOrUndef, text } from "../projections.ts";
import type { Json, MailgunCtx, Region } from "../projections.ts";

type Dns = "pass" | "fail" | "pending";
type EventType = "accepted" | "delivered" | "failed" | "opened" | "clicked" | "complained" | "unsubscribed";
const EVENT_TYPES: readonly EventType[] = ["accepted", "delivered", "failed", "opened", "clicked", "complained", "unsubscribed"];

export interface DomainRow {
  name: string;
  state: "unverified" | "active" | "disabled";
  spf: Dns;
  dkim: Dns;
  dmarc: Dns;
  region: Region;
}
export interface DnsRecord {
  purpose: "spf" | "dkim" | "dmarc" | "mx" | "verify";
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  state: Dns;
}
export interface RouteRow {
  routeId: string;
  expression: string;
  forwardTo: string[];
  priority: number;
  description?: string;
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const pathPart = (v: string): string => encodeURIComponent(v);
/** A Message-Id as Mailgun's events carry it: no angle brackets. */
export const bareId = (v: string): string => v.trim().replace(/^<|>$/g, "");

function domainName(ctx: MailgunCtx, v: unknown): string {
  const name = typeof v === "string" ? v.trim().toLowerCase() : "";
  return HOSTNAME.test(name) ? name : bad(ctx, "That is not a domain name, like mail.example.com.");
}

// ---- mailgun.send_email

export interface SendIn {
  domain: string;
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
  tags?: string[];
  idempotencyKey: string;
}

const cleanName = (name: string): string => name.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
/** A header name Mailgun can pass on: letters, digits and dashes. */
const cleanHeader = (name: string): string => name.replace(/[^A-Za-z0-9-]/g, "-");
const MAX_TAGS = 3;

export async function sendEmail(ctx: MailgunCtx, input: SendIn): Promise<{ providerId: string }> {
  const domain = domainName(ctx, input.domain);
  if (!input.text && !input.html) bad(ctx, "An email needs a text or an html body.");
  const name = input.fromName ? cleanName(input.fromName) : "";
  const fields: [string, string][] = [["from", name ? `${name} <${input.from}>` : input.from], ["subject", input.subject]];
  for (const a of input.to) fields.push(["to", a]);
  for (const a of input.cc ?? []) fields.push(["cc", a]);
  for (const a of input.bcc ?? []) fields.push(["bcc", a]);
  if (input.replyTo) fields.push(["h:Reply-To", input.replyTo]);
  if (input.text) fields.push(["text", input.text]);
  if (input.html) fields.push(["html", input.html]);
  for (const [k, v] of Object.entries(input.headers ?? {})) fields.push([`h:${cleanHeader(k)}`, v]);
  for (const tag of (input.tags ?? []).slice(0, MAX_TAGS)) fields.push(["o:tag", tag.slice(0, 128)]);

  const path = `/v3/${pathPart(domain)}/messages`;
  let json: Json;
  if (input.attachments?.length) {
    const host = needHost(ctx);
    const base = API[await regionOf(ctx)];
    const files = input.attachments.map((a) => ({ field: "attachment", name: a.name, fileId: a.fileId }));
    const sent = await host.upload(ctx, { url: `${base}${path}`, fields, files });
    const a = parse(ctx, sent.status, sent.text);
    if (a.status >= 300) throw refusal(ctx, a.status, true);
    json = a.json;
  } else {
    json = await api(ctx, { method: "POST", path, form: fields }, { send: true });
  }
  const id = strOrUndef(json.id);
  if (!id) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Mailgun did not return a message id." });
  return { providerId: bareId(id) };
}

// ---- mailgun.events.list

export async function eventsList(
  ctx: MailgunCtx, input: { domain: string; providerId?: string; event?: EventType; since?: number; pageToken?: string },
): Promise<{ events: { eventId: string; event: EventType; providerId?: string; address?: string; at: number }[]; nextPageToken?: string }> {
  const domain = domainName(ctx, input.domain);
  let a: Awaited<ReturnType<typeof raw>>;
  if (input.pageToken) {
    // a page token is the path Mailgun gave for the next page; it must stay inside this domain's events
    if (!input.pageToken.startsWith(`/v3/${pathPart(domain)}/events/`)) bad(ctx, "That page token is not from this domain's events.");
    a = await raw(ctx, { path: input.pageToken });
  } else {
    const query: Record<string, string> = { limit: "100", ascending: "yes" };
    if (input.providerId) query["message-id"] = bareId(input.providerId);
    if (input.event) query.event = input.event;
    if (input.since !== undefined) query.begin = String(input.since / 1000);
    a = await raw(ctx, { path: `/v3/${pathPart(domain)}/events`, query });
  }
  if (a.status >= 300) throw refusal(ctx, a.status, false);
  const events: { eventId: string; event: EventType; providerId?: string; address?: string; at: number }[] = [];
  for (const entry of list(a.json.items)) {
    const item = obj(entry);
    const event = text(item.event) as EventType;
    if (!EVENT_TYPES.includes(event) || !strOrUndef(item.id)) continue;
    const row: { eventId: string; event: EventType; providerId?: string; address?: string; at: number } = { eventId: text(item.id), event, at: Math.round(Number(item.timestamp) * 1000) || 0 };
    const mid = strOrUndef(obj(obj(item.message).headers)["message-id"]);
    if (mid) row.providerId = bareId(mid);
    const to = strOrUndef(item.recipient);
    if (to) row.address = to.toLowerCase();
    events.push(row);
  }
  const out: { events: typeof events; nextPageToken?: string } = { events };
  const next = strOrUndef(obj(a.json.paging).next);
  if (next && events.length > 0) {
    try {
      const u = new URL(next);
      out.nextPageToken = u.pathname + u.search;
    } catch { /* a page address that is not one ends the list */ }
  }
  return out;
}

// ---- domains

const stateOf = (v: unknown): Dns => (v === "valid" ? "pass" : v === "invalid" ? "fail" : "pending");
const domainState = (v: unknown): DomainRow["state"] => (v === "active" || v === "disabled" ? v : "unverified");

function groupState(records: DnsRecord[], purpose: DnsRecord["purpose"]): Dns {
  const mine = records.filter((r) => r.purpose === purpose);
  if (mine.length === 0) return "pending";
  if (mine.some((r) => r.state === "fail")) return "fail";
  return mine.every((r) => r.state === "pass") ? "pass" : "pending";
}

export function dnsRecords(j: Json, domain: string): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const entry of list(j.sending_dns_records)) {
    const r = obj(entry);
    const type = text(r.record_type).toUpperCase() === "CNAME" ? "CNAME" : "TXT";
    const name = text(r.name);
    const value = text(r.value);
    const purpose: DnsRecord["purpose"] = name.includes("_domainkey") ? "dkim" : /^v=spf1/i.test(value) ? "spf" : name.startsWith("_dmarc") ? "dmarc" : "verify";
    out.push({ purpose, type, name, value, state: stateOf(r.valid) });
  }
  for (const entry of list(j.receiving_dns_records)) {
    const r = obj(entry);
    const prio = r.priority === undefined ? "" : `${String(r.priority)} `;
    out.push({ purpose: "mx", type: "MX", name: domain, value: `${prio}${text(r.value)}`, state: stateOf(r.valid) });
  }
  return out;
}

export function domainRow(info: Json, records: DnsRecord[], region: Region): DomainRow {
  const state = domainState(info.state);
  const overall: Dns = state === "active" ? "pass" : "pending";
  return {
    name: text(info.name), state, spf: records.length ? groupState(records, "spf") : overall, dkim: records.length ? groupState(records, "dkim") : overall,
    dmarc: groupState(records, "dmarc"), region,
  };
}

function withRecords(j: Json, region: Region): { domain: DomainRow; records: DnsRecord[] } {
  const info = obj(j.domain);
  const records = dnsRecords(j, text(info.name));
  return { domain: domainRow(info, records, region), records };
}

export async function domainsList(ctx: MailgunCtx): Promise<{ domains: DomainRow[] }> {
  const region = await regionOf(ctx);
  const j = await api(ctx, { path: "/v4/domains", query: { limit: "1000" }, region });
  return { domains: list(j.items).map((d) => domainRow(obj(d), [], region)) };
}

export async function domainsGet(ctx: MailgunCtx, input: { name: string }): Promise<{ domain: DomainRow; records: DnsRecord[] }> {
  const region = await regionOf(ctx);
  return withRecords(await api(ctx, { path: `/v4/domains/${pathPart(domainName(ctx, input.name))}`, region }), region);
}

export async function domainsCreate(ctx: MailgunCtx, input: { name: string; region?: Region }): Promise<{ domain: DomainRow; records: DnsRecord[] }> {
  const name = domainName(ctx, input.name);
  if (input.region !== undefined && input.region !== "us" && input.region !== "eu") bad(ctx, "Region is us or eu.");
  const region = input.region ?? (await regionOf(ctx));
  return withRecords(await api(ctx, { method: "POST", path: "/v4/domains", form: [["name", name]], region }), region);
}

export async function domainsVerify(ctx: MailgunCtx, input: { name: string }): Promise<{ domain: DomainRow }> {
  const region = await regionOf(ctx);
  const j = await api(ctx, { method: "PUT", path: `/v4/domains/${pathPart(domainName(ctx, input.name))}/verify`, region });
  return { domain: withRecords(j, region).domain };
}

export async function domainsDelete(ctx: MailgunCtx, input: { name: string }): Promise<{ deleted: boolean }> {
  await api(ctx, { method: "DELETE", path: `/v3/domains/${pathPart(domainName(ctx, input.name))}`, region: await regionOf(ctx) });
  return { deleted: true };
}

// ---- routes

function routeRow(j: Json): RouteRow {
  const forwardTo: string[] = [];
  for (const action of list(j.actions)) {
    const m = /^\s*forward\(\s*"([^"]+)"\s*\)\s*$/.exec(text(action));
    if (m?.[1]) forwardTo.push(m[1]);
  }
  const row: RouteRow = { routeId: text(j.id), expression: text(j.expression), forwardTo, priority: Number.isInteger(j.priority) ? (j.priority as number) : 0 };
  const description = strOrUndef(j.description);
  if (description) row.description = description;
  return row;
}

export async function routesList(ctx: MailgunCtx): Promise<{ routes: RouteRow[] }> {
  const region = await regionOf(ctx);
  const routes: RouteRow[] = [];
  for (let skip = 0; skip < 10_000; ) {
    const j = await api(ctx, { path: "/v3/routes", query: { limit: "100", skip: String(skip) }, region });
    const items = list(j.items);
    for (const item of items) routes.push(routeRow(obj(item)));
    skip += items.length;
    if (items.length === 0 || skip >= Number(j.total_count ?? 0)) break;
  }
  return { routes };
}

export async function routesCreate(ctx: MailgunCtx, input: { expression: string; priority?: number; description?: string }): Promise<{ route: RouteRow }> {
  if (typeof input.expression !== "string" || input.expression.trim() === "" || input.expression.length > 1000) bad(ctx, "The route expression must be 1 to 1000 characters.");
  if (input.priority !== undefined && (!Number.isSafeInteger(input.priority) || input.priority < 0)) bad(ctx, "Priority is a whole number, 0 or more.");
  if (input.description !== undefined && (typeof input.description !== "string" || input.description.length > 200)) bad(ctx, "Description must be text up to 200 characters.");
  const base = (await needHost(ctx).publicUrl(ctx)).replace(/\/+$/, "");
  const forward = `${base}/hooks/mail/mailgun`;
  const form: [string, string][] = [
    ["priority", String(input.priority ?? 0)], ["expression", input.expression.trim()], ["action", `forward("${forward}")`], ["action", "store()"], ["action", "stop()"],
  ];
  if (input.description) form.push(["description", input.description]);
  const j = await api(ctx, { method: "POST", path: "/v3/routes", form, region: await regionOf(ctx) });
  return { route: routeRow(obj(j.route)) };
}

export async function routesDelete(ctx: MailgunCtx, input: { routeId: string }): Promise<{ deleted: boolean }> {
  if (typeof input.routeId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(input.routeId)) bad(ctx, "Route id is not valid.");
  await api(ctx, { method: "DELETE", path: `/v3/routes/${pathPart(input.routeId)}`, region: await regionOf(ctx) });
  return { deleted: true };
}

// ---- mailgun.health

export async function health(ctx: MailgunCtx, input: { domain?: string }): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const t0 = ctx.now();
  try {
    const name = input.domain === undefined ? undefined : domainName(ctx, input.domain);
    const a = await raw(ctx, name ? { path: `/v4/domains/${pathPart(name)}` } : { path: "/v4/domains", query: { limit: "1" } });
    const latencyMs = Math.max(0, ctx.now() - t0);
    if (a.status === 401 || a.status === 403) return { state: "down", detail: "Mailgun did not accept the API key. Check Mailgun_Key in the Vault and the region." };
    if (a.status === 404) return { state: "down", detail: "Mailgun has no such domain." };
    if (a.status === 429) return { state: "degraded", detail: "Mailgun is asking us to slow down.", latencyMs };
    if (a.status >= 300) return { state: "degraded", detail: "Mailgun is not answering well right now.", latencyMs };
    if (name) {
      const state = domainState(obj(a.json.domain).state);
      if (state === "disabled") return { state: "down", detail: "This domain is disabled at Mailgun.", latencyMs };
      if (state === "unverified") return { state: "degraded", detail: "This domain is not verified yet. Publish the DNS records in Console, Comms.", latencyMs };
    }
    return { state: "healthy", latencyMs };
  } catch (e) {
    if (e instanceof HostError && e.error.code === "internal.unavailable") return { state: "down", detail: "Mailgun is not set up on this server." };
    if (e instanceof HostError && e.error.code === "provider.network") return { state: "down", detail: "Mailgun could not be reached." };
    throw e;
  }
}

// ---- delivery events (/hooks/mailgun)

export interface WebhookIn {
  eventId: string;
  event: EventType;
  providerId: string;
  address?: string;
  severity?: "permanent" | "temporary";
  reason?: string;
  url?: string;
  at: number;
}

/** A verified Mailgun webhook body to the input of mailgun.receive_webhook. Null for an event this module does not act on (stored, rejected, list events). */
export function parseWebhook(body: unknown, now: number): WebhookIn | null {
  const data = obj(obj(body)["event-data"]);
  const event = text(data.event) as EventType;
  const eventId = text(data.id);
  const providerId = bareId(text(obj(obj(data.message).headers)["message-id"]));
  if (!EVENT_TYPES.includes(event) || !eventId || !providerId) return null;
  const ts = Number(data.timestamp);
  const out: WebhookIn = { eventId, event, providerId, at: Number.isFinite(ts) && ts > 0 ? Math.round(ts * 1000) : now };
  const to = strOrUndef(data.recipient);
  if (to) out.address = to.toLowerCase();
  if (data.severity === "permanent" || data.severity === "temporary") out.severity = data.severity;
  const status = obj(data["delivery-status"]);
  const reason = strOrUndef(status.message) ?? strOrUndef(status.description) ?? strOrUndef(data.reason);
  if (reason && (event === "failed" || event === "complained")) out.reason = reason;
  const url = strOrUndef(data.url);
  if (event === "clicked" && url) out.url = url;
  return out;
}

export async function receiveWebhook(ctx: MailgunCtx, input: WebhookIn): Promise<{ accepted: boolean }> {
  ensure(ctx);
  if (!input.eventId || !input.providerId) bad(ctx, "An event needs its id and the message id.");
  if (first(ctx.db.all(`SELECT "eventId" FROM mailgun_event_log WHERE "eventId" = ?`, input.eventId))) return { accepted: true };   // sent twice: applied once
  let applied: string | null = null;
  if (input.event === "unsubscribed") {
    if (input.address) {
      await ctx.call("contacts.apply_optout", { channel: "email", address: input.address, keyword: "unsubscribe", source: "email_unsubscribe", at: input.at });
      applied = "optout";
    }
  } else {
    const update = statusOf(input);
    if (update) {
      await ctx.call("mail.status_update", update);
      applied = String(update.status);
    }
  }
  ctx.db.run(`INSERT OR IGNORE INTO mailgun_event_log ("eventId", "providerId", event, "appliedAs", "at") VALUES (?, ?, ?, ?, ?)`, input.eventId, input.providerId, input.event, applied, ctx.now());
  ctx.emit("mailgun.event_received", `entity/${input.eventId}`, { eventId: input.eventId, event: input.event, providerId: input.providerId });
  return { accepted: true };
}

/** What mail.status_update is told for an event. A failed delivery is a bounce, permanent or soft by Mailgun's severity; accepted tells mail nothing new. */
function statusOf(e: WebhookIn): Json | null {
  const base: Json = { providerId: e.providerId, at: e.at };
  if (e.address) base.address = e.address;
  if (e.event === "accepted") return null;
  if (e.event === "failed") {
    const out: Json = { ...base, status: e.severity ? "bounced" : "failed" };
    if (e.severity) out.kind = e.severity === "permanent" ? "hard" : "soft";
    if (e.reason) out.reason = e.reason;
    return out;
  }
  const out: Json = { ...base, status: e.event };
  if (e.reason) out.reason = e.reason;
  if (e.url) out.url = e.url;
  return out;
}

// ---- inbound mail (/hooks/mail/mailgun)

/** The fields of a verified inbound route post to the input of mailgun.receive_inbound. Null when the post names no message or recipient. */
export function parseInbound(fields: Record<string, unknown>): { messageId: string; recipient: string; sender: string } | null {
  const pick = (...names: string[]): string => names.map((n) => text(fields[n])).find(Boolean) ?? "";
  const messageId = bareId(pick("Message-Id", "message-id", "Message-ID"));
  const recipient = parseAddress(pick("recipient")).address;
  const sender = parseAddress(pick("sender", "from", "From")).address;
  return messageId && recipient ? { messageId, recipient, sender } : null;
}

const splitAddresses = (v: string): string[] => v.split(/,(?![^<]*>)/).map((s) => s.trim()).filter(Boolean);

export async function receiveInbound(
  ctx: MailgunCtx, input: { messageId: string; recipient: string; sender: string },
): Promise<{ accepted: boolean; mailMessageId?: string }> {
  ensure(ctx);
  const messageId = bareId(typeof input.messageId === "string" ? input.messageId : "");
  const recipient = parseAddress(typeof input.recipient === "string" ? input.recipient : "").address;
  if (!messageId || !/^[^\s@]+@[^\s@]+$/.test(recipient)) bad(ctx, "An inbound email needs its Message-Id and the address it came in on.");
  const seen = first(ctx.db.all(`SELECT "mailMessageId" FROM mailgun_inbound_log WHERE "messageId" = ?`, messageId));
  if (seen) return typeof seen.mailMessageId === "string" ? { accepted: true, mailMessageId: seen.mailMessageId } : { accepted: true };

  const domain = domainName(ctx, recipient.split("@")[1]);
  const stored = await api(ctx, { path: `/v3/${pathPart(domain)}/events`, query: { event: "stored", "message-id": messageId, limit: "1" } });
  const item = obj(list(stored.items)[0]);
  const key = strOrUndef(obj(item.storage).key);
  if (!key) throw fail("validation.not_found", ctx.trace.traceId, { message: "Mailgun has not stored that message yet." });   // the webhook is retried
  const m = await api(ctx, { path: `/v3/domains/${pathPart(domain)}/messages/${pathPart(key)}` });

  const host = needHost(ctx);
  const attachments: { name: string; mime: string; size: number; blobId: string }[] = [];
  for (const entry of list(m.attachments)) {
    const a = obj(entry);
    const url = strOrUndef(a.url);
    if (!url) continue;   // an attachment Mailgun will not hand over is left out, not guessed
    const mime = text(a["content-type"]) || "application/octet-stream";
    const blob = await host.download(ctx, { url, mime, auth: true });
    attachments.push({ name: text(a.name) || "attachment", mime: blob.mime || mime, size: blob.size, blobId: blob.blobId });
  }
  const headers: Record<string, string> = {};
  for (const pair of list(m["message-headers"])) {
    const [k, v] = list(pair);
    if (typeof k === "string" && typeof v === "string") headers[k.toLowerCase()] = headers[k.toLowerCase()] ? `${headers[k.toLowerCase()]}, ${v}` : v;
  }
  const ts = Number(item.timestamp);
  const ingest: Json = {
    source: "mailgun", providerId: messageId, rfcMessageId: `<${messageId}>`, direction: "in", envelopeTo: recipient,
    from: parseAddress(text(m.From) || input.sender || ""), to: splitAddresses(text(m.To) || recipient).map(parseAddress), subject: text(m.Subject),
    receivedAt: Number.isFinite(ts) && ts > 0 ? Math.round(ts * 1000) : ctx.now(),
  };
  const plain = strOrUndef(m["body-plain"]);
  const html = strOrUndef(m["body-html"]);
  if (plain) ingest.text = plain;
  if (html) ingest.html = html;
  if (attachments.length) ingest.attachments = attachments;
  if (Object.keys(headers).length) ingest.headers = headers;
  const landed = obj(await ctx.call("mail.ingest", ingest));
  const mailMessageId = strOrUndef(landed.messageId);
  ctx.db.run(`INSERT OR IGNORE INTO mailgun_inbound_log ("messageId", "mailMessageId", recipient, "at") VALUES (?, ?, ?, ?)`, messageId, mailMessageId ?? null, recipient, ctx.now());
  ctx.emit("mailgun.inbound_received", `entity/${messageId}`, { messageId, recipient });
  return mailMessageId ? { accepted: true, mailMessageId } : { accepted: true };
}
