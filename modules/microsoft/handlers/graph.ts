// ms.mail.*, ms.calendar.*, ms.drive.*, ms.teams.recordings.* (except the subscribe calls) and the mailbox pull (spec 2.18, ARCH 8).
// Every call acts as one member through Graph /users/{id}; the application token comes from the host. The mailbox pull reads the Inbox and Sent Items
// by delta query, so a missed change notification costs nothing, and lands each message through mail.ingest. A message is never lost: when
// mail.ingest cannot take it, the folder's delta link stays where it was.
import {
  api, apiRaw, bad, bearer, codeOf, EMAIL, enc, ensure, first, GRAPH, int, list, needHost, normalizeEmail, num, obj, query, refusal, resolveSubject, skipTokenOf, strOrNull, text, userUrl,
} from "../projections.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { Call, MsCtx } from "../projections.ts";

export interface Act { connectionId: string; as?: string }

const call = (ctx: MsCtx, a: Act, cap: string, c: Omit<Call, "cap" | "connectionId" | "as">): Promise<Record<string, unknown>> =>
  api(ctx, { cap, connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), ...c });

/** The member a call acts as, resolved once so URLs can name it. The call itself writes the read log row. */
async function who(ctx: MsCtx, a: Act, _cap: string): Promise<string> {
  return resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
}

// ---- Mail

const MESSAGE_FIELDS = "id,conversationId,subject,bodyPreview,receivedDateTime,isRead,from,toRecipients,categories,parentFolderId";

export function mapMessage(m: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: text(m.id) ?? "" };
  for (const k of ["conversationId", "subject", "bodyPreview", "receivedDateTime", "parentFolderId"] as const) if (text(m[k]) !== undefined) out[k] = text(m[k]);
  if (typeof m.isRead === "boolean") out.isRead = m.isRead;
  if (m.from && typeof m.from === "object") out.from = obj(m.from);
  if (Array.isArray(m.toRecipients)) out.toRecipients = m.toRecipients.map((x) => obj(x));
  if (Array.isArray(m.categories)) out.categories = m.categories.filter((x): x is string => typeof x === "string");
  return out;
}

export async function mailFolders(ctx: MsCtx, a: Act) {
  const sub = await who(ctx, a, "ms.mail.list_folders");
  const r = await call(ctx, a, "ms.mail.list_folders", { url: userUrl(sub, "/mailFolders"), query: { $top: 250, $select: "id,displayName,unreadItemCount" }, bulk: true });
  return {
    folders: list(r.value).map((f) => {
      const o = obj(f);
      const out: Record<string, unknown> = { id: text(o.id) ?? "", displayName: text(o.displayName) ?? "" };
      if (int(o.unreadItemCount) !== undefined) out.unreadItemCount = int(o.unreadItemCount);
      return out;
    }),
  };
}

export async function mailMessages(ctx: MsCtx, a: Act & { folderId?: string; search?: string; top?: number; skipToken?: string }) {
  const sub = await who(ctx, a, "ms.mail.list_messages");
  const base = a.folderId ? userUrl(sub, `/mailFolders/${enc(a.folderId)}/messages`) : userUrl(sub, "/messages");
  const r = await call(ctx, a, "ms.mail.list_messages", {
    url: base, bulk: true,
    query: { $top: a.top ?? 50, $select: MESSAGE_FIELDS, ...(a.search ? { $search: `"${a.search.replace(/"/g, "")}"` } : { $orderby: "receivedDateTime desc" }), $skiptoken: a.skipToken },
  });
  const out: Record<string, unknown> = { messages: list(r.value).map((m) => mapMessage(obj(m))) };
  const next = skipTokenOf(r["@odata.nextLink"]);
  if (next) out.nextSkipToken = next;
  return out;
}

export async function mailGet(ctx: MsCtx, a: Act & { messageId: string }) {
  const sub = await who(ctx, a, "ms.mail.get_message");
  const r = await call(ctx, a, "ms.mail.get_message", { url: userUrl(sub, `/messages/${enc(a.messageId)}`), query: { $select: `${MESSAGE_FIELDS},body` } });
  const out: Record<string, unknown> = { message: mapMessage(r) };
  const content = text(obj(r.body).content);
  if (content !== undefined) out.body = content;
  return out;
}

const MAX_DELTA_PAGES = 20;
const TOKEN_PARAMS = ["$deltatoken", "token", "$skiptoken"] as const;
const tokenOf = (link: string): { param: string; value: string } | null => {
  try {
    const u = new URL(link);
    for (const p of TOKEN_PARAMS) { const v = u.searchParams.get(p); if (v) return { param: p, value: v }; }
  } catch { /* not an address */ }
  return null;
};

interface Delta {
  /** the delta endpoint for this member, built here */
  base: string;
  /** parameters sent on the first request only */
  first?: Record<string, string>;
  /** parameters that every request of the walk must carry */
  fixed?: Record<string, string>;
  /** a delta link handed back to us earlier */
  resume?: string;
}

/**
 * Follow a delta query to its delta link. Graph's own links are never handed to the caller or taken back from them: only the position token
 * crosses, and the link is rebuilt here from the member's own endpoint, so a caller cannot point the app token at someone else's mailbox.
 * Past the page cap the position is the next-page token, which continues the same walk.
 */
async function walkDelta(ctx: MsCtx, a: Act, cap: string, d: Delta): Promise<{ changed: Record<string, unknown>[]; removed: string[]; deltaLink: string }> {
  const mine = (t: { param: string; value: string }): string => d.base + query({ ...d.fixed, [t.param]: t.value });
  let url: string;
  let q: Record<string, string> | undefined;
  if (d.resume !== undefined) {
    let host = "";
    try { host = new URL(d.resume).hostname; } catch { /* checked below */ }
    const t = tokenOf(d.resume);
    if (host !== "graph.microsoft.com" || !t) bad(ctx, "The delta link is not one this connector gave out.");
    url = mine(t);
  } else {
    url = d.base;
    q = { ...d.fixed, ...d.first };
  }
  const changed: Record<string, unknown>[] = [];
  const removed: string[] = [];
  for (let page = 0; page < MAX_DELTA_PAGES; page++) {
    const r = await call(ctx, a, cap, { url, ...(q ? { query: q } : {}), bulk: true });
    for (const v of list(r.value)) {
      const o = obj(v);
      if (o["@removed"]) removed.push(text(o.id) ?? "");
      else changed.push(o);
    }
    const delta = text(r["@odata.deltaLink"]);
    const dt = delta ? tokenOf(delta) : null;
    if (dt) return { changed, removed, deltaLink: mine(dt) };
    const next = text(r["@odata.nextLink"]);
    if (!next) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft ended a delta walk without a delta link." });
    if (!next.startsWith(`${GRAPH}/`)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft pointed the delta walk somewhere else." });
    url = next;
    q = undefined;
  }
  const t = tokenOf(url);
  if (!t) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft's next page has no position." });
  return { changed, removed, deltaLink: mine(t) };
}

export async function mailDelta(ctx: MsCtx, a: Act & { folderId: string; deltaLink?: string }) {
  const sub = await who(ctx, a, "ms.mail.delta");
  const r = await walkDelta(ctx, a, "ms.mail.delta", {
    base: userUrl(sub, `/mailFolders/${enc(a.folderId)}/messages/delta`), first: { $select: MESSAGE_FIELDS }, ...(a.deltaLink ? { resume: a.deltaLink } : {}),
  });
  return { changed: r.changed.map(mapMessage), removed: r.removed, deltaLink: r.deltaLink };
}

export async function mailAttachment(ctx: MsCtx, a: Act & { messageId: string; attachmentId: string }) {
  const sub = await who(ctx, a, "ms.mail.get_attachment");
  const r = await call(ctx, a, "ms.mail.get_attachment", { url: userUrl(sub, `/messages/${enc(a.messageId)}/attachments/${enc(a.attachmentId)}`) });
  const bytes = Buffer.from(text(r.contentBytes) ?? "", "base64");
  const blobId = await needHost(ctx).putBlob(ctx, bytes, text(r.contentType) ?? "application/octet-stream");
  return { blobId, size: bytes.byteLength };
}

export async function mailUpdate(ctx: MsCtx, a: Act & { messageId: string; isRead?: boolean; categories?: string[] }) {
  const sub = await who(ctx, a, "ms.mail.update_message");
  const body: Record<string, unknown> = {};
  if (a.isRead !== undefined) body.isRead = a.isRead;
  if (a.categories !== undefined) body.categories = a.categories;
  const r = await call(ctx, a, "ms.mail.update_message", { method: "PATCH", url: userUrl(sub, `/messages/${enc(a.messageId)}`), body });
  return { message: mapMessage(r) };
}

export async function mailMove(ctx: MsCtx, a: Act & { messageId: string; folderId: string }) {
  const sub = await who(ctx, a, "ms.mail.move_message");
  const r = await call(ctx, a, "ms.mail.move_message", { method: "POST", url: userUrl(sub, `/messages/${enc(a.messageId)}/move`), body: { destinationId: a.folderId } });
  return { message: mapMessage(r) };
}

export async function mailDelete(ctx: MsCtx, a: Act & { messageId: string }) {
  const sub = await who(ctx, a, "ms.mail.delete_message");
  await call(ctx, a, "ms.mail.delete_message", { method: "POST", url: userUrl(sub, `/messages/${enc(a.messageId)}/move`), body: { destinationId: "deleteditems" } });
  return { deleted: true };
}

interface Compose { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text?: string; html?: string }

function recipients(ctx: MsCtx, label: string, list_: string[] | undefined): { emailAddress: { address: string } }[] {
  return (list_ ?? []).map((x) => {
    const address = x.trim();
    if (!EMAIL.test(address) || /[\s<>,;"]/.test(address)) bad(ctx, `${label} has an address that is not valid.`);
    return { emailAddress: { address } };
  });
}

function messageBody(ctx: MsCtx, a: Compose): Record<string, unknown> {
  const to = recipients(ctx, "To", a.to);
  if (to.length === 0) bad(ctx, "A message needs at least one recipient.");
  if (a.text === undefined && a.html === undefined) bad(ctx, "A message needs text or html.");
  const cc = recipients(ctx, "Cc", a.cc);
  const bcc = recipients(ctx, "Bcc", a.bcc);
  return {
    subject: a.subject.replace(/[\r\n]+/g, " ").trim(),
    body: a.html !== undefined ? { contentType: "HTML", content: a.html } : { contentType: "Text", content: a.text ?? "" },
    toRecipients: to, ...(cc.length ? { ccRecipients: cc } : {}), ...(bcc.length ? { bccRecipients: bcc } : {}),
  };
}

export async function mailDraft(ctx: MsCtx, a: Act & Compose) {
  const sub = await who(ctx, a, "ms.mail.create_draft");
  const r = await call(ctx, a, "ms.mail.create_draft", { method: "POST", url: userUrl(sub, "/messages"), body: messageBody(ctx, a) });
  return { draftId: text(r.id) ?? "" };
}

/** conversationId is accepted for the contract; sendMail cannot join a conversation, so the reply threads by its subject and headers. */
export async function mailSend(ctx: MsCtx, a: Act & Compose & { conversationId?: string; attachments?: string[] }) {
  const sub = await who(ctx, a, "ms.mail.send_message");
  const message = messageBody(ctx, a);
  const files: Record<string, unknown>[] = [];
  for (const id of a.attachments ?? []) {
    const f = await needHost(ctx).fileBytes(ctx, id);
    files.push({ "@odata.type": "#microsoft.graph.fileAttachment", name: f.name, contentType: f.mime || "application/octet-stream", contentBytes: Buffer.from(f.bytes).toString("base64") });
  }
  if (files.length) message.attachments = files;
  await call(ctx, a, "ms.mail.send_message", { method: "POST", url: userUrl(sub, "/sendMail"), body: { message, saveToSentItems: true } });
  return { sent: true };
}

// ---- Calendar

export function mapEvent(e: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: text(e.id) ?? "", start: obj(e.start), end: obj(e.end) };
  if (text(e.subject) !== undefined) out.subject = text(e.subject);
  if (e.location && typeof e.location === "object") out.location = obj(e.location);
  if (e.onlineMeeting && typeof e.onlineMeeting === "object") out.onlineMeeting = obj(e.onlineMeeting);
  if (e.organizer && typeof e.organizer === "object") out.organizer = obj(e.organizer);
  if (typeof e.isCancelled === "boolean") out.isCancelled = e.isCancelled;
  if (Array.isArray(e.attendees)) {
    out.attendees = e.attendees.map((x) => {
      const o = obj(x);
      const att: Record<string, unknown> = { email: text(obj(o.emailAddress).address) ?? "" };
      if (text(obj(o.status).response) !== undefined) att.response = text(obj(o.status).response);
      if (text(o.type) !== undefined) att.type = text(o.type);
      return att;
    });
  }
  return out;
}

const calBase = (sub: string, calendarId?: string): string => (calendarId ? userUrl(sub, `/calendars/${enc(calendarId)}`) : userUrl(sub, "/calendar"));

export async function calendars(ctx: MsCtx, a: Act) {
  const sub = await who(ctx, a, "ms.calendar.list_calendars");
  const r = await call(ctx, a, "ms.calendar.list_calendars", { url: userUrl(sub, "/calendars"), bulk: true });
  return {
    calendars: list(r.value).map((x) => {
      const o = obj(x);
      const c: Record<string, unknown> = { id: text(o.id) ?? "", name: text(o.name) ?? "" };
      if (text(o.color) !== undefined) c.color = text(o.color);
      if (typeof o.isDefaultCalendar === "boolean") c.isDefault = o.isDefaultCalendar;
      if (typeof o.canEdit === "boolean") c.canEdit = o.canEdit;
      return c;
    }),
  };
}

export async function events(ctx: MsCtx, a: Act & { calendarId?: string; start: string; end: string; skipToken?: string }) {
  const sub = await who(ctx, a, "ms.calendar.list_events");
  const r = await call(ctx, a, "ms.calendar.list_events", {
    url: `${calBase(sub, a.calendarId)}/calendarView`, bulk: true, query: { startDateTime: a.start, endDateTime: a.end, $top: 100, $skiptoken: a.skipToken },
  });
  const out: Record<string, unknown> = { events: list(r.value).map((e) => mapEvent(obj(e))) };
  const next = skipTokenOf(r["@odata.nextLink"]);
  if (next) out.nextSkipToken = next;
  return out;
}

export async function eventGet(ctx: MsCtx, a: Act & { eventId: string }) {
  const sub = await who(ctx, a, "ms.calendar.get_event");
  return { event: mapEvent(await call(ctx, a, "ms.calendar.get_event", { url: userUrl(sub, `/events/${enc(a.eventId)}`) })) };
}

export async function calendarDelta(ctx: MsCtx, a: Act & { calendarId?: string; start: string; end: string; deltaLink?: string }) {
  const sub = await who(ctx, a, "ms.calendar.delta");
  const r = await walkDelta(ctx, a, "ms.calendar.delta", {
    base: `${calBase(sub, a.calendarId)}/calendarView/delta`, fixed: { startDateTime: a.start, endDateTime: a.end }, ...(a.deltaLink ? { resume: a.deltaLink } : {}),
  });
  return { changed: r.changed.map(mapEvent), removed: r.removed, deltaLink: r.deltaLink };
}

interface EventWrite { calendarId?: string; subject?: string; body?: string; location?: string; start?: Record<string, unknown>; end?: Record<string, unknown>; attendees?: { email: string; optional?: boolean }[]; teamsMeeting?: boolean }
function eventBody(ctx: MsCtx, a: EventWrite): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (a.subject !== undefined) body.subject = a.subject;
  if (a.body !== undefined) body.body = { contentType: "HTML", content: a.body };
  if (a.location !== undefined) body.location = { displayName: a.location };
  if (a.start !== undefined) body.start = a.start;
  if (a.end !== undefined) body.end = a.end;
  if (a.attendees) {
    for (const x of a.attendees) if (!EMAIL.test(x.email)) bad(ctx, "An attendee address is not an email.");
    body.attendees = a.attendees.map((x) => ({ emailAddress: { address: normalizeEmail(x.email) }, type: x.optional ? "optional" : "required" }));
  }
  if (a.teamsMeeting) { body.isOnlineMeeting = true; body.onlineMeetingProvider = "teamsForBusiness"; }
  return body;
}

export async function eventCreate(ctx: MsCtx, a: Act & EventWrite) {
  const sub = await who(ctx, a, "ms.calendar.create_event");
  const url = a.calendarId ? `${calBase(sub, a.calendarId)}/events` : userUrl(sub, "/events");
  return { event: mapEvent(await call(ctx, a, "ms.calendar.create_event", { method: "POST", url, body: eventBody(ctx, a) })) };
}

export async function eventUpdate(ctx: MsCtx, a: Act & EventWrite & { eventId: string }) {
  const sub = await who(ctx, a, "ms.calendar.update_event");
  return { event: mapEvent(await call(ctx, a, "ms.calendar.update_event", { method: "PATCH", url: userUrl(sub, `/events/${enc(a.eventId)}`), body: eventBody(ctx, a) })) };
}

export async function eventDelete(ctx: MsCtx, a: Act & { eventId: string }) {
  const sub = await who(ctx, a, "ms.calendar.delete_event");
  await call(ctx, a, "ms.calendar.delete_event", { method: "DELETE", url: userUrl(sub, `/events/${enc(a.eventId)}`) });
  return { deleted: true };
}

export async function eventRespond(ctx: MsCtx, a: Act & { eventId: string; response: "accept" | "decline" | "tentativelyAccept"; comment?: string }) {
  const sub = await who(ctx, a, "ms.calendar.respond");
  await call(ctx, a, "ms.calendar.respond", {
    method: "POST", url: userUrl(sub, `/events/${enc(a.eventId)}/${a.response}`), body: { sendResponse: true, ...(a.comment ? { comment: a.comment } : {}) },
  });
  return { sent: true };
}

const utc = (s: string): string => (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

export async function schedule(ctx: MsCtx, a: Act & { emails: string[]; start: string; end: string }) {
  for (const e of a.emails) if (!EMAIL.test(e)) bad(ctx, "An address is not an email.");
  const sub = await who(ctx, a, "ms.calendar.get_schedule");
  const r = await call(ctx, a, "ms.calendar.get_schedule", {
    method: "POST", url: userUrl(sub, "/calendar/getSchedule"),
    body: { schedules: a.emails.map(normalizeEmail), startTime: { dateTime: a.start, timeZone: "UTC" }, endTime: { dateTime: a.end, timeZone: "UTC" }, availabilityViewInterval: 30 },
  });
  const busy: { email: string; start: string; end: string }[] = [];
  for (const s of list(r.value)) {
    const o = obj(s);
    for (const item of list(o.scheduleItems)) {
      const it = obj(item);
      if (text(it.status) === "free") continue;
      busy.push({ email: normalizeEmail(text(o.scheduleId) ?? ""), start: utc(text(obj(it.start).dateTime) ?? ""), end: utc(text(obj(it.end).dateTime) ?? "") });
    }
  }
  return { busy };
}

export async function meetingTimes(ctx: MsCtx, a: Act & { emails: string[]; durationMinutes: number; start: string; end: string }) {
  for (const e of a.emails) if (!EMAIL.test(e)) bad(ctx, "An address is not an email.");
  if (!Number.isSafeInteger(a.durationMinutes) || a.durationMinutes < 5) bad(ctx, "The meeting must last at least five minutes.");
  const sub = await who(ctx, a, "ms.calendar.find_meeting_times");
  const r = await call(ctx, a, "ms.calendar.find_meeting_times", {
    method: "POST", url: userUrl(sub, "/findMeetingTimes"),
    body: {
      attendees: a.emails.map((e) => ({ type: "required", emailAddress: { address: normalizeEmail(e) } })),
      timeConstraint: { timeslots: [{ start: { dateTime: a.start, timeZone: "UTC" }, end: { dateTime: a.end, timeZone: "UTC" } }] },
      meetingDuration: `PT${a.durationMinutes}M`,
    },
  });
  return {
    slots: list(r.meetingTimeSuggestions).map((s) => {
      const o = obj(s);
      const slot = obj(o.meetingTimeSlot);
      const out: Record<string, unknown> = { start: utc(text(obj(slot.start).dateTime) ?? ""), end: utc(text(obj(slot.end).dateTime) ?? "") };
      if (typeof o.confidence === "number") out.confidence = o.confidence;
      return out;
    }),
  };
}

// ---- OneDrive and SharePoint

export function mapItem(f: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: text(f.id) ?? "", name: text(f.name) ?? "" };
  if (int(f.size) !== undefined) out.size = int(f.size);
  for (const k of ["lastModifiedDateTime", "webUrl"] as const) if (text(f[k]) !== undefined) out[k] = text(f[k]);
  if (f.folder !== undefined) out.folder = true;
  const parent = text(obj(f.parentReference).id);
  if (parent) out.parentId = parent;
  return out;
}

const driveBase = (sub: string, driveId?: string): string => (driveId ? `${GRAPH}/drives/${enc(driveId)}` : userUrl(sub, "/drive"));

export async function driveItems(ctx: MsCtx, a: Act & { driveId?: string; folderId?: string; skipToken?: string }) {
  const sub = await who(ctx, a, "ms.drive.list_items");
  const base = driveBase(sub, a.driveId);
  const r = await call(ctx, a, "ms.drive.list_items", { url: a.folderId ? `${base}/items/${enc(a.folderId)}/children` : `${base}/root/children`, bulk: true, query: { $top: 200, $skiptoken: a.skipToken } });
  const out: Record<string, unknown> = { items: list(r.value).map((x) => mapItem(obj(x))) };
  const next = skipTokenOf(r["@odata.nextLink"]);
  if (next) out.nextSkipToken = next;
  return out;
}

export async function driveItem(ctx: MsCtx, a: Act & { driveId?: string; itemId: string }) {
  const sub = await who(ctx, a, "ms.drive.get_item");
  return { item: mapItem(await call(ctx, a, "ms.drive.get_item", { url: `${driveBase(sub, a.driveId)}/items/${enc(a.itemId)}` })) };
}

export async function driveDownload(ctx: MsCtx, a: Act & { driveId?: string; itemId: string }) {
  const { sub, token } = await bearer(ctx, { cap: "ms.drive.download_item", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  const got = await needHost(ctx).download(ctx, { url: `${driveBase(sub, a.driveId)}/items/${enc(a.itemId)}/content`, token });
  return { blobId: got.blobId, size: got.size };
}

export async function driveDelta(ctx: MsCtx, a: Act & { driveId?: string; deltaLink?: string }) {
  const sub = await who(ctx, a, "ms.drive.delta");
  const r = await walkDelta(ctx, a, "ms.drive.delta", { base: `${driveBase(sub, a.driveId)}/root/delta`, ...(a.deltaLink ? { resume: a.deltaLink } : {}) });
  return { changed: r.changed.map(mapItem), removed: r.removed, deltaLink: r.deltaLink };
}

export async function driveUpload(ctx: MsCtx, a: Act & { driveId?: string; folderId?: string; name: string; fileId: string }) {
  if (!a.name || /[\\/:*?"<>|]/.test(a.name)) bad(ctx, "The file name has characters OneDrive does not allow.");
  const { sub, token } = await bearer(ctx, { cap: "ms.drive.upload_item", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  const base = driveBase(sub, a.driveId);
  const url = a.folderId ? `${base}/items/${enc(a.folderId)}:/${enc(a.name)}:/content` : `${base}/root:/${enc(a.name)}:/content`;
  return { item: mapItem(obj(await needHost(ctx).upload(ctx, { url, token, fileId: a.fileId }))) };
}

export async function driveFolder(ctx: MsCtx, a: Act & { driveId?: string; parentId?: string; name: string }) {
  if (!a.name || /[\\/:*?"<>|]/.test(a.name)) bad(ctx, "The folder name has characters OneDrive does not allow.");
  const sub = await who(ctx, a, "ms.drive.create_folder");
  const base = driveBase(sub, a.driveId);
  const r = await call(ctx, a, "ms.drive.create_folder", {
    method: "POST", url: a.parentId ? `${base}/items/${enc(a.parentId)}/children` : `${base}/root/children`,
    body: { name: a.name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" },
  });
  return { item: mapItem(r) };
}

export async function driveShare(ctx: MsCtx, a: Act & { driveId?: string; itemId: string; emails?: string[]; role: "read" | "write" }) {
  for (const e of a.emails ?? []) if (!EMAIL.test(e)) bad(ctx, "An address is not an email.");
  const sub = await who(ctx, a, "ms.drive.share_item");
  const url = `${driveBase(sub, a.driveId)}/items/${enc(a.itemId)}`;
  if (a.emails && a.emails.length > 0) {
    await call(ctx, a, "ms.drive.share_item", {
      method: "POST", url: `${url}/invite`,
      body: { recipients: a.emails.map((e) => ({ email: normalizeEmail(e) })), roles: [a.role], requireSignIn: true, sendInvitation: true },
    });
    return { shared: true };
  }
  const r = await call(ctx, a, "ms.drive.share_item", { method: "POST", url: `${url}/createLink`, body: { type: a.role === "read" ? "view" : "edit", scope: "organization" } });
  const out: { shared: boolean; link?: string } = { shared: true };
  const link = text(obj(r.link).webUrl);
  if (link) out.link = link;
  return out;
}

export async function driveDelete(ctx: MsCtx, a: Act & { driveId?: string; itemId: string }) {
  const sub = await who(ctx, a, "ms.drive.delete_item");
  await call(ctx, a, "ms.drive.delete_item", { method: "DELETE", url: `${driveBase(sub, a.driveId)}/items/${enc(a.itemId)}` });
  return { deleted: true };
}

// ---- Teams recordings and transcripts

const meeting = (sub: string, id: string): string => userUrl(sub, `/onlineMeetings/${enc(id)}`);

export async function recordings(ctx: MsCtx, a: Act & { onlineMeetingId: string }) {
  const sub = await who(ctx, a, "ms.teams.recordings.list_recordings");
  const r = await call(ctx, a, "ms.teams.recordings.list_recordings", { url: `${meeting(sub, a.onlineMeetingId)}/recordings` });
  return {
    recordings: list(r.value).map((x) => {
      const o = obj(x);
      const rec: Record<string, unknown> = { id: text(o.id) ?? "" };
      if (text(o.createdDateTime)) rec.createdAt = text(o.createdDateTime);
      if (text(o.recordingContentUrl)) rec.contentUrl = text(o.recordingContentUrl);
      return rec;
    }),
  };
}

export async function recordingGet(ctx: MsCtx, a: Act & { onlineMeetingId: string; recordingId: string }) {
  const { sub, token } = await bearer(ctx, { cap: "ms.teams.recordings.get_recording", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  const got = await needHost(ctx).download(ctx, { url: `${meeting(sub, a.onlineMeetingId)}/recordings/${enc(a.recordingId)}/content`, token });
  return { blobId: got.blobId, size: got.size };
}

export async function transcripts(ctx: MsCtx, a: Act & { onlineMeetingId: string }) {
  const sub = await who(ctx, a, "ms.teams.recordings.list_transcripts");
  const r = await call(ctx, a, "ms.teams.recordings.list_transcripts", { url: `${meeting(sub, a.onlineMeetingId)}/transcripts` });
  return {
    transcripts: list(r.value).map((x) => {
      const o = obj(x);
      const t: Record<string, unknown> = { id: text(o.id) ?? "" };
      if (text(o.createdDateTime)) t.createdAt = text(o.createdDateTime);
      return t;
    }),
  };
}

export async function transcriptGet(ctx: MsCtx, a: Act & { onlineMeetingId: string; transcriptId: string }) {
  const sub = await who(ctx, a, "ms.teams.recordings.get_transcript");
  const got = await apiRaw(ctx, {
    cap: "ms.teams.recordings.get_transcript", connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), text: true,
    url: `${meeting(sub, a.onlineMeetingId)}/transcripts/${enc(a.transcriptId)}/content`, query: { $format: "text/vtt" },
  });
  if (got.status >= 300) throw refusal(ctx, got.status, {});
  return { vtt: got.text };
}

// ---- the pull

const DAY = 86_400_000;
export const POLL_ACTIVE_MS = 2 * 60_000;
export const POLL_IDLE_MS = 15 * 60_000;
export const POLL_DORMANT_MS = 60 * 60_000;
const ATTACHMENT_MAX = 10_000_000;
const FOLDERS = ["inbox", "sentitems"] as const;
const FULL_FIELDS = "id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,isDraft,hasAttachments,internetMessageHeaders";

export interface Pull {
  ingested: number;
  deduped: number;
  skipped: number;
  bootstrapped: boolean;
  /** false when mail.ingest could not take a message, so that folder's delta link stayed */
  complete: boolean;
  nextPollMs: number;
}

export function pollInterval(now: number, lastActivityAt: number | null, subscribed: boolean): number {
  if (subscribed) return POLL_DORMANT_MS;   // change notifications are on: polling is only the backstop
  if (lastActivityAt === null) return POLL_IDLE_MS;
  const age = now - lastActivityAt;
  if (age < DAY / 24) return POLL_ACTIVE_MS;
  if (age < DAY) return POLL_IDLE_MS;
  return POLL_DORMANT_MS;
}

export function ensureMailbox(ctx: MsCtx, email: string, connectionId: string): void {
  if (first(ctx.db.all(`SELECT email FROM ms_mailbox WHERE email = ?`, email))) return;
  ctx.db.run(`INSERT INTO ms_mailbox (email, "connectionId", "deltaLinks", "lastPolledAt", "lastActivityAt", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?)`, email, connectionId, null, null, null, null);
}

function links(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(parsed))) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Pull the new mail of one member mailbox (Inbox and Sent Items) and land each message through mail.ingest. */
export async function pullMailbox(ctx: MsCtx, a: { connectionId: string; mailbox: string }): Promise<Pull> {
  ensure(ctx);
  const email = normalizeEmail(a.mailbox);
  const act: Act = { connectionId: a.connectionId, as: email };
  ensureMailbox(ctx, email, a.connectionId);
  const state = first(ctx.db.all(`SELECT * FROM ms_mailbox WHERE email = ?`, email))!;
  const deltaLinks = links(strOrNull(state, "deltaLinks"));
  const now = ctx.now();
  let ingested = 0, deduped = 0, skipped = 0, complete = true, bootstrapped = false;

  for (const folder of FOLDERS) {
    const start = deltaLinks[folder];
    let walked: { changed: Record<string, unknown>[]; removed: string[]; deltaLink: string };
    if (start) {
      try {
        walked = await walkDelta(ctx, act, "ms.mail.delta", { base: userUrl(email, `/mailFolders/${folder}/messages/delta`), resume: start });
      } catch (e) {
        if (codeOf(e) !== "validation.precondition_failed") throw e;
        delete deltaLinks[folder];   // the delta token expired: start this folder over
        walked = await firstWalk(ctx, act, email, folder, now);
        bootstrapped = true;
      }
    } else {
      walked = await firstWalk(ctx, act, email, folder, now);
      bootstrapped = true;
    }
    let folderComplete = true;
    const seen = new Set<string>();
    for (const stub of walked.changed) {
      if (stub.isDraft === true) { skipped += 1; continue; }
      const id = text(stub.id);
      if (!id || seen.has(id)) continue;   // a message that changed twice in one walk appears twice
      seen.add(id);
      const got = await apiRaw(ctx, {
        cap: "ms.mail.get_message", connectionId: a.connectionId, as: email, bulk: true, url: userUrl(email, `/messages/${enc(id)}`), query: { $select: FULL_FIELDS },
      });
      if (got.status === 404) { skipped += 1; continue; }   // deleted between the delta entry and now
      if (got.status >= 300) throw refusal(ctx, got.status, got.json);
      const input = await toIngest(ctx, act, email, folder, got.json);
      if (!input) { skipped += 1; continue; }
      try {
        const out = obj(await ctx.call("mail.ingest", input));
        if (out.deduped === true) deduped += 1; else ingested += 1;
      } catch (e) {
        // No mailbox for this member yet, or the module is down: keep this folder's delta link so nothing is lost, and try again next round.
        ctx.log.warn("microsoft pull stopped", { mailbox: email, code: codeOf(e) });
        folderComplete = false;
        break;
      }
    }
    if (folderComplete) deltaLinks[folder] = walked.deltaLink;
    else { complete = false; if (!start) delete deltaLinks[folder]; }
  }

  const before = state.lastActivityAt;
  const lastActivity = ingested > 0 ? now : typeof before === "number" ? before : null;
  ctx.db.run(`UPDATE ms_mailbox SET "deltaLinks" = ?, "lastPolledAt" = ?, "lastActivityAt" = ? WHERE email = ?`, JSON.stringify(deltaLinks), now, lastActivity, email);
  const subscribed = num(first(ctx.db.all(`SELECT "expiresAt" FROM ms_subscription WHERE mailbox = ? AND "expiresAt" > ?`, email, now)), "expiresAt") > now;
  return { ingested, deduped, skipped, bootstrapped, complete, nextPollMs: pollInterval(now, lastActivity, subscribed) };
}

/** The first delta walk of a folder starts from the last 90 days; Graph answers with every message still in the window. */
async function firstWalk(ctx: MsCtx, act: Act, email: string, folder: string, now: number) {
  const since = new Date(now - 90 * DAY).toISOString().replace(/\.\d+Z$/, "Z");
  return walkDelta(ctx, act, "ms.mail.delta", { base: userUrl(email, `/mailFolders/${folder}/messages/delta`), first: { $select: "id,isDraft", $filter: `receivedDateTime ge ${since}` } });
}

// ---- Graph message to mail.ingest input

interface Party { address: string; name?: string }
const party = (v: unknown): Party | null => {
  const e = obj(obj(v).emailAddress);
  const address = normalizeEmail(text(e.address) ?? "");
  if (!EMAIL.test(address)) return null;
  const name = (text(e.name) ?? "").trim();
  return name && name.toLowerCase() !== address ? { address, name } : { address };
};
const parties = (v: unknown): Party[] => list(v).map(party).filter((p): p is Party => p !== null);

const plain = (html: string): string => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** The ingest input for one Graph message, or null for a draft or a message with no usable sender. */
export async function toIngest(ctx: MsCtx, act: Act, mailbox: string, folder: string, m: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (m.isDraft === true) return null;
  const from = party(m.from);
  if (!from) return null;
  const id = text(m.id) ?? "";
  const body = obj(m.body);
  const content = text(body.content) ?? "";
  const isHtml = (text(body.contentType) ?? "").toLowerCase() === "html";
  const when = Date.parse(text(folder === "sentitems" ? m.sentDateTime : m.receivedDateTime) ?? text(m.receivedDateTime) ?? text(m.sentDateTime) ?? "");
  const out: Record<string, unknown> = {
    source: "microsoft", envelopeTo: mailbox, providerId: id,
    rfcMessageId: text(m.internetMessageId) ?? `<graph-${id}@outlook.office365.com>`,
    direction: folder === "sentitems" ? "out" : "in", from, to: parties(m.toRecipients), cc: parties(m.ccRecipients),
    subject: text(m.subject) ?? "", receivedAt: Number.isFinite(when) ? when : ctx.now(),
  };
  if (text(m.conversationId)) out.threadKey = text(m.conversationId);
  if (isHtml) { out.html = content; out.text = plain(content); } else out.text = content;
  const headers: Record<string, string> = {};
  for (const h of list(m.internetMessageHeaders)) {
    const o = obj(h);
    const k = (text(o.name) ?? "").toLowerCase();
    if ((k === "in-reply-to" || k === "references") && text(o.value) && !headers[k]) headers[k] = text(o.value)!;
  }
  if (Object.keys(headers).length) out.headers = headers;
  if (m.hasAttachments === true) {
    const attachments: { name: string; mime: string; size: number; blobId: string }[] = [];
    try {
      const listing = await call(ctx, act, "ms.mail.get_attachment", { url: userUrl(mailbox, `/messages/${enc(id)}/attachments`), query: { $select: "id,name,contentType,size,isInline" } });
      for (const x of list(listing.value)) {
        const o = obj(x);
        if (o["@odata.type"] !== "#microsoft.graph.fileAttachment" || o.isInline === true) continue;
        if ((int(o.size) ?? 0) > ATTACHMENT_MAX) continue;
        try {
          const saved = await mailAttachment(ctx, { ...act, messageId: id, attachmentId: text(o.id) ?? "" });
          attachments.push({ name: text(o.name) ?? "attachment", mime: text(o.contentType) ?? "application/octet-stream", size: saved.size, blobId: saved.blobId });
        } catch (e) {
          ctx.log.warn("microsoft attachment skipped", { messageId: id, code: codeOf(e) });
        }
      }
    } catch (e) {
      ctx.log.warn("microsoft attachments not listed", { messageId: id, code: codeOf(e) });
    }
    if (attachments.length) out.attachments = attachments;
  }
  return out;
}
