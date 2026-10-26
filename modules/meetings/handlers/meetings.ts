// Meetings (spec 2.18 Meetings, Meeting sources in v1; 3.3 flow 5; ARCH 8.3): ingest, merge, unmerge, state, attendee matching, get, list, schedule and cancel. A Meeting is an ordinary record
// (type meeting); this module adds the merge index, the recording and transcript, and the calendar and provider links. No meeting bot in v1 (lead ruling 50): nothing joins a call.
// DECISION: a calendar event and a provider meeting are one Meeting when (1) the same provider id or calendar event came before, (2) they share a join link (query and trailing slash ignored), or
// (3) they start within 15 minutes of each other and share at least one attendee email. A provider id never merges into a meeting that already has a different one.
// DECISION: ingest is idempotent: the same event or provider id again refreshes the fields (time, title, link, status) and says created false, merged false; only a new identity joining is a merge.
// DECISION: unmerge splits one calendar event off into a Meeting of its own, built from the event. A meeting with nothing but that one event cannot be unmerged (nothing would be left behind).
// DECISION: cancel marks the record canceled, deletes its calendar events and the Zoom meeting best-effort (a missing one is fine, a provider refusal is the caller's to see), and says so once.
import { codeOf, bad, ensure, first, isId, isInt, keyOf, linkFor, linkKey, links, list, meetingRecord, meetingRow, obj, paging, patchMeeting, providerOfUrl, pageOf, refuse, saveLink, text, strOrUndef } from "../projections.ts";
import type { Json, Link, MeetCtx, Provider } from "../projections.ts";

const WINDOW_MS = 15 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const STATUSES = ["scheduled", "live", "ended", "canceled"] as const;
const SOURCES = ["calendar", "zoom", "meet", "teams"] as const;
const CEV = /^cev_[a-z0-9]+$/;

interface Attendee { email: string; name?: string; contactId?: string }

function attendeesOf(ctx: MeetCtx, raw: unknown): Attendee[] {
  if (!Array.isArray(raw)) return bad(ctx, "Attendees are a list.");
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const a of raw) {
    const o = obj(a);
    const email = text(o["email"]).trim().toLowerCase();
    if (!EMAIL.test(email)) bad(ctx, "An attendee needs an email address.");
    if (o["contactId"] !== undefined && !isId("rec", o["contactId"])) bad(ctx, "An attendee's contact id is not valid.");
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, ...(strOrUndef(o["name"]) ? { name: strOrUndef(o["name"]) as string } : {}), ...(typeof o["contactId"] === "string" ? { contactId: o["contactId"] } : {}) });
  }
  return out;
}

/** Records for the attendees: the contact a person already named, else the sure match of their email, else nobody (the address stays in the merge index). */
async function contactIds(ctx: MeetCtx, who: Attendee[]): Promise<string[]> {
  const ids: string[] = [];
  for (const a of who) {
    let id = a.contactId;
    if (!id) {
      const found = obj(await ctx.call("contacts.resolve", { email: a.email }));
      id = strOrUndef(obj(list(found["sure"])[0])["recordId"]);
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function findMatch(ctx: MeetCtx, o: { source: string; providerRef: string; eventId?: string; joinUrl?: string; startsAt: number; emails: string[] }): { link: Link; by: "link" | "time_and_attendees" } | null {
  const all = links(ctx);
  const isCal = o.source === "calendar";
  const eventId = o.eventId ?? (isCal ? o.providerRef : undefined);
  // the same identity again
  const same = all.find((l) => (isCal ? eventId !== undefined && l.eventIds.includes(eventId) : l.providerRef === o.providerRef));
  if (same) return { link: same, by: "link" };
  const key = linkKey(o.joinUrl);
  if (key) {
    const hit = all.find((l) => linkKey(l.joinUrl) === key && (isCal || l.providerRef === null || l.providerRef === o.providerRef));
    if (hit) return { link: hit, by: "link" };
  }
  const near = all
    .filter((l) => Math.abs(l.startsAt - o.startsAt) <= WINDOW_MS && l.emails.some((e) => o.emails.includes(e)) && (isCal || l.providerRef === null || l.providerRef === o.providerRef))
    .sort((a, b) => Math.abs(a.startsAt - o.startsAt) - Math.abs(b.startsAt - o.startsAt) || a.recordId.localeCompare(b.recordId));
  const best = near[0];
  return best ? { link: best, by: "time_and_attendees" } : null;
}

export async function ingest(ctx: MeetCtx, input: {
  source: string; providerRef: string; calendarEventId?: string; title?: string; startsAt: number; endsAt?: number; joinUrl?: string; attendees: unknown[]; status?: string;
}) {
  ensure(ctx);
  if (!SOURCES.includes(input.source as never)) bad(ctx, "A meeting comes from the calendar, Zoom, Meet or Teams.");
  if (typeof input.providerRef !== "string" || input.providerRef === "") bad(ctx, "A meeting names its provider id.");
  if (input.calendarEventId !== undefined && !CEV.test(input.calendarEventId)) bad(ctx, "The calendar event id is not valid.");
  if (!isInt(input.startsAt)) bad(ctx, "A meeting has a start time.");
  if (input.endsAt !== undefined && (!isInt(input.endsAt) || input.endsAt < input.startsAt)) bad(ctx, "A meeting ends after it starts.");
  if (input.joinUrl !== undefined && (typeof input.joinUrl !== "string" || !/^https:\/\/\S+$/.test(input.joinUrl))) bad(ctx, "The join link is an https address.");
  if (input.status !== undefined && !STATUSES.includes(input.status as never)) bad(ctx, "That status is not known.");
  if (input.title !== undefined && typeof input.title !== "string") bad(ctx, "The title is text.");
  const who = attendeesOf(ctx, input.attendees);
  const emails = who.map((a) => a.email);
  const isCal = input.source === "calendar";
  const eventId = input.calendarEventId ?? (isCal && CEV.test(input.providerRef) ? input.providerRef : undefined);
  const provider: Provider = isCal ? providerOfUrl(input.joinUrl) : (input.source as Provider);

  const hit = findMatch(ctx, { source: input.source, providerRef: input.providerRef, ...(eventId ? { eventId } : {}), ...(input.joinUrl ? { joinUrl: input.joinUrl } : {}), startsAt: input.startsAt, emails });
  if (!hit) {
    const attendeeIds = await contactIds(ctx, who);
    const created = obj(obj(await ctx.call("records.create", {
      type: "meeting", idempotencyKey: `meeting:${input.source}:${input.providerRef}`,
      fields: {
        title: input.title?.trim() || "Meeting", starts_at: input.startsAt, ...(input.endsAt !== undefined ? { ends_at: input.endsAt } : {}), provider,
        ...(input.joinUrl ? { join_url: input.joinUrl } : {}), status: input.status ?? "scheduled", attendees: attendeeIds, recording_state: "none",
        ...(eventId ? { calendar_event_id: eventId } : {}), ...(!isCal ? { provider_ref: input.providerRef } : {}),
      },
    })).record);
    const recordId = text(created["id"]);
    if (!isId("rec", recordId)) throw new Error("records.create answered no id");
    saveLink(ctx, {
      recordId, providerRef: isCal ? null : input.providerRef, joinUrl: input.joinUrl ?? null, startsAt: input.startsAt, endsAt: input.endsAt ?? null, emails, eventIds: eventId ? [eventId] : [],
      provider, recordingFileId: null, recordingDurationSec: null, folderId: null, mergedBy: null, createdAt: ctx.now(),
    });
    if (input.status === "canceled") ctx.emit("meeting.canceled", `record/${recordId}`, { meetingId: recordId });
    return { meetingId: recordId, created: true, merged: false };
  }

  const l = hit.link;
  const rec = await meetingRecord(ctx, l.recordId);
  const newEvent = eventId !== undefined && !l.eventIds.includes(eventId);
  const newRef = !isCal && l.providerRef !== input.providerRef;
  const patch: Json = {};
  const merged = newEvent || newRef;
  const next: Link = { ...l, emails: [...new Set([...l.emails, ...emails])], eventIds: newEvent ? [...l.eventIds, eventId as string] : l.eventIds };
  if (newRef) { next.providerRef = input.providerRef; patch["provider_ref"] = input.providerRef; }
  if (input.joinUrl && (!l.joinUrl || !isCal)) { next.joinUrl = input.joinUrl; patch["join_url"] = input.joinUrl; }
  if (provider !== "none" && l.provider !== provider) { next.provider = provider; patch["provider"] = provider; }
  if (!merged && input.startsAt !== l.startsAt) { next.startsAt = input.startsAt; patch["starts_at"] = input.startsAt; }
  if (!merged && input.endsAt !== undefined && input.endsAt !== l.endsAt) { next.endsAt = input.endsAt; patch["ends_at"] = input.endsAt; }
  // a refresh of the same event or provider meeting may retitle it; a new identity joining keeps the title it finds, unless that was only the placeholder
  if (input.title?.trim() && input.title.trim() !== text(rec.fields["title"]) && (!merged || text(rec.fields["title"]) === "" || text(rec.fields["title"]) === "Meeting")) patch["title"] = input.title.trim();
  if (newEvent && !text(rec.fields["calendar_event_id"])) patch["calendar_event_id"] = eventId;
  if (who.length) {
    const have = list(rec.fields["attendees"]).filter((x): x is string => typeof x === "string");
    const more = (await contactIds(ctx, who)).filter((id) => !have.includes(id));
    if (more.length) patch["attendees"] = [...have, ...more];
  }
  const canceled = input.status === "canceled" && text(rec.fields["status"]) !== "canceled";
  if (canceled) patch["status"] = "canceled";
  if (merged) next.mergedBy = hit.by;
  if (Object.keys(patch).length) await patchMeeting(ctx, l.recordId, patch);
  saveLink(ctx, next);
  if (merged) ctx.emit("meeting.merged", `record/${l.recordId}`, { meetingId: l.recordId, ...(newEvent ? { eventId } : {}), ...(newRef ? { providerRef: input.providerRef } : {}), by: hit.by });
  if (canceled) ctx.emit("meeting.canceled", `record/${l.recordId}`, { meetingId: l.recordId });
  return { meetingId: l.recordId, created: false, merged };
}

export async function setMeetingState(ctx: MeetCtx, input: { meetingId: string; state: string }) {
  ensure(ctx);
  if (input.state !== "live" && input.state !== "ended") bad(ctx, "A meeting goes live or ends.");
  const rec = await meetingRecord(ctx, input.meetingId);
  const status = text(rec.fields["status"]) || "scheduled";
  if (status === "canceled") refuse(ctx, "That meeting was canceled.");
  if (status === input.state) return { meetingId: input.meetingId };
  if (status === "ended") refuse(ctx, "That meeting already ended.");
  await patchMeeting(ctx, input.meetingId, { status: input.state });
  const provider = (text(rec.fields["provider"]) || "none") as Provider;
  if (input.state === "live") ctx.emit("meeting.started", `record/${input.meetingId}`, { meetingId: input.meetingId, provider });
  else {
    const attendeeIds = list(rec.fields["attendees"]).filter((x): x is string => typeof x === "string");
    ctx.emit("meeting.ended", `record/${input.meetingId}`, { meetingId: input.meetingId, provider, attendeeIds });
  }
  return { meetingId: input.meetingId };
}

export async function merge(ctx: MeetCtx, input: { meetingId: string; otherId: string }) {
  ensure(ctx);
  if (input.meetingId === input.otherId) bad(ctx, "Pick a second meeting.");
  const a = await meetingRecord(ctx, input.meetingId);
  const b = await meetingRecord(ctx, input.otherId);
  const la = linkFor(ctx, input.meetingId);
  const lb = linkFor(ctx, input.otherId);
  if (!la || !lb) refuse(ctx, "One of these meetings has no calendar or provider details to merge.");
  const [one, two] = [la as Link, lb as Link];
  if (one.providerRef && two.providerRef && one.providerRef !== two.providerRef) refuse(ctx, "These come from two different provider meetings, so they are two calls.");
  const patch: Json = {};
  const next: Link = {
    ...one, providerRef: one.providerRef ?? two.providerRef, joinUrl: one.joinUrl ?? two.joinUrl, emails: [...new Set([...one.emails, ...two.emails])], eventIds: [...new Set([...one.eventIds, ...two.eventIds])],
    provider: one.provider !== "none" ? one.provider : two.provider, recordingFileId: one.recordingFileId ?? two.recordingFileId, recordingDurationSec: one.recordingDurationSec ?? two.recordingDurationSec,
    folderId: one.folderId ?? two.folderId, mergedBy: "person",
  };
  if (!one.providerRef && two.providerRef) patch["provider_ref"] = two.providerRef;
  if (!one.joinUrl && two.joinUrl) patch["join_url"] = two.joinUrl;
  if (one.provider === "none" && two.provider !== "none") patch["provider"] = two.provider;
  for (const k of ["transcript", "summary", "decisions", "calendar_event_id"] as const) if (!text(a.fields[k]) && text(b.fields[k])) patch[k] = b.fields[k];
  if (!list(a.fields["recording"]).length && list(b.fields["recording"]).length) { patch["recording"] = b.fields["recording"]; patch["recording_state"] = b.fields["recording_state"]; }
  const have = list(a.fields["attendees"]).filter((x): x is string => typeof x === "string");
  const more = list(b.fields["attendees"]).filter((x): x is string => typeof x === "string" && !have.includes(x));
  if (more.length) patch["attendees"] = [...have, ...more];
  if (Object.keys(patch).length) await patchMeeting(ctx, input.meetingId, patch);
  saveLink(ctx, next);
  ctx.db.run(`UPDATE meetings_segment SET "recordId" = ? WHERE "recordId" = ?`, input.meetingId, input.otherId);
  ctx.db.run(`UPDATE meetings_run SET "recordId" = ? WHERE "recordId" = ?`, input.meetingId, input.otherId);
  ctx.db.run(`DELETE FROM meetings_link WHERE "recordId" = ?`, input.otherId);
  await ctx.call("records.delete", { type: "meeting", recordId: input.otherId });
  const added = two.eventIds.find((e) => !one.eventIds.includes(e));
  ctx.emit("meeting.merged", `record/${input.meetingId}`, { meetingId: input.meetingId, ...(added ? { eventId: added } : {}), ...(two.providerRef && !one.providerRef ? { providerRef: two.providerRef } : {}), by: "person" });
  return { meetingId: input.meetingId };
}

export async function unmerge(ctx: MeetCtx, input: { meetingId: string; eventId: string }) {
  ensure(ctx);
  if (!CEV.test(input.eventId ?? "")) bad(ctx, "The calendar event id is not valid.");
  const rec = await meetingRecord(ctx, input.meetingId);
  const l = linkFor(ctx, input.meetingId);
  if (!l || !l.eventIds.includes(input.eventId)) refuse(ctx, "That calendar event is not part of this meeting.");
  const link = l as Link;
  if (link.eventIds.length < 2 && !link.providerRef) refuse(ctx, "This meeting is only that event, so there is nothing to split off.");
  const ev = obj(obj(await ctx.call("calendar.get_event", { eventId: input.eventId })).event);
  const who = list(ev["attendees"]).map(obj).map((a) => ({ email: text(a["email"]).toLowerCase(), ...(strOrUndef(a["contactId"]) ? { contactId: text(a["contactId"]) } : {}) })).filter((a) => EMAIL.test(a.email));
  const startsAt = typeof ev["startsAt"] === "number" ? ev["startsAt"] : link.startsAt;
  const created = obj(obj(await ctx.call("records.create", {
    type: "meeting", idempotencyKey: `meeting:unmerge:${input.meetingId}:${input.eventId}`,
    fields: {
      title: text(ev["title"]) || text(rec.fields["title"]) || "Meeting", starts_at: startsAt, ...(typeof ev["endsAt"] === "number" ? { ends_at: ev["endsAt"] } : {}), provider: "none", status: "scheduled",
      attendees: await contactIds(ctx, who), recording_state: "none", calendar_event_id: input.eventId,
    },
  })).record);
  const newId_ = text(created["id"]);
  if (!isId("rec", newId_)) throw new Error("records.create answered no id");
  saveLink(ctx, {
    recordId: newId_, providerRef: null, joinUrl: null, startsAt, endsAt: typeof ev["endsAt"] === "number" ? ev["endsAt"] : null, emails: who.map((a) => a.email), eventIds: [input.eventId],
    provider: "none", recordingFileId: null, recordingDurationSec: null, folderId: null, mergedBy: null, createdAt: ctx.now(),
  });
  const rest = link.eventIds.filter((e) => e !== input.eventId);
  saveLink(ctx, { ...link, eventIds: rest, mergedBy: rest.length || link.providerRef ? link.mergedBy : null });
  if (text(rec.fields["calendar_event_id"]) === input.eventId) await patchMeeting(ctx, input.meetingId, { calendar_event_id: rest[0] ?? "" });
  ctx.emit("meeting.unmerged", `record/${input.meetingId}`, { meetingId: input.meetingId, eventId: input.eventId });
  return { meetingId: input.meetingId, newMeetingId: newId_ };
}

export async function matchAttendees(ctx: MeetCtx, input: { meetingId: string }) {
  ensure(ctx);
  const rec = await meetingRecord(ctx, input.meetingId);
  const l = linkFor(ctx, input.meetingId);
  if (!l) return { matched: 0, unsure: 0 };
  const key = `matched:${input.meetingId}`;
  const done = JSON.parse(text(first(ctx.db.all(`SELECT * FROM meetings_state WHERE "key" = ?`, key))?.["value"]) || "{}") as Record<string, string>;
  const have = list(rec.fields["attendees"]).filter((x): x is string => typeof x === "string");
  let matched = 0;
  let unsure = 0;
  const add: string[] = [];
  for (const email of l.emails) {
    if (done[email]) continue;
    const found = obj(await ctx.call("contacts.resolve", { email }));
    const sure = strOrUndef(obj(list(found["sure"])[0])["recordId"]);
    if (sure) {
      done[email] = sure;
      if (!have.includes(sure) && !add.includes(sure)) add.push(sure);
      matched++;
    } else if (list(found["unsure"]).length) {
      done[email] = "asked";
      unsure++;
      await ctx.call("tasks.create", {
        title: `Who is ${email}?`, why: `Attendee of ${text(rec.fields["title"]) || "a meeting"}; more than one contact could be them.`, assigned: { kind: "person", id: ctx.principal.id },
        recordId: input.meetingId, source: { kind: "manual", id: input.meetingId }, idempotencyKey: `meeting:match:${input.meetingId}:${email}`,
      });
    }
  }
  if (add.length) await patchMeeting(ctx, input.meetingId, { attendees: [...have, ...add] });
  const stored = first(ctx.db.all(`SELECT * FROM meetings_state WHERE "key" = ?`, key));
  if (stored) ctx.db.run(`UPDATE meetings_state SET "value" = ? WHERE "key" = ?`, JSON.stringify(done), key);
  else ctx.db.run(`INSERT INTO meetings_state ("key", "value") VALUES (?, ?)`, key, JSON.stringify(done));
  return { matched, unsure };
}

export async function get(ctx: MeetCtx, input: { meetingId: string }) {
  ensure(ctx);
  const rec = await meetingRecord(ctx, input.meetingId);
  const l = linkFor(ctx, input.meetingId);
  const f = rec.fields;
  return {
    meeting: meetingRow(ctx, input.meetingId, f, l),
    ...(l?.recordingFileId ? { recordingFileId: l.recordingFileId } : {}), ...(l?.recordingDurationSec != null ? { recordingDurationSec: l.recordingDurationSec } : {}),
    ...(text(f["transcript"]) ? { transcript: text(f["transcript"]) } : {}), ...(text(f["summary"]) ? { summary: text(f["summary"]) } : {}), ...(text(f["decisions"]) ? { decisions: text(f["decisions"]) } : {}),
  };
}

export async function listMeetings(ctx: MeetCtx, input: { from?: number; to?: number; contactId?: string; status?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  for (const k of ["from", "to"] as const) if (input[k] !== undefined && !isInt(input[k])) bad(ctx, `${k} is a time.`);
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (input.status !== undefined && !STATUSES.includes(input.status as never)) bad(ctx, "That status is not known.");
  const rows: Json[] = [];
  let at: string | undefined;
  for (let pages = 0; pages < 40; pages++) {
    const page = obj(await ctx.call("records.query", { type: "meeting", sort: [{ field: "starts_at", dir: "desc" }], limit: 500, ...(at ? { cursor: at } : {}) }));
    rows.push(...list(page["rows"]).map(obj));
    at = strOrUndef(page["next"]);
    if (!at) break;
  }
  const picked = rows.filter((r) => {
    const f = obj(r["fields"]);
    const s = typeof f["starts_at"] === "number" ? f["starts_at"] : 0;
    return (input.from === undefined || s >= input.from) && (input.to === undefined || s < input.to) && (input.status === undefined || (text(f["status"]) || "scheduled") === input.status)
      && (input.contactId === undefined || list(f["attendees"]).includes(input.contactId));
  }).map((r) => meetingRow(ctx, text(r["id"]), obj(r["fields"]), linkFor(ctx, text(r["id"]))));
  picked.sort((a, b) => (b["startsAt"] as number) - (a["startsAt"] as number) || text(a["id"]).localeCompare(text(b["id"])));
  const p = pageOf(picked, cursor, limit);
  return { meetings: p.page, ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function schedule(ctx: MeetCtx, input: { title: string; startsAt: number; endsAt: number; attendees: unknown[]; provider: string; calendarId?: string; agenda?: string; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  if (typeof input.title !== "string" || input.title.trim() === "" || input.title.length > 300) bad(ctx, "A meeting title is 1 to 300 characters.");
  if (!isInt(input.startsAt) || !isInt(input.endsAt) || input.endsAt <= input.startsAt) bad(ctx, "A meeting ends after it starts.");
  if (!["zoom", "meet", "teams", "none"].includes(input.provider)) bad(ctx, "The meeting link is Zoom, Meet, Teams or none.");
  if (input.calendarId !== undefined && !/^cld_[a-z0-9]+$/.test(input.calendarId)) bad(ctx, "The calendar id is not valid.");
  if (input.agenda !== undefined && typeof input.agenda !== "string") bad(ctx, "The agenda is text.");
  const who = attendeesOf(ctx, input.attendees);
  let calendarId = input.calendarId;
  if (!calendarId) {
    const cals = list(obj(await ctx.call("calendar.list_calendars", { scope: "mine" }))["calendars"]).map(obj);
    calendarId = text((cals.find((c) => c["personal"] === true) ?? cals[0])?.["id"]) || undefined;
    if (!calendarId) refuse(ctx, "You have no calendar to put the meeting in. Connect one first.");
  }
  let zoom: Json | null = null;
  if (input.provider === "zoom") {
    zoom = obj(obj(await ctx.call("zoom.meetings.create", { topic: input.title.trim(), startTime: input.startsAt, durationMinutes: Math.max(1, Math.ceil((input.endsAt - input.startsAt) / 60_000)), ...(input.agenda ? { agenda: input.agenda } : {}), idempotencyKey: `${key}:zoom` })).meeting);
    if (!text(zoom["id"]) || !text(zoom["joinUrl"])) throw new Error("zoom.meetings.create answered no meeting");
  }
  const created = obj(obj(await ctx.call("calendar.create_event", {
    calendarId, title: input.title.trim(), startsAt: input.startsAt, endsAt: input.endsAt, attendees: who.map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}), ...(a.contactId ? { contactId: a.contactId } : {}) })),
    joinProvider: input.provider, ...(input.agenda ? { agenda: input.agenda } : {}), idempotencyKey: `${key}:event`,
  })).event);
  const eventId = text(created["id"]);
  if (!CEV.test(eventId)) throw new Error("calendar.create_event answered no id");
  let joinUrl = strOrUndef(created["joinUrl"]);
  const base = { title: input.title.trim(), startsAt: input.startsAt, endsAt: input.endsAt, attendees: who };
  let res = obj(await ingest(ctx, { source: "calendar", providerRef: eventId, calendarEventId: eventId, ...base, ...(joinUrl ? { joinUrl } : {}) }));
  if (zoom) {
    joinUrl = text(zoom["joinUrl"]);
    res = obj(await ingest(ctx, { source: "zoom", providerRef: text(zoom["id"]), ...base, joinUrl }));
  }
  const meetingId = text(res["meetingId"]);
  return { meetingId, eventId, ...(joinUrl ? { joinUrl } : {}) };
}

export async function cancel(ctx: MeetCtx, input: { meetingId: string }) {
  ensure(ctx);
  const rec = await meetingRecord(ctx, input.meetingId);
  if (text(rec.fields["status"]) === "canceled") return { meetingId: input.meetingId };
  const l = linkFor(ctx, input.meetingId);
  for (const eventId of l?.eventIds ?? []) {
    try { await ctx.call("calendar.delete_event", { eventId }); } catch (e) { if (codeOf(e) !== "validation.not_found") throw e; }
  }
  if (l?.providerRef && l.provider === "zoom") {
    try { await ctx.call("zoom.meetings.delete", { meetingId: l.providerRef, idempotencyKey: `meeting_cancel:${input.meetingId}:zoom` }); } catch (e) { if (codeOf(e) !== "validation.not_found") throw e; }
  }
  await patchMeeting(ctx, input.meetingId, { status: "canceled" });
  ctx.emit("meeting.canceled", `record/${input.meetingId}`, { meetingId: input.meetingId });
  return { meetingId: input.meetingId };
}

