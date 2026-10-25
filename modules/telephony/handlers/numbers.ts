// Numbers and the US texting registration (spec 2.18 Calls and SMS, Call routing and recording; ARCH 8.2): list, get, search, buy, import, release, assign, route, hours, recording policy, and the
// registration draft, submit and refresh. The Space's Twilio account sits behind `twilio.*`; this module keeps the numbers the Space uses, who they ring and what happens outside hours.
// DECISION: a bought number is pointed at the Space webhooks (twilio.number.configure with no addresses) and starts with the Space default recording policy and a route that rings its assignee.
// DECISION: an imported number belongs to the person who imported it until someone assigns it (number.assigned says so); a number the Space already holds is skipped, not duplicated.
// DECISION: a released number keeps its row with state `released` so old calls and texts still name it; it no longer rings and cannot send.
// DECISION: the registration is one per Space. A draft can be saved again until it is submitted; a rejected one goes back to draft when saved. Number a2p states follow the registration.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  DEFAULT_HOURS, DEFAULT_ROUTE, E164, bad, first, isId, isInt, liveNumber, list, newId, numberByE164, numberOut, obj, pageOf, paging, parseJson, patch, refuse, rowsOf, setting, str, strOrNull, strOrUndef,
  text, ensure, validZone, keyOf,
} from "../projections.ts";
import type { HoursCfg, Json, Party, Row, RouteCfg, TelCtx } from "../projections.ts";

const RECORDING = ["off", "announce", "ask"] as const;
const ASSIGNEE = ["person", "agent", "inbox"] as const;
const CAPS = ["voice", "sms", "mms"] as const;
const recordingOk = (v: unknown): v is (typeof RECORDING)[number] => RECORDING.includes(v as never);

const live = (r: Row): boolean => r.deleted_at === null || r.deleted_at === undefined;

function assignee(ctx: TelCtx, kind: unknown, id: unknown): { kind: (typeof ASSIGNEE)[number]; id: string } {
  if (!ASSIGNEE.includes(kind as never)) bad(ctx, "A number belongs to a person, an agent or a shared inbox.");
  if (typeof id !== "string" || id === "") bad(ctx, "Name who the number belongs to.");
  const prefix = kind === "person" ? "usr" : kind === "agent" ? "agt" : "mbx";
  if (kind !== "inbox" && !isId(prefix, id)) bad(ctx, `That ${kind} id is not valid.`);
  return { kind: kind as (typeof ASSIGNEE)[number], id: id as string };
}

async function recordingDefault(ctx: TelCtx): Promise<(typeof RECORDING)[number]> {
  return setting(ctx, "telephony.recording_default", "off", recordingOk);
}

function insertNumber(ctx: TelCtx, o: { e164: string; title: string; capabilities: string[]; kind: string; assigneeId: string; recording: string; sid: string; route: RouteCfg }): string {
  const id = newId("num", ctx.now());
  ctx.db.run(
    `INSERT INTO telephony_number ("id", "e164", "title", "capabilities", "assigneeKind", "assigneeId", "route", "hours", "recording", "a2p", "state", "twilioSid", "version", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.e164, o.title, JSON.stringify(o.capabilities), o.kind, o.assigneeId, JSON.stringify(o.route), JSON.stringify(DEFAULT_HOURS), o.recording, "none", "active", o.sid, 0, ctx.now(),
  );
  return id;
}

/** The registration state the Space is in, applied to the a2p field of every number that can text. */
function a2pOf(ctx: TelCtx): "none" | "pending" | "approved" | "rejected" {
  const reg = first(ctx.db.all(`SELECT * FROM telephony_registration`));
  const s = str(reg, "state");
  return s === "approved" ? "approved" : s === "rejected" ? "rejected" : s === "submitted" || s === "in_review" ? "pending" : "none";
}

// ---- numbers

export async function numberList(ctx: TelCtx, input: { assigneeId?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  const rows = rowsOf(ctx.db.all(`SELECT * FROM telephony_number`)).filter((r) => live(r) && str(r, "state") !== "released" && (input.assigneeId === undefined || str(r, "assigneeId") === input.assigneeId));
  rows.sort((a, b) => str(a, "e164").localeCompare(str(b, "e164")));
  const p = pageOf(rows, cursor, limit);
  return { numbers: p.page.map(numberOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function numberGet(ctx: TelCtx, input: { numberId: string }) {
  ensure(ctx);
  if (!isId("num", input.numberId)) bad(ctx, "Number id is not valid.");
  return { number: numberOut(liveNumber(ctx, input.numberId)) };
}

export async function numberSearch(ctx: TelCtx, input: Json) {
  ensure(ctx);
  const out = obj(await ctx.call("twilio.number.search", input));
  return { available: list(out.available) };
}

export async function numberBuy(ctx: TelCtx, input: { e164: string; title: string; assigneeKind: string; assigneeId?: string; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  if (!E164.test(input.e164 ?? "")) bad(ctx, "The number must include the country code, like +14155550123.");
  if (typeof input.title !== "string" || input.title.trim() === "") bad(ctx, "Give the number a title.");
  const who = assignee(ctx, input.assigneeKind, input.assigneeId ?? (input.assigneeKind === "person" || input.assigneeKind === "agent" ? ctx.principal.id : ""));
  if (numberByE164(ctx, input.e164)) throw fail("validation.duplicate", ctx.trace.traceId, { message: "This Space already has that number." });
  const bought = obj(obj(await ctx.call("twilio.number.buy", { e164: input.e164, friendlyName: input.title.trim(), idempotencyKey: `${key}:buy` })).number);
  const sid = text(bought.sid);
  if (sid === "") throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the number." });
  await ctx.call("twilio.number.configure", { sid, idempotencyKey: `${key}:configure` });
  const caps = list(bought.capabilities).filter((c): c is string => typeof c === "string" && CAPS.includes(c as never));
  const route: RouteCfg = { ...DEFAULT_ROUTE, ring: ringFor(who) };
  const id = insertNumber(ctx, { e164: input.e164, title: input.title.trim(), capabilities: caps.length ? caps : ["voice", "sms"], kind: who.kind, assigneeId: who.id, recording: await recordingDefault(ctx), sid, route });
  patch(ctx, "telephony_number", id, { a2p: a2pOf(ctx) });
  ctx.emit("number.purchased", `number/${id}`, { numberId: id, e164: input.e164 });
  return { number: numberOut(liveNumber(ctx, id)) };
}

/** Who rings by default: the person or agent a number belongs to; a shared inbox rings nobody until a route says so. */
function ringFor(who: { kind: string; id: string }): Party[] {
  return who.kind === "person" || who.kind === "agent" ? [{ kind: who.kind, id: who.id }] : [];
}

export async function numberImport(ctx: TelCtx, input: { e164?: string[]; idempotencyKey: string }) {
  ensure(ctx);
  keyOf(ctx, input);
  if (input.e164 !== undefined && (!Array.isArray(input.e164) || input.e164.some((n) => !E164.test(String(n))))) bad(ctx, "Numbers must include the country code, like +14155550123.");
  const wanted = input.e164 === undefined ? null : new Set(input.e164);
  const owned = list(obj(await ctx.call("twilio.number.list_owned", {})).numbers).map(obj);
  const made: string[] = [];
  const who = { kind: ctx.principal.kind === "agent" ? "agent" : "person", id: ctx.principal.id };
  for (const n of owned) {
    const e164 = text(n.e164);
    if (!E164.test(e164) || (wanted && !wanted.has(e164)) || numberByE164(ctx, e164)) continue;
    const caps = list(n.capabilities).filter((c): c is string => typeof c === "string" && CAPS.includes(c as never));
    const id = insertNumber(ctx, {
      e164, title: strOrUndef(n.friendlyName) ?? "", capabilities: caps.length ? caps : ["voice"], kind: who.kind, assigneeId: who.id, recording: await recordingDefault(ctx), sid: text(n.sid),
      route: { ...DEFAULT_ROUTE, ring: ringFor(who) },
    });
    patch(ctx, "telephony_number", id, { a2p: a2pOf(ctx) });
    ctx.emit("number.assigned", `number/${id}`, { numberId: id, assigneeKind: who.kind, assigneeId: who.id });
    made.push(id);
  }
  return { imported: made.length, numbers: made.map((id) => numberOut(liveNumber(ctx, id))) };
}

export async function numberRelease(ctx: TelCtx, input: { numberId: string; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  if (!isId("num", input.numberId)) bad(ctx, "Number id is not valid.");
  const row = liveNumber(ctx, input.numberId);
  if (str(row, "state") === "released") return { released: true };
  const active = rowsOf(ctx.db.all(`SELECT * FROM telephony_call WHERE "numberId" = ?`, input.numberId)).filter((c) => ["ringing", "answered"].includes(str(c, "state")));
  if (active.length) refuse(ctx, "This number has a call in progress. Release it when the call ends.");
  if (strOrNull(row, "twilioSid")) await ctx.call("twilio.number.release", { sid: str(row, "twilioSid"), idempotencyKey: `${key}:release` });
  patch(ctx, "telephony_number", input.numberId, { state: "released" });
  ctx.emit("number.released", `number/${input.numberId}`, { numberId: input.numberId, e164: str(row, "e164") });
  return { released: true };
}

export async function numberAssign(ctx: TelCtx, input: { numberId: string; assigneeKind: string; assigneeId: string }) {
  ensure(ctx);
  if (!isId("num", input.numberId)) bad(ctx, "Number id is not valid.");
  const row = liveNumber(ctx, input.numberId);
  if (str(row, "state") === "released") refuse(ctx, "That number was released.");
  const who = assignee(ctx, input.assigneeKind, input.assigneeId);
  // a route that rang the old owner and nobody else follows the number to the new one
  const route = { ...DEFAULT_ROUTE, ...parseJson<Partial<RouteCfg>>(row.route, {}) };
  const rang = route.ring.length === 0 || (route.ring.length === 1 && route.ring[0]?.id === str(row, "assigneeId"));
  patch(ctx, "telephony_number", input.numberId, { assigneeKind: who.kind, assigneeId: who.id, ...(rang ? { route: JSON.stringify({ ...route, ring: ringFor(who) }) } : {}) });
  ctx.emit("number.assigned", `number/${input.numberId}`, { numberId: input.numberId, assigneeKind: who.kind, assigneeId: who.id });
  return { number: numberOut(liveNumber(ctx, input.numberId)) };
}

function party(ctx: TelCtx, v: unknown): Party {
  const p = obj(v);
  if (!["person", "agent", "group"].includes(text(p.kind))) bad(ctx, "Each person to ring is a person, an agent or a group.");
  const prefix = p.kind === "person" ? "usr" : p.kind === "agent" ? "agt" : "grp";
  if (!isId(prefix, p.id)) bad(ctx, "A person to ring has an id that is not valid.");
  return { kind: p.kind as Party["kind"], id: p.id as string };
}

export async function numberSetRoute(ctx: TelCtx, input: { numberId: string; route: RouteCfg }) {
  ensure(ctx);
  const row = liveNumber(ctx, ensureNum(ctx, input.numberId));
  const r = obj(input.route);
  if (!isInt(r.ringSeconds) || r.ringSeconds < 5 || r.ringSeconds > 120) bad(ctx, "Ringing lasts 5 to 120 seconds.");
  if (typeof r.voicemail !== "boolean" || typeof r.voicemailTranscript !== "boolean") bad(ctx, "Say whether voicemail and its transcript are on.");
  const ring = list(r.ring).map((p) => party(ctx, p));
  if (new Set(ring.map((p) => `${p.kind}:${p.id}`)).size !== ring.length) bad(ctx, "A person is listed twice.");
  patch(ctx, "telephony_number", str(row, "id"), { route: JSON.stringify({ ring, ringSeconds: r.ringSeconds, voicemail: r.voicemail, voicemailTranscript: r.voicemailTranscript }) });
  ctx.emit("number.route_changed", `number/${str(row, "id")}`, { numberId: str(row, "id"), fields: ["route"] });
  return { number: numberOut(liveNumber(ctx, str(row, "id"))) };
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export async function numberSetHours(ctx: TelCtx, input: { numberId: string; hours: HoursCfg }) {
  ensure(ctx);
  const row = liveNumber(ctx, ensureNum(ctx, input.numberId));
  const h = obj(input.hours);
  if (!validZone(h.zone)) bad(ctx, "That time zone is not known.");
  if (!["voicemail", "ring", "reject"].includes(text(h.outsideHours))) bad(ctx, "Outside hours the number goes to voicemail, rings anyway or turns callers away.");
  const weekly = list(h.weekly).map((w) => {
    const d = obj(w);
    if (!isInt(d.day) || d.day < 0 || d.day > 6) bad(ctx, "A day is 0 (Sunday) to 6 (Saturday).");
    if (!HHMM.test(text(d.start)) || !HHMM.test(text(d.end)) || text(d.start) >= text(d.end)) bad(ctx, "Hours are HH:MM, and the day ends after it starts.");
    return { day: d.day, start: text(d.start), end: text(d.end) };
  });
  patch(ctx, "telephony_number", str(row, "id"), { hours: JSON.stringify({ zone: h.zone, weekly, outsideHours: h.outsideHours }) });
  ctx.emit("number.route_changed", `number/${str(row, "id")}`, { numberId: str(row, "id"), fields: ["hours"] });
  return { number: numberOut(liveNumber(ctx, str(row, "id"))) };
}

export async function numberSetRecording(ctx: TelCtx, input: { numberId: string; recording: string }) {
  ensure(ctx);
  const row = liveNumber(ctx, ensureNum(ctx, input.numberId));
  if (!recordingOk(input.recording)) bad(ctx, "Recording is off, announced or asked for.");
  if (str(row, "recording") !== input.recording) {
    patch(ctx, "telephony_number", str(row, "id"), { recording: input.recording });
    ctx.emit("number.route_changed", `number/${str(row, "id")}`, { numberId: str(row, "id"), fields: ["recording"] });
  }
  return { number: numberOut(liveNumber(ctx, str(row, "id"))) };
}

const ensureNum = (ctx: TelCtx, id: unknown): string => (isId("num", id) ? id : bad(ctx, "Number id is not valid."));

// ---- the US texting registration

const REG_FIELDS = ["legalName", "ein", "website", "contactName", "contactEmail", "useCase", "optInDescription"] as const;

function regOut(r: Row): Json {
  const out: Json = { id: str(r, "id"), legalName: str(r, "legalName"), state: str(r, "state") };
  for (const k of REG_FIELDS) if (k !== "legalName" && strOrNull(r, k)) out[k] = str(r, k);
  const address = parseJson<Json | null>(r.address, null);
  if (address) out.address = address;
  const samples = parseJson<string[] | null>(r.sampleMessages, null);
  if (samples) out.sampleMessages = samples;
  if (strOrNull(r, "rejectedReason")) out.rejectedReason = str(r, "rejectedReason");
  if (typeof r.submittedAt === "number") out.submittedAt = r.submittedAt;
  return out;
}

const theRegistration = (ctx: TelCtx): Row | null => rowsOf(ctx.db.all(`SELECT * FROM telephony_registration`)).find(live) ?? null;

export async function registrationGet(ctx: TelCtx) {
  ensure(ctx);
  const r = theRegistration(ctx);
  return r ? { registration: regOut(r) } : {};
}

export async function registrationSave(ctx: TelCtx, input: Json) {
  ensure(ctx);
  if (typeof input.legalName !== "string" || input.legalName.trim() === "" || input.legalName.length > 200) bad(ctx, "The legal name is 1 to 200 characters.");
  if (input.ein !== undefined && !/^[0-9]{2}-?[0-9]{7}$/.test(String(input.ein))) bad(ctx, "The EIN is nine digits, like 12-3456789.");
  if (input.website !== undefined && !/^https?:\/\/\S+$/.test(String(input.website))) bad(ctx, "The website must be a web address.");
  if (input.contactEmail !== undefined && !/^[^\s@]+@[^\s@]+$/.test(String(input.contactEmail))) bad(ctx, "The contact email is not valid.");
  const samples = input.sampleMessages;
  if (samples !== undefined && (!Array.isArray(samples) || samples.length > 5 || samples.some((m) => typeof m !== "string" || m.trim() === ""))) bad(ctx, "Give up to five sample messages.");
  const addr = input.address === undefined ? undefined : obj(input.address);
  if (addr && !["line1", "city", "region", "postal", "country"].every((k) => typeof addr[k] === "string" && addr[k] !== "")) bad(ctx, "The address needs a street, city, region, postal code and country.");
  const have = theRegistration(ctx);
  if (have && ["submitted", "in_review", "approved"].includes(str(have, "state"))) refuse(ctx, "The registration was already submitted. It cannot be changed while Twilio reviews it or after approval.");
  const fields: Record<string, string | number | null> = {
    legalName: (input.legalName as string).trim(), ein: strOrUndef(input.ein) ?? null, website: strOrUndef(input.website) ?? null, contactName: strOrUndef(input.contactName) ?? null,
    contactEmail: strOrUndef(input.contactEmail) ?? null, useCase: strOrUndef(input.useCase) ?? null, optInDescription: strOrUndef(input.optInDescription) ?? null,
    address: addr ? JSON.stringify(addr) : null, sampleMessages: Array.isArray(samples) ? JSON.stringify(samples) : null, state: "draft", rejectedReason: null,
  };
  let id: string;
  if (have) {
    id = str(have, "id");
    patch(ctx, "telephony_registration", id, fields);
  } else {
    id = newId("reg", ctx.now());
    ctx.db.run(
      `INSERT INTO telephony_registration ("id", "legalName", "ein", "website", "address", "contactName", "contactEmail", "useCase", "sampleMessages", "optInDescription", "state", "version", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, fields.legalName ?? null, fields.ein ?? null, fields.website ?? null, fields.address ?? null, fields.contactName ?? null, fields.contactEmail ?? null, fields.useCase ?? null,
      fields.sampleMessages ?? null, fields.optInDescription ?? null, "draft", 0, ctx.now(),
    );
  }
  syncNumbers(ctx);
  return { registration: regOut(first(ctx.db.all(`SELECT * FROM telephony_registration WHERE id = ?`, id)) as Row) };
}

function regRow(ctx: TelCtx, id: unknown): Row {
  if (!isId("reg", id)) bad(ctx, "Registration id is not valid.");
  const r = first(ctx.db.all(`SELECT * FROM telephony_registration WHERE id = ?`, id));
  if (!r) throw fail("validation.not_found", ctx.trace.traceId, { message: "There is no such registration." });
  return r;
}

export async function registrationSubmit(ctx: TelCtx, input: { registrationId: string; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  const r = regRow(ctx, input.registrationId);
  if (str(r, "state") !== "draft") refuse(ctx, "Only a draft can be submitted.");
  const samples = parseJson<string[]>(r.sampleMessages, []);
  const address = parseJson<Json | null>(r.address, null);
  const missing = (["legalName", "ein", "website", "contactName", "contactEmail", "useCase"] as const).filter((k) => !strOrNull(r, k));
  if (!address) missing.push("address" as never);
  if (samples.length === 0) missing.push("sampleMessages" as never);
  if (missing.length) refuse(ctx, `The registration still needs: ${missing.join(", ")}.`);
  const brand = obj(await ctx.call("twilio.a2p.create_brand", {
    legalName: str(r, "legalName"), ein: str(r, "ein"), website: str(r, "website"), address, contactName: str(r, "contactName"), contactEmail: str(r, "contactEmail"), idempotencyKey: `${key}:brand`,
  }));
  const campaign = obj(await ctx.call("twilio.a2p.create_campaign", {
    brandSid: text(brand.brandSid), useCase: str(r, "useCase"), description: `${str(r, "legalName")}: ${str(r, "useCase")}`, sampleMessages: samples,
    ...(strOrNull(r, "optInDescription") ? { optInDescription: str(r, "optInDescription") } : {}), idempotencyKey: `${key}:campaign`,
  }));
  patch(ctx, "telephony_registration", str(r, "id"), { state: "submitted", submittedAt: ctx.now(), twilioBrandSid: text(brand.brandSid), twilioCampaignSid: text(campaign.campaignSid), rejectedReason: null });
  syncNumbers(ctx);
  ctx.emit("registration.submitted", `entity/${str(r, "id")}`, { registrationId: str(r, "id") });
  return { registration: regOut(regRow(ctx, str(r, "id"))) };
}

function syncNumbers(ctx: TelCtx): void {
  const a2p = a2pOf(ctx);
  for (const n of rowsOf(ctx.db.all(`SELECT * FROM telephony_number`)).filter(live)) {
    if (str(n, "state") !== "released" && str(n, "a2p") !== a2p) patch(ctx, "telephony_number", str(n, "id"), { a2p });
  }
}

export async function registrationRefresh(ctx: TelCtx, input: { registrationId: string }) {
  ensure(ctx);
  const r = regRow(ctx, input.registrationId);
  if (!strOrNull(r, "twilioBrandSid") || !strOrNull(r, "twilioCampaignSid")) refuse(ctx, "This registration was not submitted yet.");
  const st = obj(await ctx.call("twilio.a2p.status", { brandSid: str(r, "twilioBrandSid"), campaignSid: str(r, "twilioCampaignSid") }));
  const brand = text(st.brand);
  const campaign = text(st.campaign);
  let state: "in_review" | "approved" | "rejected" = "in_review";
  if (brand === "failed" || brand === "rejected" || campaign === "failed" || campaign === "rejected") state = "rejected";
  else if ((brand === "approved" || brand === "verified") && (campaign === "approved" || campaign === "verified")) state = "approved";
  if (state !== str(r, "state")) {
    patch(ctx, "telephony_registration", str(r, "id"), { state, rejectedReason: state === "rejected" ? (strOrUndef(st.rejectedReason) ?? "Twilio rejected the registration.") : null });
    syncNumbers(ctx);
    ctx.emit("registration.status_changed", `entity/${str(r, "id")}`, { registrationId: str(r, "id"), state });
  }
  return { registration: regOut(regRow(ctx, str(r, "id"))) };
}
