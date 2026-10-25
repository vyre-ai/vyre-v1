// Calls (spec 2.18 Calls and SMS, Call routing and recording; 3.3 flow 3; ARCH 8.2): dial, answer, decline, hangup, hold, transfer, record, the call list and detail, logging a task from a call,
// attaching a transcript and summary, and the Voice SDK token. Twilio is reached only through `twilio.*`; every call lands in the contact's conversation through inbox.link_message.
// DECISION: dial asks Twilio to place the call from the number (twilio.call.create) and, when the destination answers, the voice hook bridges it to the person's softphone (telephony.ingest_voice
// finds the call by its Sid and rings the dialer). The softphone gets the call id back as a parameter. An agent's call is placed the same way and bridges to the agent.
// DECISION: recording follows the number's policy. off: never. announce: the caller hears an announcement (the hook plays it; telephony.record needs consent.announced). ask: a person asked and
// someone agreed (consent.confirmedBy names who). The consent that was logged stays on the call and in call.recording_changed, and a stop leaves it in place.
// DECISION: transfer redirects the live call to the number's voice address with `to` in the query, then the call is handled by the new person or agent. Group targets are refused (spec 2.18: teammates and agents).
// DECISION: decline by one person marks that person in the call's meta; with toVoicemail the call moves to voicemail, otherwise it is missed once nobody else is left ringing.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  bad, callMeta, callOut, ensure, isId, liveCall, liveNumber, list, newId, numOrNull, num, obj, pageOf, paging, parseJson, partyOf, patch, refuse, rowsOf, setMeta, str, strOrNull, text, phone, strOrUndef, keyOf,
} from "../projections.ts";
import type { Party, Row, TelCtx } from "../projections.ts";

const live = (r: Row): boolean => r.deleted_at === null || r.deleted_at === undefined;

const callId = (ctx: TelCtx, v: unknown): string => (isId("cal", v) ? v : bad(ctx, "Call id is not valid."));

export function eventBase(row: Row): { callId: string; numberId: string; direction: string; contactId?: string } {
  const out: { callId: string; numberId: string; direction: string; contactId?: string } = { callId: str(row, "id"), numberId: str(row, "numberId"), direction: str(row, "direction") };
  if (strOrNull(row, "contactId")) out.contactId = str(row, "contactId");
  return out;
}

/** End a call that was connected or ringing: stamp the end, the duration and the state, and say so once. Returns the new row. */
export function finishCall(ctx: TelCtx, row: Row, o: { state: "completed" | "missed" | "failed" | "voicemail"; durationSec?: number; announce: boolean }): Row {
  const now = ctx.now();
  const answered = numOrNull(row, "answeredAt");
  const duration = o.durationSec ?? (answered !== null ? Math.max(0, Math.round((now - answered) / 1000)) : 0);
  patch(ctx, "telephony_call", str(row, "id"), { state: o.state, endedAt: now, durationSec: duration });
  setMeta(ctx, str(row, "id"), { recording: 0, hold: 0 });
  if (o.announce) {
    const base = eventBase(row);
    if (o.state === "completed") ctx.emit("call.ended", `entity/${base.callId}`, { ...base, durationSec: duration });
    else if (o.state === "missed") ctx.emit("call.missed", `entity/${base.callId}`, { callId: base.callId, numberId: base.numberId, from: str(row, "from"), ...(base.contactId ? { contactId: base.contactId } : {}) });
  }
  return liveCall(ctx, str(row, "id"));
}

/** The conversation of the other party: link the call to the contact (or to Unmatched), and keep the contact the link found. */
export async function linkCall(ctx: TelCtx, row: Row, address: string, preview: string): Promise<void> {
  const out = obj(await ctx.call("inbox.link_message", {
    channel: "call", ref: { kind: "call", id: str(row, "id") }, address, direction: str(row, "direction"), at: num(row, "startedAt"), numberId: str(row, "numberId"), preview,
  }));
  const contactId = strOrUndef(out.contactId);
  if (contactId && !strOrNull(row, "contactId")) patch(ctx, "telephony_call", str(row, "id"), { contactId });
}

// ---- dial

export async function dial(ctx: TelCtx, input: { numberId: string; to: string; contactId?: string; record?: boolean; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  if (!isId("num", input.numberId)) bad(ctx, "Number id is not valid.");
  const to = phone(ctx, input.to, "The number to call");
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  const who = partyOf(ctx);
  const n = liveNumber(ctx, input.numberId);
  if (str(n, "state") !== "active") refuse(ctx, "That number is not active.");
  if (!parseJson<string[]>(n.capabilities, []).includes("voice")) refuse(ctx, "That number cannot place calls.");
  if (str(n, "e164") === to) refuse(ctx, "A number cannot call itself.");
  if (list(obj(await ctx.call("contacts.suppression.check", { channel: "call", addresses: [to] })).suppressed).length > 0) refuse(ctx, "That number asked not to be called.");
  let contactId = input.contactId;
  if (contactId === undefined) contactId = strOrUndef(obj(list(obj(await ctx.call("contacts.resolve", { phone: to })).sure)[0]).recordId);
  if (contactId !== undefined && obj(await ctx.call("contacts.preferences.get", { contactId })).doNotContact === true) refuse(ctx, "This contact is marked Do not contact.");

  const policy = str(n, "recording");
  if (input.record === true) {
    if (policy === "off") refuse(ctx, "Recording is off for this number. Change it in Console, Numbers.");
    if (policy === "ask") refuse(ctx, "This number asks before recording. Start the call, ask the other person, then use Record.");
  }
  const record = input.record === true && policy === "announce";

  const now = ctx.now();
  const id = newId("cal", now);
  ctx.db.run(
    `INSERT INTO telephony_call ("id", "numberId", "direction", "from", "to", "contactId", "state", "startedAt", "handledBy", "consentLogged", "traceId", "version", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.numberId, "out", str(n, "e164"), to, contactId ?? null, "ringing", now, JSON.stringify(who), record ? 1 : 0, ctx.trace.traceId, 0, now,
  );
  setMeta(ctx, id, { recording: record ? 1 : 0, consent: record ? JSON.stringify({ announced: true, by: who.id, at: now }) : null });
  let sid: string;
  try {
    sid = text(obj(await ctx.call("twilio.call.create", { from: str(n, "e164"), to, ...(record ? { record: true } : {}), idempotencyKey: `${key}:call` })).sid);
    if (sid === "") throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the call." });
  } catch (e) {
    patch(ctx, "telephony_call", id, { state: "failed", endedAt: ctx.now(), durationSec: 0 });
    throw e;
  }
  patch(ctx, "telephony_call", id, { twilioSid: sid });
  await linkCall(ctx, liveCall(ctx, id), to, "Outgoing call");
  return { callId: id, params: { CallId: id, From: str(n, "e164"), To: to } };
}

// ---- answer, decline, hangup, hold

export async function answer(ctx: TelCtx, input: { callId: string }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (str(row, "state") === "answered") refuse(ctx, "Someone already answered this call.");
  if (str(row, "state") !== "ringing") refuse(ctx, "This call is not ringing.");
  if (str(row, "direction") !== "in") refuse(ctx, "You placed this call; it connects when the other person answers.");
  const who = partyOf(ctx);
  const ringing = parseJson<Party[]>(callMeta(ctx, str(row, "id")).ringing, []);
  if (ringing.length > 0 && !ringing.some((p) => p.kind === "group" || (p.kind === who.kind && p.id === who.id))) {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "This call is not ringing for you." });
  }
  patch(ctx, "telephony_call", str(row, "id"), { state: "answered", answeredAt: ctx.now(), handledBy: JSON.stringify(who) });
  const base = eventBase(row);
  ctx.emit("call.started", `entity/${base.callId}`, base);
  return { call: callOut(liveCall(ctx, str(row, "id"))) };
}

export async function decline(ctx: TelCtx, input: { callId: string; toVoicemail?: boolean }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (input.toVoicemail !== undefined && typeof input.toVoicemail !== "boolean") bad(ctx, "toVoicemail is true or false.");
  if (str(row, "state") !== "ringing" || str(row, "direction") !== "in") refuse(ctx, "Only a call that is ringing can be declined.");
  const who = partyOf(ctx);
  const meta = callMeta(ctx, str(row, "id"));
  const declined = parseJson<Party[]>(meta.declined, []);
  if (!declined.some((p) => p.kind === who.kind && p.id === who.id)) declined.push(who);
  setMeta(ctx, str(row, "id"), { declined: JSON.stringify(declined) });
  const ringing = parseJson<Party[]>(meta.ringing, []);
  const others = ringing.filter((p) => !declined.some((d) => d.kind === p.kind && d.id === p.id));
  if (input.toVoicemail === true) {
    patch(ctx, "telephony_call", str(row, "id"), { state: "voicemail" });
  } else if (others.length === 0) {
    finishCall(ctx, row, { state: "missed", durationSec: 0, announce: true });
  }
  return { call: callOut(liveCall(ctx, str(row, "id"))) };
}

export async function hangup(ctx: TelCtx, input: { callId: string }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (!["ringing", "answered"].includes(str(row, "state"))) refuse(ctx, "This call already ended.");
  if (strOrNull(row, "twilioSid")) await ctx.call("twilio.call.update", { sid: str(row, "twilioSid"), action: "hangup", idempotencyKey: `tel:${str(row, "id")}:hangup` });
  const answered = numOrNull(row, "answeredAt") !== null || str(row, "direction") === "out";
  return { call: callOut(finishCall(ctx, row, { state: answered ? "completed" : "missed", announce: true })) };
}

export async function hold(ctx: TelCtx, input: { callId: string; hold: boolean }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (typeof input.hold !== "boolean") bad(ctx, "hold is true or false.");
  if (str(row, "state") !== "answered") refuse(ctx, "Only a call in progress can be put on hold.");
  const meta = callMeta(ctx, str(row, "id"));
  if ((num(meta, "hold") === 1) === input.hold) return { call: callOut(row) };
  const sid = strOrNull(row, "twilioSid");
  if (!sid) refuse(ctx, "This call is not connected to the phone network.");
  if (input.hold) await ctx.call("twilio.call.update", { sid: sid as string, action: "hold", idempotencyKey: `tel:${str(row, "id")}:hold:${ctx.now()}` });
  else await ctx.call("twilio.call.update", { sid: sid as string, action: "resume", targetUrl: await voiceUrlOf(ctx, row), idempotencyKey: `tel:${str(row, "id")}:resume:${ctx.now()}` });
  setMeta(ctx, str(row, "id"), { hold: input.hold ? 1 : 0 });
  return { call: callOut(liveCall(ctx, str(row, "id"))) };
}

/** The voice address Twilio has for the number a call is on (it is where a resumed or redirected call asks what to do next). */
async function voiceUrlOf(ctx: TelCtx, row: Row): Promise<string> {
  const n = liveNumber(ctx, str(row, "numberId"));
  const owned = list(obj(await ctx.call("twilio.number.list_owned", {})).numbers).map(obj).find((o) => o.e164 === str(n, "e164"));
  const url = strOrUndef(owned?.voiceUrl);
  if (!url) refuse(ctx, "Twilio has no voice address for this number. Open Console, Numbers and save the number again.");
  return url as string;
}

// ---- transfer

export async function transfer(ctx: TelCtx, input: { callId: string; to: { kind: string; id: string }; mode: string }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  const to = obj(input.to);
  if (to.kind !== "person" && to.kind !== "agent") refuse(ctx, "A call can be transferred to a teammate or an agent.");
  if (!isId(to.kind === "person" ? "usr" : "agt", to.id)) bad(ctx, "The person or agent to transfer to has an id that is not valid.");
  if (input.mode !== "warm" && input.mode !== "cold") bad(ctx, "A transfer is warm or cold.");
  if (str(row, "state") !== "answered") refuse(ctx, "Only a call in progress can be transferred.");
  const target: Party = { kind: to.kind as "person" | "agent", id: to.id as string };
  const by = parseJson<Party | null>(row.handledBy, null);
  if (by && by.kind === target.kind && by.id === target.id) refuse(ctx, "The call is already with them.");
  const sid = strOrNull(row, "twilioSid");
  if (!sid) refuse(ctx, "This call is not connected to the phone network.");
  const url = `${await voiceUrlOf(ctx, row)}?to=${encodeURIComponent(target.id)}&kind=${target.kind}&call=${str(row, "id")}`;
  await ctx.call("twilio.call.update", { sid: sid as string, action: "redirect", targetUrl: url, idempotencyKey: `tel:${str(row, "id")}:transfer:${ctx.now()}` });
  patch(ctx, "telephony_call", str(row, "id"), { handledBy: JSON.stringify(target) });
  setMeta(ctx, str(row, "id"), { hold: 0 });
  ctx.emit("call.transferred", `entity/${str(row, "id")}`, { callId: str(row, "id"), to: target, mode: input.mode });
  return { call: callOut(liveCall(ctx, str(row, "id"))) };
}

// ---- record

export async function record(ctx: TelCtx, input: { callId: string; action: string; consent?: { announced: boolean; confirmedBy?: string } }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (input.action !== "start" && input.action !== "stop") bad(ctx, "Recording starts or stops.");
  if (str(row, "state") !== "answered") refuse(ctx, "Only a call in progress can be recorded.");
  const sid = strOrNull(row, "twilioSid");
  if (!sid) refuse(ctx, "This call is not connected to the phone network.");
  const meta = callMeta(ctx, str(row, "id"));
  const on = num(meta, "recording") === 1;
  if (input.action === "stop") {
    if (!on) refuse(ctx, "This call is not being recorded.");
    if (strOrNull(meta, "recordingSid")) await ctx.call("twilio.recording.stop", { callSid: sid as string, recordingSid: str(meta, "recordingSid"), idempotencyKey: `tel:${str(row, "id")}:recstop:${ctx.now()}` });
    setMeta(ctx, str(row, "id"), { recording: 0 });
    ctx.emit("call.recording_changed", `entity/${str(row, "id")}`, { callId: str(row, "id"), recording: false, consentLogged: num(row, "consentLogged") === 1 });
    return { recording: false, consentLogged: num(row, "consentLogged") === 1 };
  }
  if (on) return { recording: true, consentLogged: num(row, "consentLogged") === 1 };
  const policy = str(liveNumber(ctx, str(row, "numberId")), "recording");
  if (policy === "off") refuse(ctx, "Recording is off for this number.");
  const consent = obj(input.consent);
  if (policy === "announce" && consent.announced !== true) refuse(ctx, "Tell the caller the call is being recorded first.");
  const confirmedBy = strOrUndef(consent.confirmedBy);
  if (policy === "ask" && (consent.announced !== true || !confirmedBy)) refuse(ctx, "Ask the other person if you may record, and note who agreed.");
  const started = obj(await ctx.call("twilio.recording.start", { callSid: sid as string, announced: true }));
  setMeta(ctx, str(row, "id"), { recording: 1, recordingSid: text(started.recordingSid), consent: JSON.stringify({ policy, announced: true, ...(confirmedBy ? { confirmedBy } : {}), by: ctx.principal.id, at: ctx.now() }) });
  patch(ctx, "telephony_call", str(row, "id"), { consentLogged: 1 });
  ctx.emit("call.recording_changed", `entity/${str(row, "id")}`, { callId: str(row, "id"), recording: true, consentLogged: true });
  return { recording: true, consentLogged: true };
}

// ---- reading

export async function callList(ctx: TelCtx, input: { numberId?: string; contactId?: string; direction?: string; state?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  if (input.direction !== undefined && input.direction !== "in" && input.direction !== "out") bad(ctx, "Direction is in or out.");
  if (input.state !== undefined && !["ringing", "answered", "voicemail", "completed", "missed", "failed"].includes(input.state)) bad(ctx, "That call state is not known.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM telephony_call`)).filter((r) => live(r)
    && (input.numberId === undefined || str(r, "numberId") === input.numberId) && (input.contactId === undefined || str(r, "contactId") === input.contactId)
    && (input.direction === undefined || str(r, "direction") === input.direction) && (input.state === undefined || str(r, "state") === input.state));
  rows.sort((a, b) => num(b, "startedAt") - num(a, "startedAt") || str(b, "id").localeCompare(str(a, "id")));
  const p = pageOf(rows, cursor, limit);
  return { calls: p.page.map(callOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function callGet(ctx: TelCtx, input: { callId: string }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  const transcript = strOrNull(row, "transcript");
  return { call: callOut(row), ...(transcript ? { transcript } : {}) };
}

export async function callLogTask(ctx: TelCtx, input: { callId: string; title: string; assigneeId?: string; dueAt?: number; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (typeof input.title !== "string" || input.title.trim() === "") bad(ctx, "Give the task a title.");
  if (input.assigneeId !== undefined && !isId("usr", input.assigneeId)) bad(ctx, "The assignee id is not valid.");
  if (input.dueAt !== undefined && !Number.isSafeInteger(input.dueAt)) bad(ctx, "The due time is not valid.");
  const made = obj(obj(await ctx.call("tasks.create", {
    title: input.title.trim(), assigned: { kind: "person", id: input.assigneeId ?? ctx.principal.id }, ...(input.dueAt !== undefined ? { due: input.dueAt } : {}),
    ...(strOrNull(row, "contactId") ? { recordId: str(row, "contactId") } : {}), source: { kind: "manual", id: str(row, "id") }, idempotencyKey: `${key}:task`,
  })).task);
  const taskId = text(made.id);
  if (taskId === "") throw fail("internal.unexpected", ctx.trace.traceId, { message: "The task was not created." });
  return { taskId };
}

export async function callAttachSummary(ctx: TelCtx, input: { callId: string; transcript?: string; summary?: string }) {
  ensure(ctx);
  const row = liveCall(ctx, callId(ctx, input.callId));
  if (input.transcript === undefined && input.summary === undefined) bad(ctx, "Send a transcript, a summary or both.");
  for (const [k, v] of [["transcript", input.transcript], ["summary", input.summary]] as const) if (v !== undefined && (typeof v !== "string" || v === "")) bad(ctx, `The ${k} is text.`);
  const fields: Record<string, string> = {};
  if (input.transcript !== undefined) fields.transcript = input.transcript;
  if (input.summary !== undefined) fields.summary = input.summary;
  patch(ctx, "telephony_call", str(row, "id"), fields);
  ctx.emit("call.transcript_ready", `entity/${str(row, "id")}`, { callId: str(row, "id"), ...(strOrNull(row, "contactId") ? { contactId: str(row, "contactId") } : {}) });
  return { call: callOut(liveCall(ctx, str(row, "id"))) };
}

export async function voiceToken(ctx: TelCtx, input: { numberId?: string }) {
  ensure(ctx);
  if (input.numberId !== undefined) liveNumber(ctx, isId("num", input.numberId) ? input.numberId : bad(ctx, "Number id is not valid."));
  if (ctx.principal.kind !== "person") refuse(ctx, "The softphone is for people. Agents place calls with telephony.dial.");
  const out = obj(await ctx.call("twilio.access_token", { identity: ctx.principal.id }));
  if (typeof out.token !== "string" || !Number.isSafeInteger(out.expiresAt)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return a token." });
  return { token: out.token, identity: ctx.principal.id, expiresAt: out.expiresAt };
}

