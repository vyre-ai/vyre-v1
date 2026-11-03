// Meetings close themselves (lane l-meetings, owner 3 Nov). When a transcript lands, the meeting owner's own Assistant prepares one close-out package: a short summary with the decisions and open
// questions, the action items as proposed tasks (owners matched to Space people, due dates when said), record updates for the attendees and their company (field changes and a meeting note), a
// follow-up email to the outside attendees in the owner's voice, and a hold for the next meeting when one was agreed. The Inbox's Meetings tab shows it; a person approves all of it or item by item.
// DECISION: the Assistant works in a task of its own (assigned to it, the brief as its first message), so its turn is placed like any private chat of the owner: on the owner's own computer when it
// is on (l-runson). It hands the package back with meetings.closeout.propose; a task it submits with the package as its outputs is read the same way (onPrepareDone).
// DECISION: nothing leaves Vyre and nothing changes until a person approves. Approving calls the capability each item names as that person: tasks.create, records.update and
// records.comments.add, mail.send (or mail.draft when the person prefers drafts) and calendar.create_event. The Gate rules each of them as usual, so a held send comes back as an approval.
// DECISION: one package per meeting. Redo asks the Assistant again; proposals that were not acted on are replaced, and a proposal for something already approved or skipped is dropped, so
// nothing is made twice (every call also carries an idempotency key built from the meeting and what the item is).
// DECISION: a person sees the close-outs of their own meetings (they brought the meeting in, meetings_watcher) and of meetings shared to a project or channel they can read; nobody else's.
// The host and an agent not acting for a person see what their own access lets them.
import { bad, codeOf, ensure, fetchMeeting, first, getState, isId, isInt, linkFor, list, missing, msOf, newId, obj, pageOf, paging, parseJson, patchMeeting, personOf, refuse, rowsOf, setState, str, strOrUndef, text } from "../projections.ts";
import type { Json, MeetCtx, Row } from "../projections.ts";

export type CloseState = "preparing" | "ready" | "closed" | "nothing";
type Stored = CloseState | "waiting";
type Kind = "task" | "record" | "email" | "hold";
type Status = "proposed" | "approved" | "skipped" | "failed";
interface Person { name: string; email?: string; recordId?: string }
interface Made { type: "task" | "record" | "comment" | "email" | "draft" | "event" | "approval"; id: string; title?: string }
interface Change { field: string; title: string; from?: string; to: string }
interface Body {
  title: string;
  assignee?: string; ownerName?: string; due?: number; why?: string;
  recordId?: string; recordType?: string; changes?: Change[]; note?: string;
  to?: Array<{ address: string; name?: string }>; subject?: string; text?: string; mailboxId?: string; send?: "send" | "draft";
  startsAt?: number; endsAt?: number;
}
interface Item { id: string; recordId: string; gen: number; idx: number; kind: Kind; status: Status; dedupe: string; body: Body; made: Made[]; error: string | null; by: string | null; at: number | null }
interface Close {
  recordId: string; owner: string; title: string; state: Stored; gen: number; taskId: string | null; agentId: string | null; summary: string | null; decisions: string[]; questions: string[];
  people: Person[]; preparedAt: number | null; updatedAt: number;
}

const KINDS: readonly Kind[] = ["task", "record", "email", "hold"];
const RECENT_MS = 14 * 86_400_000;
const BRIEF_TRANSCRIPT = 60_000;
const PUBLIC_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com"]);
/** Field types a close-out may change on a record: plain values a call can settle. People, relations, files and formulas are not changed from a transcript. */
const EDITABLE = new Set(["text", "longtext", "email", "phone", "url", "number", "currency", "percent", "choice", "status", "date", "datetime", "checkbox"]);

// ---------------------------------------------------------------- store

function closeOf(ctx: MeetCtx, recordId: string): Close | null {
  const r = first(ctx.db.all(`SELECT * FROM meetings_closeout WHERE "recordId" = ?`, recordId));
  return r ? closeRow(r) : null;
}
function closeRow(r: Row): Close {
  return {
    recordId: str(r, "recordId"), owner: str(r, "owner"), title: str(r, "title"), state: (str(r, "state") || "preparing") as Stored, gen: typeof r["gen"] === "number" ? r["gen"] : 0,
    taskId: strOrUndef(r["taskId"]) ?? null, agentId: strOrUndef(r["agentId"]) ?? null, summary: strOrUndef(r["summary"]) ?? null,
    decisions: parseJson<string[]>(r["decisions"], []), questions: parseJson<string[]>(r["questions"], []), people: parseJson<Person[]>(r["people"], []),
    preparedAt: typeof r["preparedAt"] === "number" ? r["preparedAt"] : null, updatedAt: typeof r["updatedAt"] === "number" ? r["updatedAt"] : 0,
  };
}
function saveClose(ctx: MeetCtx, c: Close): void {
  const vals = [c.owner, c.title, c.state, c.gen, c.taskId, c.agentId, c.summary, JSON.stringify(c.decisions), JSON.stringify(c.questions), JSON.stringify(c.people), c.preparedAt, c.updatedAt];
  if (first(ctx.db.all(`SELECT "recordId" FROM meetings_closeout WHERE "recordId" = ?`, c.recordId))) {
    ctx.db.run(
      `UPDATE meetings_closeout SET "owner" = ?, "title" = ?, "state" = ?, "gen" = ?, "taskId" = ?, "agentId" = ?, "summary" = ?, "decisions" = ?, "questions" = ?, "people" = ?, "preparedAt" = ?, "updatedAt" = ? WHERE "recordId" = ?`,
      ...vals, c.recordId,
    );
  } else {
    ctx.db.run(
      `INSERT INTO meetings_closeout ("owner", "title", "state", "gen", "taskId", "agentId", "summary", "decisions", "questions", "people", "preparedAt", "updatedAt", "recordId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...vals, c.recordId,
    );
  }
}

function itemsOf(ctx: MeetCtx, recordId: string): Item[] {
  return rowsOf(ctx.db.all(`SELECT * FROM meetings_item WHERE "recordId" = ?`, recordId)).map((r) => ({
    id: str(r, "id"), recordId: str(r, "recordId"), gen: typeof r["gen"] === "number" ? r["gen"] : 0, idx: typeof r["idx"] === "number" ? r["idx"] : 0, kind: str(r, "kind") as Kind,
    status: str(r, "status") as Status, dedupe: str(r, "dedupe"), body: parseJson<Body>(r["body"], { title: "" }), made: parseJson<Made[]>(r["made"], []),
    error: strOrUndef(r["error"]) ?? null, by: strOrUndef(r["by"]) ?? null, at: typeof r["at"] === "number" ? r["at"] : null,
  })).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.idx - b.idx || a.id.localeCompare(b.id));
}
function saveItem(ctx: MeetCtx, it: Item): void {
  ctx.db.run(
    `UPDATE meetings_item SET "status" = ?, "body" = ?, "made" = ?, "error" = ?, "by" = ?, "at" = ? WHERE "id" = ?`,
    it.status, JSON.stringify(it.body), it.made.length ? JSON.stringify(it.made) : null, it.error, it.by, it.at, it.id,
  );
}

/** The state the Meetings tab shows: waiting for the Assistant is preparing too. */
const shown = (s: Stored): CloseState => (s === "waiting" ? "preparing" : s);
/** What the items say about the package: something to approve, all of it handled, or nothing proposed at all. */
function stateOf(items: readonly Item[]): CloseState {
  if (items.some((i) => i.status === "proposed" || i.status === "failed")) return "ready";
  return items.length > 0 ? "closed" : "nothing";
}

// ---------------------------------------------------------------- who sees what

const watchersOf = (ctx: MeetCtx, recordId: string): string[] => rowsOf(ctx.db.all(`SELECT * FROM meetings_watcher WHERE "recordId" = ?`, recordId)).map((r) => str(r, "personId")).filter(Boolean);
const sharesOf = (ctx: MeetCtx, recordId: string): Array<{ type: "project" | "channel"; id: string }> =>
  rowsOf(ctx.db.all(`SELECT * FROM meetings_share WHERE "recordId" = ?`, recordId)).map((r) => ({ type: str(r, "kind") as "project" | "channel", id: str(r, "targetId") })).sort((a, b) => a.id.localeCompare(b.id));

/**
 * May the caller open this meeting's close-out: their own meeting, or one shared to a project or channel they can read. An agent acting for a person is that person here; an agent acting for
 * nobody opens only the close-out it was asked to prepare (another person's meetings never reach an agent's chat through it). The host opens any.
 */
function canOpen(ctx: MeetCtx, recordId: string): boolean {
  const me = personOf(ctx);
  if (me === null) return ctx.principal.kind === "agent" ? closeOf(ctx, recordId)?.agentId === ctx.principal.id : true;
  if (watchersOf(ctx, recordId).includes(me)) return true;
  if (!ctx.authorize) return false;
  return sharesOf(ctx, recordId).some((s) => {
    try { return ctx.authorize!({ perm: null, level: "view" }, { type: s.type, id: s.id }).effect === "allow"; } catch { return false; }
  });
}

/** The meeting, when the caller may open its close-out; the same answer as for one that is not there otherwise (what exists is not leaked). */
async function meetingFor(ctx: MeetCtx, recordId: string) {
  if (!isId("rec", recordId)) bad(ctx, "Meeting id is not valid.");
  if (!canOpen(ctx, recordId)) return missing(ctx, "That meeting is not in this Space.");
  return fetchMeeting(ctx, recordId);
}

/** The person a meeting's close-out is for: its organizer when that is a person here, else whoever brought it in first. */
function ownerOf(ctx: MeetCtx, fields: Json, recordId: string): string | null {
  const org = text(fields["organizer"]);
  if (/^usr_[a-z0-9]+$/.test(org)) return org;
  return watchersOf(ctx, recordId)[0] ?? personOf(ctx);
}

/** The person's Assistant: remembered once the person has been here, else looked up when the caller is that person (the host sees nobody's Assistant). */
async function assistantFor(ctx: MeetCtx, person: string): Promise<string | null> {
  const known = getState(ctx, `assistant:${person}`);
  if (known) return known;
  if (personOf(ctx) !== person) return null;
  try {
    const mine = list(obj(await ctx.call("agents.list", { section: "personal", limit: 100 }))["agents"]).map(obj).filter((a) => text(a["ownerId"]) === person);
    const id = text((mine.find((a) => a["kind"] === "assistant") ?? mine[0])?.["agentId"]);
    if (!isId("agt", id)) return null;
    setState(ctx, `assistant:${person}`, id);
    return id;
  } catch {
    return null;
  }
}

/** The addresses the person sends from, remembered when they are here: a follow-up never goes back to them or to colleagues on their own domain. */
async function ownAddresses(ctx: MeetCtx, person: string): Promise<string[]> {
  const known = getState(ctx, `addresses:${person}`);
  if (known) return parseJson<string[]>(known, []);
  if (personOf(ctx) !== person) return [];
  try {
    const got = list(obj(await ctx.call("comms.senders.list", { channel: "email" }))["senders"]).map(obj).filter((s) => s["scope"] === "mine").map((s) => text(s["address"]).toLowerCase()).filter((a) => a.includes("@"));
    setState(ctx, `addresses:${person}`, JSON.stringify(got));
    return got;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- the people and records of a meeting

interface Related { recordId: string; type: "contact" | "company"; name: string; email?: string; fields: Json }

const ids = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string" && isId("rec", x));

async function recordOf(ctx: MeetCtx, type: string, recordId: string): Promise<Json | null> {
  try {
    const r = obj(obj(await ctx.call("records.get", { type, recordId })).record);
    return r["deletedAt"] !== undefined && r["deletedAt"] !== null ? null : obj(r["fields"]);
  } catch {
    return null;   // a record the caller may not read, or one that is gone: left out
  }
}

/** The attendees' contact records and their companies: the records a close-out may update. */
async function relatedOf(ctx: MeetCtx, fields: Json): Promise<Related[]> {
  const out: Related[] = [];
  for (const id of ids(fields["attendees"])) {
    const f = await recordOf(ctx, "contact", id);
    if (!f) continue;
    out.push({ recordId: id, type: "contact", name: text(f["name"]) || text(f["email"]) || "Contact", ...(text(f["email"]) ? { email: text(f["email"]).toLowerCase() } : {}), fields: f });
    for (const cid of ids(f["company"])) {
      if (out.some((r) => r.recordId === cid)) continue;
      const c = await recordOf(ctx, "company", cid);
      if (c) out.push({ recordId: cid, type: "company", name: text(c["name"]) || "Company", fields: c });
    }
  }
  return out;
}

const nameFromAddress = (a: string): string => {
  const local = a.split("@")[0] ?? a;
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || a;
};

/** Everyone on the call: the contact's name where a record names them, else a name made from the address. */
function peopleOf(emails: readonly string[], related: readonly Related[]): Person[] {
  const out: Person[] = [];
  for (const e of emails) {
    const r = related.find((x) => x.email === e);
    out.push(r ? { name: r.name, email: e, recordId: r.recordId } : { name: nameFromAddress(e), email: e });
  }
  for (const r of related) if (r.type === "contact" && !out.some((p) => p.recordId === r.recordId)) out.push({ name: r.name, ...(r.email ? { email: r.email } : {}), recordId: r.recordId });
  return out;
}

/** The outside attendees a follow-up goes to: anyone with a contact record, and anyone not on the owner's own addresses or (a company) domain. */
function outsiders(people: readonly Person[], own: readonly string[]): Array<{ address: string; name?: string }> {
  const domains = new Set(own.map((a) => a.split("@")[1] ?? "").filter((d) => d && !PUBLIC_MAIL.has(d)));
  return people.filter((p) => p.email && (p.recordId || (own.length > 0 && !own.includes(p.email) && !domains.has(p.email.split("@")[1] ?? "")))).map((p) => ({ address: p.email as string, name: p.name }));
}

interface FieldDef { key: string; type: string; title: string; options?: Json }
async function editableFields(ctx: MeetCtx, type: string): Promise<FieldDef[]> {
  try {
    const t = list(obj(await ctx.call("schema.describe", { type }))["types"]).map(obj).find((x) => x["key"] === type);
    return list(t?.["fields"]).map(obj).map((f) => ({ key: text(f["key"]), type: text(f["type"]), title: text(f["title"]) || text(f["key"]), ...(f["options"] ? { options: obj(f["options"]) } : {}), label: text(f["label"]) }))
      .filter((f) => f.key && EDITABLE.has(f.type) && !f.key.startsWith("pref_") && f.label !== "restricted").map(({ label: _l, ...f }) => f);
  } catch {
    return [];
  }
}

const shownValue = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const optionsOf = (f: FieldDef): Array<{ key: string; title: string }> => list(f.options?.["choices"] ?? f.options?.["stages"]).map(obj).map((o) => ({ key: text(o["key"]), title: text(o["title"]) })).filter((o) => o.key);

/** A value from the transcript, as the field stores it; undefined when it does not fit the field. */
function valueFor(f: FieldDef, raw: string): string | number | boolean | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (f.type === "choice" || f.type === "status") {
    const o = optionsOf(f).find((x) => x.key === v || x.title.toLowerCase() === v.toLowerCase());
    return o?.key;
  }
  if (f.type === "number" || f.type === "currency" || f.type === "percent") { const n = Number(v.replace(/[,$%\s]/g, "")); return Number.isFinite(n) ? n : undefined; }
  if (f.type === "checkbox") return /^(yes|true|1)$/i.test(v) ? true : /^(no|false|0)$/i.test(v) ? false : undefined;
  if (f.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  if (f.type === "datetime") { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : undefined; }
  if (f.type === "email") return /^[^\s@]+@[^\s@]+$/.test(v) ? v.toLowerCase() : undefined;
  return v.slice(0, 2000);
}

// ---------------------------------------------------------------- the brief

const when = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function spacePeople(ctx: MeetCtx): Promise<Array<{ id: string; name: string }>> {
  try {
    return list(obj(await ctx.call("access.principals.list", { kind: "person", status: "active", limit: 500 }))["principals"]).map(obj).map((p) => ({ id: text(p["id"]), name: text(p["name"]) })).filter((p) => p.id && p.name);
  } catch {
    return [];
  }
}

function briefOf(o: { meetingId: string; title: string; startsAt: number; endsAt: number | null; people: Person[]; related: Related[]; fields: Map<string, FieldDef[]>; team: Array<{ id: string; name: string }>; ownerName: string; outside: Array<{ address: string; name?: string }>; transcript: string }): string {
  const lines: string[] = [];
  lines.push(`Close out the meeting "${o.title}" (${when(o.startsAt)}${o.endsAt ? `, ${Math.max(1, Math.round((o.endsAt - o.startsAt) / 60_000))} minutes` : ""}) for ${o.ownerName}.`, "");
  lines.push("People on the call:");
  for (const p of o.people) lines.push(`- ${p.name}${p.email ? ` <${p.email}>` : ""}${p.recordId ? ` (contact ${p.recordId})` : ""}`);
  if (o.related.length) {
    lines.push("", "Records you may update (field key: current value):");
    for (const r of o.related) {
      const fs = o.fields.get(r.type) ?? [];
      lines.push(`- ${r.name}, ${r.type} ${r.recordId}: ${fs.map((f) => `${f.key}${optionsOf(f).length ? ` [${optionsOf(f).map((x) => x.key).join("|")}]` : ""}: ${JSON.stringify(shownValue(r.fields[f.key]))}`).join(", ") || "no fields to change"}`);
    }
  }
  if (o.team.length) lines.push("", `People in this Space who can own a task: ${o.team.map((p) => p.name).join(", ")}.`);
  lines.push(
    "",
    `Read the transcript below${o.transcript.length > BRIEF_TRANSCRIPT ? ` (it is cut short here: read all of it with meetings.transcript.get, meetingId ${o.meetingId})` : ""}. Then call meetings.closeout.propose once with:`,
    `- meetingId: ${o.meetingId}`,
    "- summary: three to five plain sentences.",
    "- decisions: what was decided, one line each. questions: what is still open, one line each.",
    "- actions: each thing someone said they would do. title starts with a verb; owner is their name as said; due is YYYY-MM-DD only when a date was said; why is one line.",
    "- records: for the records above, only the fields the call gave a new value for (field key and value), and a short note about this meeting for the record.",
    o.outside.length ? `- email: the follow-up to ${o.outside.map((x) => x.name ?? x.address).join(", ")}, in ${o.ownerName}'s voice: thanks, what was decided, who does what, the next step. Plain text, short, signed with ${o.ownerName.split(" ")[0]}.` : "- email: leave it out (nobody from outside was on the call).",
    "- next: only when a next meeting was agreed: startsAt (ISO 8601 with its offset), minutes, title.",
    `Leave out anything that was not said. Nothing is sent or changed until ${o.ownerName} approves it. When propose answers, submit this task.`,
    "", "Transcript:", clip(o.transcript, BRIEF_TRANSCRIPT),
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------- meetings.closeout.prepare

/** Start (or redo) the close-out of a meeting. `system`: the transcript consumer, which skips quietly what a person would be told about. */
async function prepareCore(ctx: MeetCtx, meetingId: string, redo: boolean, system: boolean): Promise<{ meetingId: string; state: CloseState; taskId?: string } | null> {
  ensure(ctx);
  if (system && !canOpen(ctx, meetingId)) return null;
  const rec = await meetingFor(ctx, meetingId);
  const transcript = text(rec.fields["transcript"]);
  if (!transcript) return system ? null : refuse(ctx, "There is no transcript of this meeting yet, so there is nothing to close out.");
  const had = closeOf(ctx, meetingId);
  if (had && had.state !== "waiting" && !redo) return { meetingId, state: shown(had.state), ...(had.taskId ? { taskId: had.taskId } : {}) };
  const owner = had?.owner || ownerOf(ctx, rec.fields, meetingId);
  if (!owner) return system ? null : refuse(ctx, "This meeting belongs to nobody yet, so there is no Assistant to close it out.");
  const link = linkFor(ctx, meetingId);
  const title = text(rec.fields["title"]) || "Meeting";
  const startsAt = msOf(rec.fields["starts_at"]) ?? link?.startsAt ?? ctx.now();
  const endsAt = msOf(rec.fields["ends_at"]) ?? link?.endsAt ?? null;
  const related = await relatedOf(ctx, rec.fields);
  const people = peopleOf(link?.emails ?? [], related);
  const agentId = await assistantFor(ctx, owner);
  const base: Close = had ?? { recordId: meetingId, owner, title, state: "waiting", gen: 0, taskId: null, agentId: null, summary: null, decisions: [], questions: [], people, preparedAt: null, updatedAt: ctx.now() };
  if (!agentId) {
    // nobody knows the owner's Assistant yet (the host cannot look it up): the meeting waits, and the owner's next visit to the Meetings tab starts it
    saveClose(ctx, { ...base, owner, title, people, state: base.state === "waiting" ? "waiting" : base.state, updatedAt: ctx.now() });
    return { meetingId, state: shown(base.state === "waiting" ? "waiting" : base.state) };
  }
  const own = await ownAddresses(ctx, owner);
  const team = await spacePeople(ctx);
  const fields = new Map<string, FieldDef[]>();
  for (const type of new Set(related.map((r) => r.type))) fields.set(type, await editableFields(ctx, type));
  const ownerName = team.find((p) => p.id === owner)?.name ?? "the owner";
  const gen = base.gen + 1;
  const brief = briefOf({ meetingId, title, startsAt, endsAt, people, related, fields, team, ownerName, outside: outsiders(people, own), transcript });
  const key = `meeting:closeout:${meetingId}:${gen}`;
  const made = obj(obj(await ctx.call("tasks.create", {
    kind: "work", title: clip(`Close out ${title}`, 90), summary: `Prepare the close-out of ${title}: summary, tasks, record updates, the follow-up and the next meeting.`,
    assigned: { kind: "agent", id: agentId }, recordId: meetingId, source: { kind: "meeting", id: meetingId },
    notes: { brief, "meeting.closeout": meetingId, "meeting.gen": String(gen), "baton.owner": owner }, idempotencyKey: key,
  })).task);
  const taskId = text(made["id"]);
  const threadId = text(made["threadId"]);
  if (threadId) {
    // the brief is the first thing in the task's thread; the Assistant works without asking first (nothing it does leaves Vyre: the package waits for the owner)
    try { await ctx.call("threads.set_mode", { threadId, mode: "auto" }); } catch { /* the task goes on without it */ }
    try { await ctx.call("chat.post", { threadId, body: brief, idempotencyKey: `${key}:brief` }); } catch { /* the brief is in the task's notes too */ }
  }
  saveClose(ctx, { ...base, owner, title, people, state: had && had.state !== "waiting" && had.state !== "preparing" ? had.state : "preparing", gen, taskId: isId("tsk", taskId) ? taskId : null, agentId, updatedAt: ctx.now() });
  return { meetingId, state: had && had.state !== "waiting" && had.state !== "preparing" ? shown(had.state) : "preparing", ...(isId("tsk", taskId) ? { taskId } : {}) };
}

export async function closeoutPrepare(ctx: MeetCtx, input: { meetingId: string; redo?: boolean }) {
  if (input.redo !== undefined && typeof input.redo !== "boolean") bad(ctx, "redo is true or false.");
  return (await prepareCore(ctx, input.meetingId, input.redo === true, false)) as { meetingId: string; state: CloseState; taskId?: string };
}

/** The Meetings tab opening: each of the person's recent meetings with a transcript and no close-out yet starts one. */
export async function closeoutSync(ctx: MeetCtx, _input: Record<string, never>) {
  ensure(ctx);
  const me = personOf(ctx);
  if (!me) return { started: 0 };
  await assistantFor(ctx, me);
  await ownAddresses(ctx, me);
  let started = 0;
  const mine = rowsOf(ctx.db.all(`SELECT * FROM meetings_watcher WHERE "personId" = ?`, me)).map((r) => str(r, "recordId"));
  for (const id of mine) {
    const had = closeOf(ctx, id);
    if (had && had.state !== "waiting") continue;
    const l = linkFor(ctx, id);
    if (!had && (!l || l.startsAt < ctx.now() - RECENT_MS)) continue;
    try {
      const out = await prepareCore(ctx, id, false, true);
      if (out?.taskId) started++;
    } catch (e) {
      ctx.log.warn("meeting close-out could not start", { meetingId: id, code: codeOf(e) });
    }
  }
  return { started };
}

/** The consumer of meeting.transcript_ready: the close-out starts by itself. */
export async function onTranscriptReady(ctx: MeetCtx, event: { payload?: unknown }): Promise<void> {
  const meetingId = text(obj(event.payload)["meetingId"]);
  if (!isId("rec", meetingId)) return;
  try {
    await prepareCore(ctx, meetingId, false, true);
  } catch (e) {
    if (codeOf(e) === "validation.not_found") return;   // the meeting went away
    throw e;
  }
}

// ---------------------------------------------------------------- meetings.closeout.propose

interface ProposeIn {
  meetingId: string; summary: string; decisions?: unknown[]; questions?: unknown[];
  actions?: unknown[]; records?: unknown[]; email?: unknown; next?: unknown;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const strings = (v: unknown, max: number): string[] => list(v).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, max).map((x) => clip(x, 500));

/** A date said on the call (YYYY-MM-DD, or a full time) as the end of that working day. */
function dueOf(v: unknown): number | undefined {
  const s = text(v).trim();
  if (!s) return undefined;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T17:00:00Z` : s);
  return Number.isFinite(t) && t > 0 ? t : undefined;
}

/** Who said they would do it, as a person of this Space: by full name, first name or address; nobody when it is not clear. */
function matchPerson(said: string, team: ReadonlyArray<{ id: string; name: string }>): string | undefined {
  const s = norm(said);
  if (!s) return undefined;
  const full = team.filter((p) => norm(p.name) === s);
  if (full.length === 1) return full[0]!.id;
  const firstName = team.filter((p) => norm(p.name).split(" ")[0] === s.split(" ")[0] && s.split(" ").length === 1);
  return firstName.length === 1 ? firstName[0]!.id : undefined;
}

async function proposeCore(ctx: MeetCtx, input: ProposeIn): Promise<{ meetingId: string; state: CloseState; items: number }> {
  ensure(ctx);
  const rec = await meetingFor(ctx, input.meetingId);
  if (typeof input.summary !== "string") bad(ctx, "The summary is text.");
  const had = closeOf(ctx, input.meetingId);
  const owner = had?.owner || ownerOf(ctx, rec.fields, input.meetingId);
  if (!owner) return refuse(ctx, "This meeting belongs to nobody yet.");
  // the owner's Assistant, the owner, someone the meeting is shared with, or the host may hand in the package; any other agent may not
  if (ctx.principal.kind === "agent" && had?.agentId && ctx.principal.id !== had.agentId && !ctx.actingFor) refuse(ctx, "Only the Assistant that was asked prepares this close-out.");
  const link = linkFor(ctx, input.meetingId);
  const title = text(rec.fields["title"]) || "Meeting";
  const related = await relatedOf(ctx, rec.fields);
  const people = had?.people.length ? had.people : peopleOf(link?.emails ?? [], related);
  const team = await spacePeople(ctx);
  const own = await ownAddresses(ctx, owner);
  const pref = getState(ctx, `email_mode:${owner}`) === "draft" ? "draft" : "send";
  const summary = clip(input.summary.trim(), 4000);
  const proposals: Array<{ kind: Kind; dedupe: string; body: Body }> = [];

  for (const a of list(input.actions).map(obj).slice(0, 30)) {
    const t = clip(text(a["title"]).trim(), 300);
    if (!t) continue;
    const said = text(a["owner"]).trim();
    const assignee = matchPerson(said, team) ?? owner;
    const due = dueOf(a["due"]);
    proposals.push({ kind: "task", dedupe: `task:${norm(t)}`, body: { title: t, assignee, ...(said ? { ownerName: said } : {}), ...(due ? { due } : {}), ...(text(a["why"]).trim() ? { why: clip(text(a["why"]).trim(), 1000) } : {}) } });
  }

  const fieldsByType = new Map<string, FieldDef[]>();
  const asked = new Map(list(input.records).map(obj).filter((r) => isId("rec", r["recordId"])).map((r) => [text(r["recordId"]), r] as const));
  for (const r of related) {
    const a = asked.get(r.recordId);
    if (!a && r.type !== "contact") continue;   // an attendee always gets the meeting note; a company only when the Assistant had something for it
    if (!fieldsByType.has(r.type)) fieldsByType.set(r.type, await editableFields(ctx, r.type));
    const defs = fieldsByType.get(r.type) ?? [];
    const changes: Change[] = [];
    for (const c of list(a?.["changes"]).map(obj).slice(0, 20)) {
      const f = defs.find((d) => d.key === text(c["field"]));
      if (!f || changes.some((x) => x.field === f.key)) continue;
      const v = valueFor(f, text(c["value"]));
      if (v === undefined || shownValue(v) === shownValue(r.fields[f.key])) continue;
      const opt = optionsOf(f).find((o) => o.key === v);
      changes.push({ field: f.key, title: f.title, ...(shownValue(r.fields[f.key]) ? { from: shownValue(r.fields[f.key]) } : {}), to: opt ? opt.title : shownValue(v) });
    }
    const note = clip(text(a?.["note"]).trim() || `${title}, ${new Date(link?.startsAt ?? ctx.now()).toISOString().slice(0, 10)}: ${summary}`, 4000);
    proposals.push({ kind: "record", dedupe: `record:${r.recordId}`, body: { title: r.name, recordId: r.recordId, recordType: r.type, changes, note } });
  }

  const mail = obj(input.email);
  const to = outsiders(people, own);
  if (text(mail["subject"]).trim() && text(mail["text"]).trim() && to.length) {
    proposals.push({ kind: "email", dedupe: "email", body: { title: clip(text(mail["subject"]).trim(), 300), subject: clip(text(mail["subject"]).trim(), 300), text: clip(text(mail["text"]).trim(), 20000), to, send: pref } });
  }

  const next = obj(input.next);
  const at = Date.parse(text(next["startsAt"]));
  if (Number.isFinite(at) && at > ctx.now()) {
    const minutes = isInt(next["minutes"]) && (next["minutes"] as number) >= 5 ? Math.min(600, next["minutes"] as number) : link?.endsAt ? Math.max(15, Math.round((link.endsAt - link.startsAt) / 60_000)) : 30;
    const t = clip(text(next["title"]).trim() || title, 300);
    proposals.push({ kind: "hold", dedupe: "hold", body: { title: t, startsAt: at, endsAt: at + minutes * 60_000 } });
  }

  // a redo replaces what was not acted on and never proposes again what was approved or skipped
  const old = itemsOf(ctx, input.meetingId);
  const handled = new Set(old.filter((i) => i.status === "approved" || i.status === "skipped").map((i) => i.dedupe));
  const fresh = proposals.filter((p, i) => !handled.has(p.dedupe) && proposals.findIndex((q) => q.dedupe === p.dedupe) === i);
  const gen = Math.max(had?.gen ?? 0, 1);
  for (const i of old) if (i.status === "proposed" || i.status === "failed") ctx.db.run(`DELETE FROM meetings_item WHERE "id" = ?`, i.id);
  fresh.forEach((p, idx) => ctx.db.run(
    `INSERT INTO meetings_item ("id", "recordId", "gen", "idx", "kind", "status", "dedupe", "body", "made", "error", "by", "at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("mci", ctx.now() + idx), input.meetingId, gen, idx, p.kind, "proposed", p.dedupe, JSON.stringify(p.body), null, null, null, null,
  ));
  const now = itemsOf(ctx, input.meetingId);
  const state = stateOf(now);
  saveClose(ctx, {
    ...(had ?? { recordId: input.meetingId, owner, title, taskId: null, agentId: ctx.principal.kind === "agent" ? ctx.principal.id : null, preparedAt: null, updatedAt: 0 }),
    owner, title, state, gen, summary: summary || null, decisions: strings(input.decisions, 30), questions: strings(input.questions, 30), people, preparedAt: ctx.now(), updatedAt: ctx.now(),
  } as Close);
  // the summary and decisions go on the meeting too, unless a person already wrote one there
  if (summary && !text(rec.fields["summary"])) {
    await patchMeeting(ctx, input.meetingId, { summary, ...(strings(input.decisions, 30).length && !text(rec.fields["decisions"]) ? { decisions: strings(input.decisions, 30).map((d) => `- ${d}`).join("\n") } : {}) });
    ctx.emit("meeting.summary_ready", `record/${input.meetingId}`, { meetingId: input.meetingId, ...(ctx.principal.kind === "agent" ? { byAgent: ctx.principal.id } : {}) });
  }
  const proposed = now.filter((i) => i.status === "proposed").length;
  ctx.emit("meeting.closeout_ready", `record/${input.meetingId}`, { meetingId: input.meetingId, items: proposed });
  return { meetingId: input.meetingId, state, items: proposed };
}

export async function closeoutPropose(ctx: MeetCtx, input: ProposeIn) {
  return proposeCore(ctx, input);
}

/** The consumer of task.completed: an Assistant that submitted its close-out task with the package as its outputs, instead of calling propose, still hands it in. */
export async function onPrepareDone(ctx: MeetCtx, event: { payload?: unknown }): Promise<void> {
  const p = obj(event.payload);
  const src = obj(p["source"]);
  if (src["kind"] !== "meeting" || !isId("rec", src["id"])) return;
  ensure(ctx);
  const c = closeOf(ctx, text(src["id"]));
  if (!c || c.taskId !== text(p["taskId"]) || c.state !== "preparing") return;
  const task = obj(obj(await ctx.call("tasks.get", { taskId: c.taskId })).task);
  const outputs = parseJson<Json>(text(obj(task["workingNotes"])["outputs"]), {});
  if (typeof outputs["summary"] !== "string") {
    // done without a package: say so in the tab rather than preparing for ever
    saveClose(ctx, { ...c, state: stateOf(itemsOf(ctx, c.recordId)), updatedAt: ctx.now() });
    return;
  }
  await proposeCore(ctx, {
    meetingId: c.recordId, summary: outputs["summary"] as string, decisions: list(outputs["decisions"]), questions: list(outputs["questions"]), actions: list(outputs["actions"]), records: list(outputs["records"]),
    ...(outputs["email"] !== undefined ? { email: outputs["email"] } : {}), ...(outputs["next"] !== undefined ? { next: outputs["next"] } : {}),
  });
}

// ---------------------------------------------------------------- reads

function itemOut(i: Item): Json {
  const b = i.body;
  return {
    itemId: i.id, kind: i.kind, status: i.status, title: b.title,
    ...(b.assignee ? { assignee: b.assignee } : {}), ...(b.ownerName ? { ownerName: b.ownerName } : {}), ...(b.due !== undefined ? { due: b.due } : {}), ...(b.why ? { why: b.why } : {}),
    ...(b.recordId ? { recordId: b.recordId } : {}), ...(b.recordType ? { recordType: b.recordType } : {}), ...(b.changes ? { changes: b.changes } : {}), ...(b.note ? { note: b.note } : {}),
    ...(b.to ? { to: b.to } : {}), ...(b.subject ? { subject: b.subject } : {}), ...(b.text ? { text: b.text } : {}), ...(b.mailboxId ? { mailboxId: b.mailboxId } : {}), ...(b.send ? { send: b.send } : {}),
    ...(b.startsAt !== undefined ? { startsAt: b.startsAt } : {}), ...(b.endsAt !== undefined ? { endsAt: b.endsAt } : {}),
    ...(i.made.length ? { made: i.made } : {}), ...(i.error ? { error: i.error } : {}),
  };
}

export async function closeoutGet(ctx: MeetCtx, input: { meetingId: string }) {
  ensure(ctx);
  const rec = await meetingFor(ctx, input.meetingId);
  const c = closeOf(ctx, input.meetingId);
  const link = linkFor(ctx, input.meetingId);
  const items = itemsOf(ctx, input.meetingId);
  const people = c?.people.length ? c.people : peopleOf(link?.emails ?? [], []);
  const endsAt = msOf(rec.fields["ends_at"]) ?? link?.endsAt ?? undefined;
  return {
    meetingId: input.meetingId, title: text(rec.fields["title"]) || c?.title || "Meeting", startsAt: msOf(rec.fields["starts_at"]) ?? link?.startsAt ?? 0, ...(endsAt !== undefined && endsAt !== null ? { endsAt } : {}),
    attendees: people.map((p) => ({ name: p.name, ...(p.email ? { email: p.email } : {}), ...(p.recordId ? { recordId: p.recordId } : {}) })),
    state: c ? shown(c.state) : text(rec.fields["transcript"]) ? "preparing" : "nothing",
    ...(c?.summary ? { summary: c.summary } : {}), decisions: c?.decisions ?? [], questions: c?.questions ?? [], items: items.map(itemOut),
    ...(c?.preparedAt ? { preparedAt: c.preparedAt } : {}), ...(c?.taskId ? { taskId: c.taskId } : {}), ...(c?.agentId ? { agentId: c.agentId } : {}), shared: sharesOf(ctx, input.meetingId),
  };
}

export async function closeoutList(ctx: MeetCtx, input: { state?: string; recordId?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  if (input.state !== undefined && !["preparing", "ready", "closed", "nothing"].includes(input.state)) bad(ctx, "That state is not known.");
  if (input.recordId !== undefined && !isId("rec", input.recordId)) bad(ctx, "The record id is not valid.");
  const all = rowsOf(ctx.db.all(`SELECT * FROM meetings_closeout`)).map(closeRow).filter((c) => canOpen(ctx, c.recordId));
  const rows: Json[] = [];
  let ready = 0;
  for (const c of all) {
    const l = linkFor(ctx, c.recordId);
    const items = itemsOf(ctx, c.recordId);
    const state = shown(c.state);
    if (state === "ready") ready++;
    if (input.state !== undefined && state !== input.state) continue;
    if (input.recordId !== undefined && !c.people.some((p) => p.recordId === input.recordId) && !items.some((i) => i.body.recordId === input.recordId)) continue;
    rows.push({
      meetingId: c.recordId, title: c.title || "Meeting", startsAt: l?.startsAt ?? c.updatedAt, ...(l?.endsAt ? { endsAt: l.endsAt } : {}), attendees: c.people.map((p) => p.name), state,
      proposed: items.filter((i) => i.status === "proposed" || i.status === "failed").length, done: items.filter((i) => i.status === "approved").length,
    });
  }
  rows.sort((a, b) => (b["startsAt"] as number) - (a["startsAt"] as number) || text(a["meetingId"]).localeCompare(text(b["meetingId"])));
  const p = pageOf(rows, cursor, limit);
  return { meetings: p.page, ready, ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---------------------------------------------------------------- edit and skip

interface EditIn {
  meetingId: string; itemId: string; title?: string; assignee?: string; due?: number | null; why?: string; changes?: unknown[]; note?: string;
  to?: unknown[]; subject?: string; text?: string; send?: string; startsAt?: number; endsAt?: number;
}

async function openItem(ctx: MeetCtx, meetingId: string, itemId: string): Promise<{ c: Close; it: Item }> {
  ensure(ctx);
  await meetingFor(ctx, meetingId);
  const c = closeOf(ctx, meetingId);
  const it = itemsOf(ctx, meetingId).find((i) => i.id === itemId);
  if (!c || !it) return missing(ctx, "That close-out item is not there.");
  return { c, it };
}

export async function closeoutEdit(ctx: MeetCtx, input: EditIn) {
  const { it } = await openItem(ctx, input.meetingId, input.itemId);
  if (it.status !== "proposed" && it.status !== "failed") refuse(ctx, "That item was already handled, so it cannot change.");
  const b: Body = { ...it.body };
  if (input.title !== undefined) { if (typeof input.title !== "string" || !input.title.trim()) bad(ctx, "The title is 1 to 300 characters."); b.title = input.title.trim().slice(0, 300); if (it.kind === "email") b.subject = b.title; }
  if (input.assignee !== undefined) { if (it.kind !== "task" || !/^usr_[a-z0-9]+$/.test(input.assignee)) bad(ctx, "A task is assigned to a person."); b.assignee = input.assignee; }
  if (input.due !== undefined) { if (it.kind !== "task" || (input.due !== null && !isInt(input.due))) bad(ctx, "A due date is a time on a task."); if (input.due === null) delete b.due; else b.due = input.due; }
  if (input.why !== undefined) b.why = String(input.why).slice(0, 1000);
  if (input.note !== undefined) { if (it.kind !== "record") bad(ctx, "A note belongs to a record update."); b.note = String(input.note).slice(0, 4000); }
  if (input.changes !== undefined) {
    if (it.kind !== "record") bad(ctx, "Field changes belong to a record update.");
    const next: Change[] = [];
    for (const c of b.changes ?? []) {
      const e = list(input.changes).map(obj).find((x) => x["field"] === c.field);
      if (!e) { next.push(c); continue; }
      const to = text(e["to"]).trim();
      if (to) next.push({ ...c, to: to.slice(0, 2000) });
    }
    for (const e of list(input.changes).map(obj)) if (!(b.changes ?? []).some((c) => c.field === e["field"])) bad(ctx, "Only a proposed field can be changed here.");
    b.changes = next;
  }
  if (input.to !== undefined) {
    if (it.kind !== "email") bad(ctx, "Recipients belong to the email.");
    const to = list(input.to).map(obj).map((r) => ({ address: text(r["address"]).trim().toLowerCase(), ...(text(r["name"]) ? { name: text(r["name"]) } : {}) }));
    if (!to.length || to.some((r) => !/^[^\s@]+@[^\s@]+$/.test(r.address))) bad(ctx, "Each recipient needs an email address.");
    b.to = to;
  }
  if (input.subject !== undefined) { if (it.kind !== "email" || !input.subject.trim()) bad(ctx, "The email needs a subject."); b.subject = input.subject.trim().slice(0, 300); b.title = b.subject; }
  if (input.text !== undefined) { if (it.kind !== "email" || !input.text.trim()) bad(ctx, "The email needs words."); b.text = input.text.slice(0, 20000); }
  if (input.send !== undefined) { if (it.kind !== "email" || (input.send !== "send" && input.send !== "draft")) bad(ctx, "The email is sent or saved as a draft."); b.send = input.send; }
  if (input.startsAt !== undefined || input.endsAt !== undefined) {
    if (it.kind !== "hold") bad(ctx, "Times belong to the calendar hold.");
    const s = input.startsAt ?? b.startsAt ?? 0;
    const e = input.endsAt ?? (b.endsAt !== undefined && b.startsAt !== undefined ? s + (b.endsAt - b.startsAt) : s + 30 * 60_000);
    if (!isInt(s) || !isInt(e) || e <= s) bad(ctx, "The hold ends after it starts.");
    b.startsAt = s;
    b.endsAt = e;
  }
  const me = personOf(ctx);
  if (input.send !== undefined && me) setState(ctx, `email_mode:${me}`, input.send);   // the person's choice is remembered for the next follow-up
  const out: Item = { ...it, body: b, status: "proposed", error: null };
  saveItem(ctx, out);
  return { item: itemOut(out) };
}

export async function closeoutSkip(ctx: MeetCtx, input: { meetingId: string; itemId: string; undo?: boolean }) {
  const { c, it } = await openItem(ctx, input.meetingId, input.itemId);
  if (input.undo === true ? it.status !== "skipped" : it.status !== "proposed" && it.status !== "failed") {
    return { item: itemOut(it), state: shown(c.state) };   // already where it was asked to be
  }
  const out: Item = { ...it, status: input.undo === true ? "proposed" : "skipped", error: null, by: personOf(ctx), at: ctx.now() };
  saveItem(ctx, out);
  const state = settle(ctx, c);
  return { item: itemOut(out), state };
}

/** The package state after a change; the moment the last item is handled the meeting is closed, and says so once. */
function settle(ctx: MeetCtx, c: Close): CloseState {
  const items = itemsOf(ctx, c.recordId);
  const state = c.state === "preparing" || c.state === "waiting" ? (items.length ? stateOf(items) : shown(c.state)) : stateOf(items);
  if (state !== c.state) saveClose(ctx, { ...c, state, updatedAt: ctx.now() });
  if (state === "closed" && c.state !== "closed") {
    ctx.emit("meeting.closed", `record/${c.recordId}`, { meetingId: c.recordId, made: items.flatMap((i) => i.made.map((m) => ({ type: m.type, id: m.id }))) });
  }
  return state;
}

// ---------------------------------------------------------------- approve

// one approve per meeting at a time: Approve all and a single approve pressed together must not make the same task twice
const approving = new Map<string, Promise<unknown>>();

export async function closeoutApprove(ctx: MeetCtx, input: { meetingId: string; itemIds?: string[] }) {
  const prev = approving.get(input.meetingId) ?? Promise.resolve();
  const next = prev.then(() => approveOnce(ctx, input), () => approveOnce(ctx, input));
  approving.set(input.meetingId, next.catch(() => undefined));
  try { return await next; } finally { if (approving.get(input.meetingId) === next) approving.delete(input.meetingId); }
}

async function approveOnce(ctx: MeetCtx, input: { meetingId: string; itemIds?: string[] }) {
  ensure(ctx);
  const rec = await meetingFor(ctx, input.meetingId);
  const c = closeOf(ctx, input.meetingId);
  if (!c) return refuse(ctx, "This meeting has no close-out yet.");
  const all = itemsOf(ctx, input.meetingId);
  if (input.itemIds !== undefined && input.itemIds.some((id) => !all.some((i) => i.id === id))) bad(ctx, "One of those close-out items is not there.");
  const picked = all.filter((i) => (input.itemIds === undefined ? i.status === "proposed" : input.itemIds.includes(i.id)) && (i.status === "proposed" || i.status === "failed"));
  const me = personOf(ctx);
  const env = { meetingId: input.meetingId, title: text(rec.fields["title"]) || c.title || "Meeting", owner: c.owner, me, related: c.people.filter((p) => p.recordId) };
  for (const it of picked) {
    const done = await runItem(ctx, it, env);
    saveItem(ctx, { ...it, ...done, by: me ?? ctx.principal.id, at: ctx.now() });
  }
  const state = settle(ctx, closeOf(ctx, input.meetingId) as Close);
  return { meetingId: input.meetingId, state, items: itemsOf(ctx, input.meetingId).map(itemOut) };
}

type Env = { meetingId: string; title: string; owner: string; me: string | null; related: Person[] };
const errorText = (e: unknown): string => (e as { error?: { message?: string } } | null)?.error?.message ?? (e instanceof Error ? e.message : "") ?? "";

/** Do what one item says, through the capability it names, as the caller. Never throws: a failure is the item's, and the rest still go. */
async function runItem(ctx: MeetCtx, it: Item, env: Env): Promise<Pick<Item, "status" | "made" | "error">> {
  const key = `meeting:${env.meetingId}:${it.dedupe}`;
  const b = it.body;
  try {
    if (it.kind === "task") {
      const contact = env.related[0]?.recordId;
      const t = obj(obj(await ctx.call("tasks.create", {
        title: b.title, ...(b.why ? { why: b.why } : {}), assigned: { kind: "person", id: b.assignee ?? env.me ?? env.owner }, ...(b.due !== undefined ? { due: b.due } : {}),
        recordId: contact ?? env.meetingId, source: { kind: "meeting", id: env.meetingId }, idempotencyKey: key,
      })).task);
      return { status: "approved", made: [{ type: "task", id: text(t["id"]), title: b.title }], error: null };
    }
    if (it.kind === "record") {
      const made: Made[] = [];
      const type = b.recordType ?? "contact";
      if (b.changes && b.changes.length) {
        const defs = await editableFields(ctx, type);
        const patch: Json = {};
        for (const ch of b.changes) {
          const f = defs.find((d) => d.key === ch.field);
          const v = f ? valueFor(f, ch.to) : undefined;
          if (v !== undefined) patch[ch.field] = v;
        }
        if (Object.keys(patch).length) {
          await ctx.call("records.update", { type, recordId: b.recordId, patch });
          made.push({ type: "record", id: b.recordId as string, title: b.title });
        }
      }
      if (b.note && b.note.trim()) {
        const cm = obj(obj(await ctx.call("records.comments.add", { type, recordId: b.recordId, text: b.note.trim().slice(0, 4000), idempotencyKey: `${key}:note` })).comment);
        made.push({ type: "comment", id: text(cm["commentId"]) || (b.recordId as string), title: b.title });
      }
      if (!made.length) made.push({ type: "record", id: b.recordId as string, title: b.title });
      return { status: "approved", made, error: null };
    }
    if (it.kind === "email") {
      const mailboxId = b.mailboxId ?? (await senderOf(ctx));
      if (!mailboxId) return { status: "failed", made: [], error: "Connect your mailbox in Settings to send this follow-up." };
      const contactId = env.related.find((p) => p.email && (b.to ?? []).some((t) => t.address === p.email))?.recordId;
      const msg = { mailboxId, to: b.to ?? [], subject: b.subject ?? b.title, text: b.text ?? "", ...(contactId ? { contactId } : {}) };
      if (b.send === "draft") {
        const d = obj(await ctx.call("mail.draft", { ...msg, idempotencyKey: `${key}:draft` }));
        return { status: "approved", made: [{ type: "draft", id: text(d["draftId"]), title: b.subject ?? b.title }], error: null };
      }
      const s = obj(await ctx.call("mail.send", { ...msg, idempotencyKey: `${key}:send` }));
      if (s["status"] === "held") return { status: "approved", made: [{ type: "approval", id: text(s["taskId"]), title: "Waiting for approval" }], error: null };
      if (s["status"] === "suppressed") return { status: "failed", made: [], error: "Every recipient has asked not to be emailed." };
      return { status: "approved", made: [{ type: "email", id: text(s["messageId"]) || key, title: b.subject ?? b.title }], error: null };
    }
    const calendarId = await calendarOf(ctx, env.me ?? env.owner);
    if (!calendarId) return { status: "failed", made: [], error: "Connect a calendar in Settings to hold the next meeting." };
    const ev = obj(obj(await ctx.call("calendar.create_event", {
      calendarId, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt, recordIds: [env.meetingId], description: `Agreed in ${env.title}.`, idempotencyKey: key,
    })).event);
    return { status: "approved", made: [{ type: "event", id: text(ev["id"]), title: b.title }], error: null };
  } catch (e) {
    return { status: "failed", made: [], error: errorText(e) || `That did not go through (${codeOf(e) || "unknown"}).` };
  }
}

/** The caller's own mailbox to send from: their default usable one, else any usable one of theirs. */
async function senderOf(ctx: MeetCtx): Promise<string | undefined> {
  const all = list(obj(await ctx.call("comms.senders.list", { channel: "email" }))["senders"]).map(obj).filter((s) => s["usable"] === true && /^mbx_[a-z0-9]+$/.test(text(s["id"])));
  const pick = all.find((s) => s["scope"] === "mine" && s["default"] === true) ?? all.find((s) => s["scope"] === "mine") ?? all.find((s) => s["default"] === true);
  return pick ? text(pick["id"]) : undefined;
}

/** The person's own calendar for a hold: a connected one of theirs first, then any of theirs. */
async function calendarOf(ctx: MeetCtx, person: string): Promise<string | undefined> {
  const cals = list(obj(await ctx.call("calendar.list_calendars", { scope: "mine" }))["calendars"]).map(obj);
  const pick = cals.find((c) => c["ownerId"] === person && c["provider"] !== "local") ?? cals.find((c) => c["ownerId"] === person) ?? cals.find((c) => c["personal"] === true) ?? cals[0];
  return pick ? text(pick["id"]) || undefined : undefined;
}

// ---------------------------------------------------------------- share

export async function closeoutShare(ctx: MeetCtx, input: { meetingId: string; projectId?: string; channelId?: string; on: boolean }) {
  ensure(ctx);
  await meetingFor(ctx, input.meetingId);
  const me = personOf(ctx);
  if ((input.projectId === undefined) === (input.channelId === undefined)) bad(ctx, "Share with one project or one channel.");
  if (me !== null && !watchersOf(ctx, input.meetingId).includes(me)) refuse(ctx, "Only the people whose meeting it is can share it.");
  const kind = input.projectId !== undefined ? "project" : "channel";
  const target = (input.projectId ?? input.channelId) as string;
  if (ctx.authorize && me !== null && ctx.authorize({ perm: null, level: "view" }, { type: kind, id: target }).effect !== "allow") refuse(ctx, `You cannot open that ${kind}.`);
  const have = first(ctx.db.all(`SELECT * FROM meetings_share WHERE "recordId" = ? AND "kind" = ? AND "targetId" = ?`, input.meetingId, kind, target));
  if (input.on && !have) ctx.db.run(`INSERT INTO meetings_share ("recordId", "kind", "targetId") VALUES (?, ?, ?)`, input.meetingId, kind, target);
  if (!input.on && have) ctx.db.run(`DELETE FROM meetings_share WHERE "recordId" = ? AND "kind" = ? AND "targetId" = ?`, input.meetingId, kind, target);
  return { meetingId: input.meetingId };
}
