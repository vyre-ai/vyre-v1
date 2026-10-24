// google.gmail.* and the mailbox pull (spec 2.18, ARCH 8): the Gmail REST calls as the member, and the history pull that lands each new
// message through mail.ingest. Cursor polling runs 2 minutes while a mailbox is active, 15 when idle and an hour when dormant; a Pub/Sub
// watch makes the hour a backstop. A message is never lost: when mail.ingest cannot take it the cursor stays where it was.
import {
  api, apiRaw, bad, codeOf, enc, EMAIL, ensure, first, GMAIL, int, list, needHost, normalizeEmail, num, obj, refusal, strOrNull, text,
} from "../projections.ts";
import type { Call, GoogleCtx } from "../projections.ts";

export interface Act { connectionId: string; as?: string }

const SCOPE = "gmail.modify";
const call = (ctx: GoogleCtx, a: Act, cap: string, c: Omit<Call, "cap" | "connectionId" | "as" | "scope">): Promise<Record<string, unknown>> =>
  api(ctx, { cap, connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: SCOPE, ...c });

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: number;
  payload?: Record<string, unknown>;
}

export function mapMessage(m: Record<string, unknown>): GmailMessage {
  const out: GmailMessage = {
    id: text(m.id) ?? "",
    threadId: text(m.threadId) ?? "",
    labelIds: list(m.labelIds).filter((x): x is string => typeof x === "string"),
  };
  const snippet = text(m.snippet);
  const historyId = text(m.historyId);
  const internalDate = int(m.internalDate);
  if (snippet !== undefined) out.snippet = snippet;
  if (historyId !== undefined) out.historyId = historyId;
  if (internalDate !== undefined) out.internalDate = internalDate;
  if (m.payload && typeof m.payload === "object") out.payload = obj(m.payload);
  return out;
}

// ---- reads

export async function getProfile(ctx: GoogleCtx, a: Act) {
  const r = await call(ctx, a, "google.gmail.get_profile", { url: `${GMAIL}/profile` });
  const out: { emailAddress: string; historyId: string; messagesTotal?: number } = { emailAddress: text(r.emailAddress) ?? "", historyId: text(r.historyId) ?? "" };
  const total = int(r.messagesTotal);
  if (total !== undefined) out.messagesTotal = total;
  return out;
}

export async function listLabels(ctx: GoogleCtx, a: Act) {
  const r = await call(ctx, a, "google.gmail.list_labels", { url: `${GMAIL}/labels`, bulk: true });
  return {
    labels: list(r.labels).map((l) => {
      const o = obj(l);
      const out: { id: string; name: string; type?: string } = { id: text(o.id) ?? "", name: text(o.name) ?? "" };
      if (text(o.type) !== undefined) out.type = text(o.type)!;
      return out;
    }),
  };
}

export async function listMessages(ctx: GoogleCtx, a: Act & { q?: string; labelIds?: string[]; maxResults?: number; pageToken?: string }) {
  const r = await call(ctx, a, "google.gmail.list_messages", {
    url: `${GMAIL}/messages`, bulk: true,
    query: { q: a.q, labelIds: a.labelIds, maxResults: a.maxResults, pageToken: a.pageToken },
  });
  const out: { messages: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: number } = {
    messages: list(r.messages).map((m) => ({ id: text(obj(m).id) ?? "", threadId: text(obj(m).threadId) ?? "" })),
  };
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken)!;
  const est = int(r.resultSizeEstimate);
  if (est !== undefined) out.resultSizeEstimate = est;
  return out;
}

export async function getMessage(ctx: GoogleCtx, a: Act & { messageId: string; format?: "metadata" | "full" | "raw" }) {
  const r = await call(ctx, a, "google.gmail.get_message", { url: `${GMAIL}/messages/${enc(a.messageId)}`, query: { format: a.format ?? "full" } });
  return { message: mapMessage(r) };
}

export async function getThread(ctx: GoogleCtx, a: Act & { threadId: string }) {
  const r = await call(ctx, a, "google.gmail.get_thread", { url: `${GMAIL}/threads/${enc(a.threadId)}`, query: { format: "full" } });
  return { threadId: text(r.id) ?? a.threadId, messages: list(r.messages).map((m) => mapMessage(obj(m))) };
}

export async function listHistory(ctx: GoogleCtx, a: Act & { startHistoryId: string; pageToken?: string }) {
  const got = await apiRaw(ctx, {
    cap: "google.gmail.list_history", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: SCOPE, bulk: true, url: `${GMAIL}/history`,
    query: { startHistoryId: a.startHistoryId, pageToken: a.pageToken, maxResults: 500, historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"] },
  });
  if (got.status === 404) {
    // Gmail keeps history for about a week. Past that the cursor is useless: say so, with the current position to start over from.
    const now = await call(ctx, a, "google.gmail.get_profile", { url: `${GMAIL}/profile` });
    return { history: [] as HistoryOut[], historyId: text(now.historyId) ?? a.startHistoryId, expired: true as boolean };
  }
  if (got.status >= 300) throw refusal(ctx, got.status, got.json);
  const out: { history: HistoryOut[]; historyId: string; nextPageToken?: string; expired: boolean } = {
    history: list(got.json.history).map((h) => {
      const o = obj(h);
      const ids = (k: string): string[] => list(o[k]).map((x) => text(obj(obj(x).message).id)).filter((x): x is string => !!x);
      return { id: text(o.id) ?? "", added: ids("messagesAdded"), deleted: ids("messagesDeleted"), labelsChanged: [...new Set([...ids("labelsAdded"), ...ids("labelsRemoved")])] };
    }),
    historyId: text(got.json.historyId) ?? a.startHistoryId,
    expired: false,
  };
  if (text(got.json.nextPageToken)) out.nextPageToken = text(got.json.nextPageToken)!;
  return out;
}
interface HistoryOut { id: string; added: string[]; deleted: string[]; labelsChanged: string[] }

export async function getAttachment(ctx: GoogleCtx, a: Act & { messageId: string; attachmentId: string }) {
  const r = await call(ctx, a, "google.gmail.get_attachment", { url: `${GMAIL}/messages/${enc(a.messageId)}/attachments/${enc(a.attachmentId)}` });
  const bytes = Buffer.from(text(r.data) ?? "", "base64url");
  const blobId = await needHost(ctx).putBlob(ctx, bytes, "application/octet-stream");
  return { blobId, size: bytes.byteLength };
}

// ---- writes in the member's own mailbox

export async function modifyLabels(ctx: GoogleCtx, a: Act & { messageId: string; add?: string[]; remove?: string[] }) {
  const r = await call(ctx, a, "google.gmail.modify_labels", {
    method: "POST", url: `${GMAIL}/messages/${enc(a.messageId)}/modify`, body: { addLabelIds: a.add ?? [], removeLabelIds: a.remove ?? [] },
  });
  return { message: mapMessage(r) };
}

export async function trashMessage(ctx: GoogleCtx, a: Act & { messageId: string }) {
  await call(ctx, a, "google.gmail.trash_message", { method: "POST", url: `${GMAIL}/messages/${enc(a.messageId)}/trash` });
  return { trashed: true };
}

interface Compose { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text?: string; html?: string; threadId?: string }

export async function createDraft(ctx: GoogleCtx, a: Act & Compose) {
  const raw = await buildRaw(ctx, a, a.as ?? "me", []);
  const r = await call(ctx, a, "google.gmail.create_draft", {
    method: "POST", url: `${GMAIL}/drafts`, body: { message: { raw, ...(a.threadId ? { threadId: a.threadId } : {}) } },
  });
  return { draftId: text(r.id) ?? "" };
}

export async function sendMessage(ctx: GoogleCtx, a: Act & Compose & { attachments?: string[] }) {
  const files: { name: string; mime: string; bytes: Uint8Array }[] = [];
  for (const id of a.attachments ?? []) files.push(await needHost(ctx).fileBytes(ctx, id));
  const raw = await buildRaw(ctx, a, a.as ?? "me", files);
  const r = await call(ctx, a, "google.gmail.send_message", {
    method: "POST", url: `${GMAIL}/messages/send`, body: { raw, ...(a.threadId ? { threadId: a.threadId } : {}) },
  });
  return { id: text(r.id) ?? "", threadId: text(r.threadId) ?? "" };
}

export async function watch(ctx: GoogleCtx, a: Act & { topicName: string; labelIds?: string[] }) {
  const r = await call(ctx, a, "google.gmail.watch", {
    method: "POST", url: `${GMAIL}/watch`, body: { topicName: a.topicName, ...(a.labelIds ? { labelIds: a.labelIds } : {}) },
  });
  const expiration = int(r.expiration) ?? 0;
  const sub = (await mailboxOf(ctx, a)) ?? "";
  if (sub) {
    ensureMailbox(ctx, sub, a.connectionId);
    ctx.db.run(`UPDATE google_mailbox SET "watchExpiresAt" = ?, "pubsubTopic" = ? WHERE email = ?`, expiration, a.topicName, sub);
  }
  return { historyId: text(r.historyId) ?? "", expiration };
}

export async function stopWatch(ctx: GoogleCtx, a: Act) {
  await call(ctx, a, "google.gmail.stop_watch", { method: "POST", url: `${GMAIL}/stop` });
  const sub = await mailboxOf(ctx, a);
  if (sub) {
    ensureMailbox(ctx, sub, a.connectionId);
    ctx.db.run(`UPDATE google_mailbox SET "watchExpiresAt" = ?, "pubsubTopic" = ? WHERE email = ?`, null, null, sub);
  }
  return { stopped: true };
}

/** The member address a call acts as: the explicit one, else the caller's mapped address. */
async function mailboxOf(ctx: GoogleCtx, a: Act): Promise<string | null> {
  if (a.as) return normalizeEmail(a.as);
  const person = ctx.actingFor ?? ctx.principal.id;
  return strOrNull(first(ctx.db.all(`SELECT email FROM google_member WHERE "userId" = ? AND mapped = ?`, person, 1)), "email");
}

export function ensureMailbox(ctx: GoogleCtx, email: string, connectionId: string): void {
  if (first(ctx.db.all(`SELECT email FROM google_mailbox WHERE email = ?`, email))) return;
  ctx.db.run(
    `INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    email, connectionId, null, null, null, null, null, null,
  );
}

// ---- RFC 822

const CRLF = "\r\n";
const header = (s: string): string => s.replace(/[\r\n]+/g, " ").trim();
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64").replace(/.{1,76}/g, "$&" + CRLF).trimEnd();
const needsEncoding = (s: string): boolean => /[^\x20-\x7e]/.test(s);
const subjectHeader = (s: string): string => (needsEncoding(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s);

function checkAddresses(ctx: GoogleCtx, label: string, list_: string[] | undefined): string[] {
  const out = (list_ ?? []).map((x) => x.trim());
  for (const x of out) if (!EMAIL.test(x) || /[\s<>,;"]/.test(x)) bad(ctx, `${label} has an address that is not valid.`);
  return out;
}

/** The message as Gmail's `raw` field wants it: RFC 822, base64url. Plain, alternative or mixed depending on what is there. */
export async function buildRaw(ctx: GoogleCtx, a: Compose, from: string, files: { name: string; mime: string; bytes: Uint8Array }[]): Promise<string> {
  const to = checkAddresses(ctx, "To", a.to);
  if (to.length === 0) bad(ctx, "A message needs at least one recipient.");
  const cc = checkAddresses(ctx, "Cc", a.cc);
  const bcc = checkAddresses(ctx, "Bcc", a.bcc);
  if (a.text === undefined && a.html === undefined) bad(ctx, "A message needs text or html.");
  const lines: string[] = [];
  if (from !== "me") lines.push(`From: ${header(from)}`);
  lines.push(`To: ${to.join(", ")}`);
  if (cc.length) lines.push(`Cc: ${cc.join(", ")}`);
  if (bcc.length) lines.push(`Bcc: ${bcc.join(", ")}`);
  lines.push(`Subject: ${subjectHeader(header(a.subject))}`, "MIME-Version: 1.0");

  const text_ = a.text !== undefined ? part("text/plain", a.text) : null;
  const html_ = a.html !== undefined ? part("text/html", a.html) : null;
  const body = text_ && html_ ? multipart("alternative", [text_, html_]) : (text_ ?? html_)!;
  const whole = files.length
    ? multipart("mixed", [body, ...files.map((f) => ({
      headers: [`Content-Type: ${header(f.mime || "application/octet-stream")}; name="${header(f.name).replace(/"/g, "")}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${header(f.name).replace(/"/g, "")}"`],
      body: b64(f.bytes),
    }))])
    : body;
  const mime = [...lines, ...whole.headers, "", whole.body].join(CRLF);
  return Buffer.from(mime, "utf8").toString("base64url");
}

interface Part { headers: string[]; body: string }
const part = (type: string, content: string): Part => ({ headers: [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64"], body: b64(Buffer.from(content, "utf8")) });
function multipart(kind: "alternative" | "mixed", parts: Part[]): Part {
  const boundary = `=_vyre_${Math.abs(hash(parts.map((p) => p.body).join("|"))).toString(36)}`;
  const body = parts.map((p) => `--${boundary}${CRLF}${p.headers.join(CRLF)}${CRLF}${CRLF}${p.body}`).join(CRLF) + `${CRLF}--${boundary}--`;
  return { headers: [`Content-Type: multipart/${kind}; boundary="${boundary}"`], body };
}
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

// ---- the pull

const DAY = 86_400_000;
export const POLL_ACTIVE_MS = 2 * 60_000;
export const POLL_IDLE_MS = 15 * 60_000;
export const POLL_DORMANT_MS = 60 * 60_000;
const BOOT_PAGES = 2;
const BOOT_PAGE_SIZE = 100;
const ATTACHMENT_MAX = 10_000_000;

export interface Pull {
  ingested: number;
  deduped: number;
  skipped: number;
  historyId: string;
  bootstrapped: boolean;
  /** false when mail.ingest could not take a message, so the cursor stayed */
  complete: boolean;
  nextPollMs: number;
}

export function pollInterval(now: number, lastActivityAt: number | null, watching: boolean): number {
  if (watching) return POLL_DORMANT_MS;   // push is on: polling is only the backstop
  if (lastActivityAt === null) return POLL_IDLE_MS;
  const age = now - lastActivityAt;
  if (age < DAY / 24) return POLL_ACTIVE_MS;
  if (age < DAY) return POLL_IDLE_MS;
  return POLL_DORMANT_MS;
}

/** Pull the new mail of one member mailbox and land each message through mail.ingest. */
export async function pullMailbox(ctx: GoogleCtx, a: { connectionId: string; mailbox: string }): Promise<Pull> {
  ensure(ctx);
  const email = normalizeEmail(a.mailbox);
  const act: Act = { connectionId: a.connectionId, as: email };
  ensureMailbox(ctx, email, a.connectionId);
  const state = first(ctx.db.all(`SELECT * FROM google_mailbox WHERE email = ?`, email))!;
  const profile = await getProfile(ctx, act);
  let cursor = strOrNull(state, "historyId");
  let bootstrapped = false;
  let ids: string[] = [];

  if (cursor) {
    const start = cursor;   // every page of one listing is asked from the same position
    const seen = new Set<string>();
    let token: string | undefined;
    let expired = false;
    for (;;) {
      const page = await listHistory(ctx, { ...act, startHistoryId: start, ...(token ? { pageToken: token } : {}) });
      if (page.expired) { expired = true; break; }
      for (const h of page.history) for (const id of h.added) if (!seen.has(id)) { seen.add(id); ids.push(id); }
      cursor = page.historyId;
      if (!page.nextPageToken) break;
      token = page.nextPageToken;
    }
    if (expired) { bootstrapped = true; ids = await recent(ctx, act); cursor = profile.historyId; }
  } else {
    bootstrapped = true;
    ids = await recent(ctx, act);
    cursor = profile.historyId;
  }

  let ingested = 0, deduped = 0, skipped = 0, complete = true;
  for (const id of ids) {
    const got = await apiRaw(ctx, { cap: "google.gmail.get_message", connectionId: a.connectionId, as: email, scope: SCOPE, bulk: true, url: `${GMAIL}/messages/${enc(id)}`, query: { format: "full" } });
    if (got.status === 404) { skipped += 1; continue; }   // deleted between the history entry and now
    if (got.status >= 300) throw refusal(ctx, got.status, got.json);
    const input = await toIngest(ctx, act, email, mapMessage(got.json));
    if (!input) { skipped += 1; continue; }
    try {
      const out = obj(await ctx.call("mail.ingest", input));
      if (out.deduped === true) deduped += 1; else ingested += 1;
    } catch (e) {
      // No mailbox for this member yet, or the module is down: keep the cursor so nothing is lost, and try again next round.
      ctx.log.warn("google pull stopped", { mailbox: email, code: codeOf(e) });
      complete = false;
      break;
    }
  }

  const now = ctx.now();
  const before = state.lastActivityAt;
  const lastActivity = ingested > 0 ? now : typeof before === "number" ? before : null;
  if (complete) {
    ctx.db.run(`UPDATE google_mailbox SET "historyId" = ?, "lastPolledAt" = ?, "lastActivityAt" = ? WHERE email = ?`, cursor, now, lastActivity, email);
  } else {
    ctx.db.run(`UPDATE google_mailbox SET "lastPolledAt" = ? WHERE email = ?`, now, email);
  }
  const watching = num(state, "watchExpiresAt") > now;
  return { ingested, deduped, skipped, historyId: cursor ?? profile.historyId, bootstrapped, complete, nextPollMs: pollInterval(now, lastActivity, watching) };
}

/** The newest mail of the last 90 days, oldest first, for a mailbox with no cursor. */
async function recent(ctx: GoogleCtx, act: Act): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  for (let page = 0; page < BOOT_PAGES; page++) {
    const r = await listMessages(ctx, { ...act, q: "newer_than:90d -in:spam -in:trash", maxResults: BOOT_PAGE_SIZE, ...(token ? { pageToken: token } : {}) });
    out.push(...r.messages.map((m) => m.id));
    if (!r.nextPageToken) break;
    token = r.nextPageToken;
  }
  return out.reverse();
}

// ---- Gmail message to mail.ingest input

interface Party { address: string; name?: string }

export function parseAddresses(value: string | undefined): Party[] {
  if (!value) return [];
  const parts: string[] = [];
  let cur = "", quoted = false, angle = 0;
  for (const c of value) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") angle += 1;
    else if (!quoted && c === ">") angle = Math.max(0, angle - 1);
    if (c === "," && !quoted && angle === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  const out: Party[] = [];
  for (const p of parts) {
    const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/.exec(p) ?? /^\s*()([^<>\s,;]+)\s*$/.exec(p);
    if (!m) continue;
    const address = normalizeEmail(m[2] ?? "");
    if (!EMAIL.test(address)) continue;
    const name = (m[1] ?? "").trim();
    out.push(name ? { address, name } : { address });
  }
  return out;
}

function decode(data: unknown): string | undefined {
  const s = text(data);
  return s === undefined ? undefined : Buffer.from(s, "base64url").toString("utf8");
}

interface Walked { text?: string; html?: string; files: { name: string; mime: string; size: number; attachmentId: string }[] }
function walk(p: Record<string, unknown>, out: Walked): void {
  const mime = (text(p.mimeType) ?? "").toLowerCase();
  const body = obj(p.body);
  const name = text(p.filename) ?? "";
  if (name && text(body.attachmentId)) out.files.push({ name, mime: mime || "application/octet-stream", size: int(body.size) ?? 0, attachmentId: text(body.attachmentId)! });
  else if (mime === "text/plain" && out.text === undefined) out.text = decode(body.data);
  else if (mime === "text/html" && out.html === undefined) out.html = decode(body.data);
  for (const child of list(p.parts)) walk(obj(child), out);
}

/** The ingest input for one Gmail message, or null for a draft, spam, trash or a message with no usable sender. */
export async function toIngest(ctx: GoogleCtx, act: Act, mailbox: string, m: GmailMessage): Promise<Record<string, unknown> | null> {
  if (m.labelIds.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH")) return null;
  const payload = m.payload ?? {};
  const headers = new Map<string, string>();
  for (const h of list(payload.headers)) {
    const o = obj(h);
    const k = text(o.name)?.toLowerCase();
    if (k && !headers.has(k)) headers.set(k, text(o.value) ?? "");
  }
  const from = parseAddresses(headers.get("from"))[0];
  if (!from) return null;
  const walked: Walked = { files: [] };
  walk(payload, walked);
  const attachments: { name: string; mime: string; size: number; blobId: string }[] = [];
  for (const f of walked.files) {
    if (f.size > ATTACHMENT_MAX) continue;
    try {
      const saved = await getAttachment(ctx, { ...act, messageId: m.id, attachmentId: f.attachmentId });
      attachments.push({ name: f.name, mime: f.mime, size: saved.size, blobId: saved.blobId });
    } catch (e) {
      ctx.log.warn("google attachment skipped", { messageId: m.id, code: codeOf(e) });
    }
  }
  const out: Record<string, unknown> = {
    source: "google", envelopeTo: mailbox, providerId: m.id,
    rfcMessageId: headers.get("message-id") ?? `<gmail-${m.id}@mail.gmail.com>`,
    threadKey: m.threadId, direction: m.labelIds.includes("SENT") ? "out" : "in",
    from, to: parseAddresses(headers.get("to")), cc: parseAddresses(headers.get("cc")),
    subject: headers.get("subject") ?? "", receivedAt: m.internalDate ?? ctx.now(),
  };
  if (walked.text !== undefined) out.text = walked.text;
  if (walked.html !== undefined) out.html = walked.html;
  if (attachments.length) out.attachments = attachments;
  const refs: Record<string, string> = {};
  for (const k of ["in-reply-to", "references"]) { const v = headers.get(k); if (v) refs[k] = v; }
  if (Object.keys(refs).length) out.headers = refs;
  return out;
}

