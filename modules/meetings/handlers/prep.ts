// Prepare for an event (lane l-calevents, the Calendar's event pane): the person's own Assistant drafts a few lines of prep notes from the attendees' records and the past meetings
// with them (their close-out summaries and open tasks), in a task of its own like the close-out, and hands them back with meetings.prep.save. The notes are the person's own:
// one set per event per person, kept here, never shown to anyone else.
// DECISION: the brief carries only what the person may see: the event as calendar.get_event answers them, records through records.get as them, and past meetings they may open.
import { assistantFor, canOpen, spacePeople } from "./closeout.ts";
import { bad, ensure, getState, isId, linkFor, list, missing, obj, parseJson, personOf, refuse, rowsOf, setState, str, text } from "../projections.ts";
import type { Json, MeetCtx } from "../projections.ts";

type PrepState = "none" | "working" | "ready";
interface Prep { state: PrepState; notes: string[]; taskId?: string; agentId?: string; n: number; at?: number }

const keyOf = (eventId: string, person: string): string => `prep:${eventId}:${person}`;
const readPrep = (ctx: MeetCtx, key: string): Prep | null => { const v = getState(ctx, key); return v ? parseJson<Prep>(v, { state: "none", notes: [], n: 0 }) : null; };
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function prepGet(ctx: MeetCtx, input: { eventId: string }) {
  ensure(ctx);
  if (!isId("cev", input.eventId)) bad(ctx, "That is not an event id.");
  const me = personOf(ctx);
  const p = me ? readPrep(ctx, keyOf(input.eventId, me)) : null;
  if (!p) return { state: "none" as const, notes: [] };
  return { state: p.state, notes: p.notes, ...(p.taskId ? { taskId: p.taskId } : {}), ...(p.at ? { preparedAt: p.at } : {}) };
}

/** What the brief says about the past meetings with these people: the ones the person may open, newest first, with what their close-out found. */
function pastMeetings(ctx: MeetCtx, emails: readonly string[], before: number): string[] {
  const rows = rowsOf(ctx.db.all(`SELECT * FROM meetings_closeout`)).filter((r) => canOpen(ctx, str(r, "recordId")));
  const out: Array<{ at: number; line: string }> = [];
  for (const r of rows) {
    const l = linkFor(ctx, str(r, "recordId"));
    if (!l || l.startsAt >= before || !l.emails.some((e) => emails.includes(e))) continue;
    const items = rowsOf(ctx.db.all(`SELECT * FROM meetings_item WHERE "recordId" = ?`, str(r, "recordId"))).filter((i) => str(i, "kind") === "task");
    const open = items.filter((i) => str(i, "status") === "proposed").map((i) => text(parseJson<Json>(i["body"] as string, {})["title"]));
    const done = items.filter((i) => str(i, "status") === "approved").map((i) => text(parseJson<Json>(i["body"] as string, {})["title"]));
    out.push({ at: l.startsAt, line: `${str(r, "title") || "Meeting"} on ${day(l.startsAt)}: ${clip(str(r, "summary") || "no summary", 500)}${done.length ? ` Tasks made: ${done.join("; ")}.` : ""}${open.length ? ` Still to approve: ${open.join("; ")}.` : ""}` });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 3).map((x) => x.line);
}

export async function prepStart(ctx: MeetCtx, input: { eventId: string }) {
  ensure(ctx);
  if (!isId("cev", input.eventId)) bad(ctx, "That is not an event id.");
  const me = personOf(ctx);
  if (!me) return refuse(ctx, "Prep notes are a person's own. Ask as a person, or act for one.");
  let event: Json;
  try { event = obj(obj(await ctx.call("calendar.get_event", { eventId: input.eventId })).event); } catch { return missing(ctx, "There is no such event."); }
  const key = keyOf(input.eventId, me);
  const had = readPrep(ctx, key);
  if (had?.state === "working") return { state: had.state, ...(had.taskId ? { taskId: had.taskId } : {}) };
  const agentId = await assistantFor(ctx, me);
  if (!agentId) return refuse(ctx, "Your Assistant is not set up yet. Connect an AI account first.");
  const title = text(event["title"]) || "the event";
  const startsAt = typeof event["startsAt"] === "number" ? event["startsAt"] : ctx.now();
  const guests = list(event["attendees"]).map(obj).map((a) => ({ email: text(a["email"]).toLowerCase(), response: text(a["response"]) || "needs_action" })).filter((a) => a.email);
  // who the guests are: the sure contact record of each address, read as the person
  const people: string[] = [];
  for (const g of guests) {
    let line = g.email;
    try {
      const sure = obj(list(obj(await ctx.call("contacts.resolve", { email: g.email }))["sure"])[0]);
      const rid = text(sure["recordId"]);
      if (isId("rec", rid)) {
        const f = obj(obj(obj(await ctx.call("records.get", { type: text(sure["type"]) || "contact", recordId: rid })).record)["fields"]);
        line = `${text(f["name"]) || text(sure["name"]) || g.email} <${g.email}>, record ${rid}${text(f["title"]) ? `, ${text(f["title"])}` : ""}`;
      }
    } catch { /* an address with no record the person may read stays an address */ }
    people.push(`- ${line} (${g.response.replace("_", " ")})`);
  }
  const past = pastMeetings(ctx, guests.map((g) => g.email), startsAt);
  const team = await spacePeople(ctx);
  const name = team.find((p) => p.id === me)?.name ?? "the person";
  const brief = [
    `Prepare ${name} for "${title}" on ${new Date(startsAt).toISOString().replace("T", " ").slice(0, 16)} UTC.`, "",
    "Who is coming:", ...(people.length ? people : ["- nobody else"]),
    ...(text(event["description"]) ? ["", "Description:", clip(text(event["description"]), 3000)] : []),
    ...(text(event["agenda"]) ? ["", "Agenda:", clip(text(event["agenda"]), 3000)] : []),
    "", "Past meetings with them:", ...(past.length ? past.map((l) => `- ${l}`) : ["- none in Vyre"]), "",
    "Read their records and recent conversations if you need more. Then call meetings.prep.save once with eventId " + input.eventId + " and 3 to 8 short lines:",
    "who they are and what they want, what was agreed last time and what is still open, and what to raise or decide in this one. Leave out anything you do not know. Then submit this task.",
  ].join("\n");
  const n = (had?.n ?? 0) + 1;
  const made = obj(obj(await ctx.call("tasks.create", {
    kind: "work", title: clip(`Prepare for ${title}`, 90), summary: `Prep notes for ${title}.`, assigned: { kind: "agent", id: agentId }, source: { kind: "manual", id: input.eventId },
    notes: { brief, "meeting.prep": input.eventId, "baton.owner": me }, idempotencyKey: `meeting:prep:${input.eventId}:${me}:${n}`,
  })).task);
  const taskId = text(made["id"]);
  const threadId = text(made["threadId"]);
  if (threadId) {
    try { await ctx.call("threads.set_mode", { threadId, mode: "auto" }); } catch { /* the task goes on without it */ }
    try { await ctx.call("chat.post", { threadId, body: brief, idempotencyKey: `meeting:prep:${input.eventId}:${me}:${n}:brief` }); } catch { /* the brief is in the task's notes too */ }
  }
  setState(ctx, key, JSON.stringify({ state: "working", notes: had?.notes ?? [], ...(isId("tsk", taskId) ? { taskId } : {}), agentId, n } satisfies Prep));
  return { state: "working" as const, ...(isId("tsk", taskId) ? { taskId } : {}) };
}

/** The Assistant hands the notes in for the person who asked; the person may also write them. */
export async function prepSave(ctx: MeetCtx, input: { eventId: string; notes: string[] }) {
  ensure(ctx);
  if (!isId("cev", input.eventId)) bad(ctx, "That is not an event id.");
  const notes = (Array.isArray(input.notes) ? input.notes : []).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 12).map((x) => clip(x, 600));
  if (!notes.length) bad(ctx, "Send at least one line of notes.");
  const me = personOf(ctx);
  let key: string | null = null;
  if (me) key = keyOf(input.eventId, me);
  else if (ctx.principal.kind === "agent") {
    // the Assistant writes into the notes it was asked for, never anyone else's
    const row = rowsOf(ctx.db.all(`SELECT * FROM meetings_state WHERE "key" LIKE ?`, `prep:${input.eventId}:%`)).find((r) => parseJson<Prep>(r["value"] as string, { state: "none", notes: [], n: 0 }).agentId === ctx.principal.id);
    key = row ? str(row, "key") : null;
  }
  if (!key) return refuse(ctx, "Nobody asked this Assistant to prepare for that event.");
  const had = readPrep(ctx, key);
  if (!me && !had) return refuse(ctx, "Nobody asked this Assistant to prepare for that event.");
  setState(ctx, key, JSON.stringify({ ...(had ?? { n: 0 }), state: "ready", notes, at: ctx.now() } as Prep));
  return { state: "ready" as const };
}
