// @reads /modules/chat/migrations/0004_agent_dm.sql
// An agent reaches a teammate for its person (owner ruling 3 Nov, lane l-agentdm).
//
//   people_status    who is in: online, away or offline and last seen (lib/presence.ts reads devices.presence), local time and working hours (settings.public_of), a mute, and when a message would go.
//   message_person   one message in the person's own direct chat with the teammate (made when there is none), written by the agent with an `on_behalf` block naming the person: everyone reads it as
//                    "<Person> (Agent)" with the person's face. Asking first is the Gate's: the capability holds a send for an agent, and the Auto rules let it through when the person asked this turn
//                    ("tell Andrey ...") or a task or automation holds the permission; anything else is a "Send this to Rubab?" card in the person's chat.
//   when it goes     now, when they are next online, or at a set time; never during away or outside the teammate's working hours unless urgent; at most 3 an hour from one person's agents to one
//                    teammate; nothing while the teammate muted that person for today. A message that waits is a row here, the person sees "Scheduled for Rubab" in their chat, and a periodic job
//                    sends it when its time comes (checking everything again).
//   back to the agent (a message sent as the person) the teammate's reply in that direct chat, and the answer to a card (Approve or Review task, key request), go back to the chat the person asked in as one line that @mentions the
//                    agent, as the person: the agent carries on there. A message the agent sent as itself is different: the teammate's replies are theirs and the agent's. The chat the agent was asked
//                    in gets ONE line the first time they reply ("Connected with <name>. <Agent> is talking with <name> directly."), no words of theirs, and nothing more for that direct chat. Nothing a teammate writes counts as the person asking for anything (it is never a typed message).
//   privacy          the message is checked against the person's private profile facts and their Mine Vault values before it leaves (the direct chat's audience is two people, so nothing private of one
//                    goes in unless that person said it themselves in the chat they asked in).
import { readFileSync } from "node:fs";
import { askedIn } from "../../../lib/asked.ts";
import { handleOf } from "../../../lib/person-handle.ts";
import { othersRead } from "../../../lib/audience.ts";
import type { Audience } from "../../../lib/audience.ts";
import { dueAt, dueWords, endOfDay, inHours, localTime, readPresence, readPublicTime } from "../../../lib/presence.ts";
import type { Due, Presence, PublicTime, Timing } from "../../../lib/presence.ts";
import { addAgent, addMember, askerOf, ensure, insertMessage, insertThread, messageBy, mintId, raise, threadBy } from "../projections.ts";
import type { ChatCtx, Db, MessageRec, ThreadRec } from "../projections.ts";
import { deliver, isDirect } from "./post.ts";

// ---- schema -----------------------------------------------------------------------------------------------------------------------------------------

const SCHEMA = readFileSync(new URL("../migrations/0004_agent_dm.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

export function ensureAgentDm(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  try { db.all("SELECT id FROM chat_agent_dm WHERE id = ?", "probe"); db.all("SELECT teammate FROM chat_agent_dm_mute WHERE teammate = ?", "probe"); } catch { for (const s of SCHEMA) db.run(s); }
  // how a message was sent: for the person (their direct chat, "<Person> (Agent)") or as the agent itself (its own chat with the teammate)
  try { db.all("SELECT mode FROM chat_agent_dm WHERE id = ?", "probe"); } catch { db.run("ALTER TABLE chat_agent_dm ADD COLUMN mode TEXT NOT NULL DEFAULT 'person'"); }
  ready.add(db);
}

// ---- rules ------------------------------------------------------------------------------------------------------------------------------------------

export const PER_HOUR = 3;
const HOUR = 3_600_000;
/** How long after the agent's message a teammate's words in the direct chat still go back to it. */
export const REPLY_WINDOW = 24 * HOUR;
const MAX_RELAY = 2000;
/** How much of a teammate's reply to an agent's own chat is quoted back to the chat it was asked in. */
const REPORT_MAX = 160;
/** A second identical message to the same teammate within this window is the first one. */
const TWIN_MS = 10 * 60_000;

type Row = Record<string, unknown>;
export interface DmRow {
  id: string; person: string; agent: string; teammate: string; origin: string | null; dm: string; body: string; blocks: Array<Record<string, unknown>>; timing: Timing; urgent: boolean;
  state: "scheduled" | "sent" | "canceled"; dueAt: number | null; reason: string | null; message: string | null; task: string | null; request: string | null; card: { kind: string; title: string } | null;
  idem: string | null; createdAt: number; sentAt: number | null; repliedAt: number | null; answeredAt: number | null; wantedAt: number | null; mode: "person" | "self";
}
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown, f: T): T => { try { return v === null || v === undefined ? f : (JSON.parse(String(v)) as T); } catch { return f; } };
function rowOf(r: Row): DmRow {
  return {
    id: String(r["id"]), person: String(r["person"]), agent: String(r["agent"]), teammate: String(r["teammate"]), origin: s(r["origin"]), dm: String(r["dm"]), body: String(r["body"] ?? ""),
    blocks: json(r["blocks"], []), timing: (s(r["timing"]) ?? "now") as Timing, urgent: Number(r["urgent"]) === 1, state: String(r["state"]) as DmRow["state"], dueAt: n(r["due_at"]), reason: s(r["reason"]),
    message: s(r["message"]), task: s(r["task"]), request: s(r["request"]), card: json(r["card"], null), idem: s(r["idem"]), createdAt: Number(r["created_at"]), sentAt: n(r["sent_at"]),
    repliedAt: n(r["replied_at"]), answeredAt: n(r["answered_at"]), wantedAt: n(r["wanted_at"]), mode: s(r["mode"]) === "self" ? "self" : "person",
  };
}
const rows = (db: Db, sql: string, ...a: unknown[]): DmRow[] => (db.all(sql, ...a) as Row[]).map(rowOf);

/** The mute a teammate set on one person's agents, while it lasts. */
export function mutedUntil(db: Db, teammate: string, person: string, now: number): number | null {
  const r = (db.all("SELECT until FROM chat_agent_dm_mute WHERE teammate = ? AND person = ?", teammate, person) as Row[])[0];
  const until = r ? Number(r["until"]) : 0;
  return until > now ? until : null;
}

/** When the next message from one person's agents to one teammate may go under the hourly limit; `now` when it is free. */
export function limitFree(db: Db, person: string, teammate: string, now: number, agent?: string): number {
  // a Space agent writing as itself is limited per agent and teammate; an Assistant writing for its person, per person and teammate
  const sent = ((agent
    ? db.all("SELECT sent_at FROM chat_agent_dm WHERE agent = ? AND teammate = ? AND mode = 'self' AND state = 'sent' AND sent_at > ? ORDER BY sent_at DESC", agent, teammate, now - HOUR)
    : db.all("SELECT sent_at FROM chat_agent_dm WHERE person = ? AND teammate = ? AND mode = 'person' AND state = 'sent' AND sent_at > ? ORDER BY sent_at DESC", person, teammate, now - HOUR)) as Row[]).map((r) => Number(r["sent_at"]));
  if (sent.length < PER_HOUR) return now;
  return sent[PER_HOUR - 1]! + HOUR;
}

/** When a message goes, all rules together: the teammate's presence and hours (lib/presence.ts), then a mute, then the hourly limit. The latest wins. */
export function decide(db: Db, o: { person: string; teammate: string; timing: Timing; wantedAt?: number | null; urgent: boolean; presence: Presence; time: PublicTime; now: number; agent?: string }): Due {
  let d = dueAt({ timing: o.timing, ...(o.wantedAt ? { at: o.wantedAt } : {}), urgent: o.urgent, presence: o.presence, time: o.time, now: o.now });
  const mute = mutedUntil(db, o.teammate, o.person, o.now);
  if (mute !== null && (d.at === null || d.at < mute)) d = { at: mute, reason: "muted" };
  const free = limitFree(db, o.person, o.teammate, o.now, o.agent);
  if (free > o.now && d.at !== null && d.at < free) d = { at: free, reason: "limit" };
  return d;
}

// ---- names ------------------------------------------------------------------------------------------------------------------------------------------

type Call = (cap: string, input: unknown) => Promise<unknown>;
const callOf = (ctx: ChatCtx): Call => (cap, input) => (ctx.call ? ctx.call(cap, input) : Promise.reject(new Error("no calls here")));

async function person(call: Call, id: string): Promise<{ name: string; status: string } | null> {
  try {
    const p = ((await call("access.principals.get", { principal: { kind: "person", id } })) as { principal?: { name?: string; status?: string; kind?: string } } | null)?.principal;
    return p && (p.kind === undefined || p.kind === "person") ? { name: p.name || "A teammate", status: p.status ?? "active" } : null;
  } catch { return null; }
}
const first = (name: string): string => name.split(" ")[0] || name;

/**
 * Is this agent private to a person (their own Assistant, or an outside agent they connected)? It writes for the person, in the person's own direct chat, as "<Person> (Agent)". Any other agent, one the Space
 * shares, writes as itself in its own chat with the teammate (owner ruling 4 Nov 2026). An agent that cannot be read is not taken for the person's.
 */
async function writesForPerson(call: Call, agentId: string): Promise<boolean> {
  try {
    const a = ((await call("agents.get", { agentId })) as { agent?: { kind?: string; runtime?: string } } | null)?.agent;
    return a?.kind === "assistant" || a?.runtime === "outside";
  } catch { return false; }
}

export { handleOf };

/** Who a `to` names: an id (older callers), a handle from people_status, or a name that is one person's alone. */
async function resolveTo(call: Call, to: string, me: string): Promise<string | null> {
  if (to.startsWith("usr_")) return to;
  const r = (await call("access.principals.list", { kind: "person", status: "active", limit: 200 })) as { principals?: Array<{ id: string; name: string }> } | null;
  const people = (r?.principals ?? []).filter((p) => p.id !== me);
  const q = to.trim().toLowerCase();
  const byHandle = people.filter((p) => handleOf(p.name, p.id) === q);
  if (byHandle.length === 1) return byHandle[0]!.id;
  const byName = people.filter((p) => p.name.toLowerCase() === q || first(p.name).toLowerCase() === q);
  return byName.length === 1 ? byName[0]!.id : null;
}
const clip = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function hoursText(t: PublicTime): string | undefined {
  const h = t.hours;
  if (!h) return undefined;
  const days = [...h.days].sort((a, b) => a - b);
  const run = days.length > 1 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  const dayText = days.length === 7 ? "Every day" : run ? `${DAYS[days[0]!]} to ${DAYS[days[days.length - 1]!]}` : days.map((d) => DAYS[d]).join(", ");
  return `${dayText}, ${h.from} to ${h.to}`;
}

// ---- privacy ----------------------------------------------------------------------------------------------------------------------------------------

const STOP = new Set(["that", "this", "with", "from", "have", "they", "them", "their", "there", "about", "would", "could", "should", "which", "where", "when", "what", "your", "yours", "will", "into", "been", "were", "also", "just", "like", "only", "some", "than", "then", "very", "more", "most", "much", "does", "done", "make", "made", "want", "wants", "know", "need", "needs", "please", "thanks", "today", "tomorrow"]);
const wordsOf = (t: string): string[] => (t.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'@.+-]*/gu) ?? []).map((w) => w.replace(/[.'+-]+$/, "")).filter((w) => w.length >= 4 && !STOP.has(w));

/** Does `text` say this fact? Word for word, or most of its own words (three in four, at least two). */
export function saysFact(fact: string, text: string): boolean {
  const f = fact.toLowerCase().replace(/\s+/g, " ").trim();
  if (f === "") return false;
  if (f.length >= 12 && text.toLowerCase().replace(/\s+/g, " ").includes(f)) return true;
  const fw = [...new Set(wordsOf(f))];
  if (fw.length < 2) return false;
  const tw = new Set(wordsOf(text));
  return fw.filter((w) => tw.has(w)).length >= Math.max(2, Math.ceil(fw.length * 0.75));
}

/** The person's private profile facts, as a chat that only they read may load them: lane l-profile's memory.profile.get where it exists, else the person layer of memory (all of it is private before it). */
async function privateFacts(call: Call, origin: string | null): Promise<string[]> {
  try {
    const r = (await call("memory.profile.get", origin ? { threadId: origin } : {})) as { private?: Array<{ text?: string }> } | null;
    if (Array.isArray(r?.private)) return r.private.map((f) => String(f.text ?? "")).filter((t) => t !== "");
  } catch { /* not on this server yet */ }
  try {
    const r = (await call("memory.facts.list", { layer: "person", limit: 200 })) as { facts?: Array<{ text?: string }> } | null;
    return (r?.facts ?? []).map((f) => String(f.text ?? "")).filter((t) => t !== "");
  } catch { return []; }
}

/** What the person typed themselves in the chat they asked in (their last 30 messages): only that counts as them putting something in. */
function ownWords(db: Db, origin: string | null, personId: string): string {
  if (!origin) return "";
  return (db.all("SELECT body FROM chat_message WHERE thread = ? AND author = ? AND kind = 'text' AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 30", origin, personId) as Row[]).map((r) => String(r["body"] ?? "")).join("\n");
}

/**
 * The l-chatleaks rule on the direct chat's audience: content goes in only when everyone who reads it may. The teammate reads it, so the person's private profile facts and their Mine Vault values stay out,
 * unless the person said them in their own words in the chat they asked in. Returns the reason it may not go, or null.
 */
export async function privacyRefusal(ctx: ChatCtx, o: { person: string; teammate: string; origin: string | null; text: string }): Promise<string | null> {
  const audience: Audience = { space: false, people: [o.person, o.teammate] };
  if (!othersRead(audience, o.person)) return null;
  const call = callOf(ctx);
  const theirs = ownWords(ctx.db, o.origin, o.person);
  const facts = (await privateFacts(call, o.origin)).filter((f) => saysFact(f, o.text) && !saysFact(f, theirs));
  if (facts.length > 0) return "It says something from their private profile. Leave it out, or ask them to say it themselves.";
  try {
    const found = ((await call("vault.text_check", { text: o.text })) as { handles?: string[] } | null)?.handles ?? [];
    if (found.length > 0) {
      const said = theirs === "" ? [] : ((await call("vault.text_check", { text: theirs })) as { handles?: string[] } | null)?.handles ?? [];
      if (found.some((h) => !said.includes(h))) return "It holds a value from their private Vault. Leave it out; share a key with a key card instead.";
    }
  } catch { /* no Vault on this server */ }
  return null;
}

// ---- the direct chat --------------------------------------------------------------------------------------------------------------------------------

function directBetween(db: Db, a: string, b: string): ThreadRec | null {
  const ids = (db.all(
    `SELECT t.id AS id FROM chat_thread t WHERE t.kind = 'chat' AND t.channelId IS NULL AND t.scopeType IS NULL AND t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM chat_thread_member m WHERE m.thread = t.id AND m.principal = ? AND m.deleted_at IS NULL)
       AND EXISTS (SELECT 1 FROM chat_thread_member m WHERE m.thread = t.id AND m.principal = ? AND m.deleted_at IS NULL) AND NOT EXISTS (SELECT 1 FROM chat_thread_agent x WHERE x.thread = t.id AND x.deleted_at IS NULL) ORDER BY t.createdAt LIMIT 20`, a, b,
  ) as Row[]).map((r) => String(r["id"]));
  for (const id of ids) { const t = threadBy(db, id); if (t && isDirect({ db }, t)) return t; }
  return null;
}

/** The person's direct chat with the teammate, made the way chat.start makes one when there is none. */
function directChat(ctx: ChatCtx, a: string, b: string): ThreadRec {
  const had = directBetween(ctx.db, a, b);
  if (had) return had;
  const t = insertThread(ctx, { kind: "chat", starter: a, listed: true });
  addMember(ctx, t.id, a, "owner");
  addMember(ctx, t.id, b);
  ctx.emit("thread.started", t.id, { threadId: t.id, kind: t.kind, starter: a });
  return t;
}

/**
 * The agent's own chat with a teammate, when it writes as itself: the teammate and the agent are in it and nobody else (the person who asked is not, unless the teammate adds them). Made the first time,
 * found after. The teammate's replies land here and the agent answers them under its own response rules.
 */
function agentChat(ctx: ChatCtx, agent: string, teammate: string, agentName: string): ThreadRec {
  const had = (ctx.db.all("SELECT dm FROM chat_agent_dm WHERE agent = ? AND teammate = ? AND mode = 'self' ORDER BY created_at DESC LIMIT 5", agent, teammate) as Row[]).map((r) => threadBy(ctx.db, String(r["dm"]))).find((t) => t !== null && t !== undefined);
  if (had) return had;
  // named after the agent, like any direct chat with an agent
  const t = insertThread(ctx, { kind: "chat", title: agentName, starter: teammate, listed: true });
  addMember(ctx, t.id, teammate, "owner");
  addAgent(ctx, t.id, { agentId: agent, mode: "lead", addedBy: agent });
  ctx.emit("thread.started", t.id, { threadId: t.id, kind: t.kind, starter: teammate });
  return t;
}

/** A line in the chat the person asked in, from the agent, that starts no turn (an agent never answers its own mention). */
function quietLine(ctx: ChatCtx, threadId: string | null, agent: string, body: string, data: Record<string, unknown>): void {
  const t = threadId ? threadBy(ctx.db, threadId) : null;
  if (!t) return;
  const m = insertMessage(ctx, t.id, { author: agent, kind: "quiet", body, blocks: [{ type: "agent_dm", v: 1, id: mintId("blk", ctx.now()), state: "done", data }] });
  deliver(ctx, t, m, [{ kind: "agent", id: agent }], { kind: "agent", id: agent }, { notify: false });
}

/** Back to the agent in the chat the person asked in: one line as the person, @mentioning the agent, so it carries on there. Never a typed message: it asks for nothing. */
function relay(ctx: ChatCtx, row: DmRow, body: string, data: Record<string, unknown>): string | null {
  const t = row.origin ? threadBy(ctx.db, row.origin) : null;
  if (!t) return null;
  const m = insertMessage(ctx, t.id, { author: row.person, kind: "quiet", body, blocks: [{ type: "relay", v: 1, id: mintId("blk", ctx.now()), state: "done", data: { ...data, dmId: row.id, threadId: row.dm } }] });
  deliver(ctx, t, m, [{ kind: "agent", id: row.agent }], { kind: "person", id: row.person }, { notify: false });
  return m.id;
}

/** Post a message row into the direct chat now: the agent writes it, the block names the person it speaks for, the teammate is told it is a direct message. */
export function sendNow(ctx: ChatCtx, row: DmRow): MessageRec {
  const dm = threadBy(ctx.db, row.dm);
  if (!dm) raise(ctx, "validation.not_found", "That direct chat is gone.");
  const now = ctx.now();
  // for a person: signed as them ("<Person> (Agent)"). As itself: the agent's own words, no block naming anyone
  const onBehalf = { type: "on_behalf", v: 1, id: mintId("blk", now), state: "done", data: { person: row.person, agentId: row.agent, teammate: row.teammate } };
  const m = insertMessage(ctx, dm.id, { author: row.agent, kind: "agent", body: row.body, blocks: row.mode === "self" ? [...row.blocks] : [onBehalf, ...row.blocks] });
  deliver(ctx, dm, m, [], { kind: "agent", id: row.agent }, { notify: false });
  ctx.emit("message.direct", dm.id, { messageId: m.id, threadId: dm.id, personId: row.teammate, author: { kind: "agent", id: row.agent } });
  ctx.db.run("UPDATE chat_agent_dm SET state = 'sent', sent_at = ?, message = ?, due_at = NULL, reason = NULL WHERE id = ?", now, m.id, row.id);
  return m;
}

// ---- people_status ----------------------------------------------------------------------------------------------------------------------------------

export async function peopleStatus(ctx: ChatCtx, input: { personIds?: string[]; q?: string }) {
  ensureAgentDm(ctx.db);
  const me = askerOf(ctx);
  if (!me.startsWith("usr_")) raise(ctx, "validation.precondition_failed", "Only an agent working for a person, or the person, can see who is in.");
  const call = callOf(ctx);
  const agent = ctx.principal.kind === "agent" ? ctx.principal.id : undefined;
  const self = agent !== undefined && !(await writesForPerson(call, agent));
  const mine = (await person(call, me))?.name ?? "the person you work for";
  let people: Array<{ id: string; name: string }> = [];
  if (input.personIds && input.personIds.length > 0) {
    for (const id of [...new Set(input.personIds)]) { const p = id === me ? null : await person(call, id); if (p && p.status === "active") people.push({ id, name: p.name }); }
  } else {
    const r = (await call("access.principals.list", { kind: "person", status: "active", ...(input.q ? { q: input.q } : {}), limit: 200 })) as { principals?: Array<{ id: string; name: string }> } | null;
    people = (r?.principals ?? []).filter((p) => p.id !== me).map((p) => ({ id: p.id, name: p.name }));
  }
  if (input.q) { const q = input.q.toLowerCase(); people = people.filter((p) => p.name.toLowerCase().includes(q)); }
  const now = ctx.now();
  const presence = await readPresence(call, people.map((p) => p.id));
  const out = [];
  for (const p of people.slice(0, 50)) {
    const pr = presence.get(p.id) ?? { personId: p.id, state: "unknown" as const };
    const time = await readPublicTime(call, p.id);
    const mute = mutedUntil(ctx.db, p.id, me, now);
    const d = decide(ctx.db, { person: me, teammate: p.id, timing: "now", urgent: false, presence: pr, time, now, ...(self ? { agent } : {}) });
    out.push({
      handle: handleOf(p.name, p.id), name: p.name, state: pr.state, ...(pr.lastSeenAt !== undefined ? { lastSeenAt: pr.lastSeenAt } : {}), ...(pr.awayUntil !== undefined ? { awayUntil: pr.awayUntil } : {}),
      ...(time.timezone ? { timezone: time.timezone, localTime: localTime(now, time.timezone) } : {}), ...(hoursText(time) ? { hours: hoursText(time)! } : {}), inHours: inHours(time, now),
      ...(mute !== null ? { mutedUntil: mute } : {}), wouldGo: dueWords(d, p.name, time.timezone, now),
    });
  }
  // which way a message goes, so the agent never claims the other: the model reads names and handles, never ids
  const how = self
    ? "You message people as yourself, with your own name, in your own chat with each of them. They reply there and you answer there. The person you work for cannot read that chat unless the teammate adds them, and what the teammate writes to you is theirs: do not relay it. The person is told once, with no words of the teammate's, that you are connected."
    : `You message people for ${mine}, in their own chat with the teammate, signed as ${mine} (Agent). The reply comes back to the chat you were asked in.`;
  return { people: out, how };
}

// ---- message_person ---------------------------------------------------------------------------------------------------------------------------------

export interface MessageIn {
  to: string; body: string; timing?: Timing; at?: number; urgent?: boolean;
  card?: { kind: "approval" | "review" | "key"; title: string; detail?: string; fields?: string[] };
  idempotencyKey?: string;
}

/** The card a message carries, made through its own machinery as the agent for its person: an Approve or a Review task for the teammate, or a key request addressed to them. */
async function makeCard(ctx: ChatCtx, card: NonNullable<MessageIn["card"]>, o: { to: string; personName: string; key: string }): Promise<{ block: Record<string, unknown>; task?: string; request?: string }> {
  const call = callOf(ctx);
  const id = mintId("blk", ctx.now());
  if (card.kind === "key") {
    const name = card.title.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^[^A-Za-z]+/, "") || "Key";
    const r = (await call("vault.request", { name, ...(card.fields?.length ? { fields: card.fields } : {}), reason: card.detail?.trim() || `${o.personName} asked for it.`, to: o.to, idempotencyKey: `${o.key}:key` })) as { request?: { id?: string; name?: string; fields?: string[] } } | null;
    const requestId = String(r?.request?.id ?? "");
    if (!requestId) raise(ctx, "internal.unexpected", "The key request was not made.");
    return { request: requestId, block: { type: "vault_request", v: 1, id, state: "done", data: { requestId, name: r?.request?.name ?? name, fields: r?.request?.fields ?? card.fields ?? [], reason: card.detail ?? "", state: "waiting" } } };
  }
  const approval = card.kind === "approval";
  const blocks = [{ type: approval ? "table" : "doc_excerpt", v: 1, data: { cap: "", act: "", plain: true, ask: { what: `${approval ? "approve" : "review"} ${card.title.trim()}` }, ...(card.detail ? { text: card.detail, rows: [["Detail", card.detail]] } : { rows: [] }) } }];
  const r = (await call("tasks.create", {
    kind: approval ? "approve" : "review", title: card.title.trim(), ...(card.detail ? { summary: card.detail } : {}), why: `${o.personName} asks through their agent.`,
    ...(approval ? { approver: { kind: "person", id: o.to } } : { reviewer: { kind: "person", id: o.to } }), assigned: { kind: "person", id: o.to },
    ...(ctx.thread ? { source: { kind: "chat", id: ctx.thread } } : {}), blocks, idempotencyKey: `${o.key}:task`,
  })) as { task?: { id?: string } } | null;
  const taskId = String(r?.task?.id ?? "");
  if (!taskId) raise(ctx, "internal.unexpected", "The card was not made.");
  return { task: taskId, block: { type: "link_card", v: 1, id, state: "done", data: { icon: approval ? "approval" : "task", lead: approval ? "Allow" : "Review", title: clip(card.title.trim(), 80), target: { type: "task", id: taskId } } } };
}

export async function messagePerson(ctx: ChatCtx, rawInput: MessageIn) {
  let input = rawInput;
  ensureAgentDm(ctx.db);
  if (ctx.principal.kind !== "agent" || !ctx.actingFor?.startsWith("usr_")) raise(ctx, "validation.precondition_failed", "An agent sends this for the person it works for. To write to someone yourself, open your chat with them.");
  const me = ctx.actingFor;
  const agent = ctx.principal.id;
  if (typeof input.to !== "string" || input.to.trim() === "") raise(ctx, "validation.bad_input", "Name the teammate: the handle people_status gives, or their name.");
  const resolved = await resolveTo(callOf(ctx), input.to, me);
  if (resolved === null) raise(ctx, "validation.bad_input", "I could not tell who that is. Use the handle people_status gives.");
  input = { ...input, to: resolved };
  if (input.to === me) raise(ctx, "validation.bad_input", "That is the person you work for. Answer them here.");
  const body = (input.body ?? "").trim();
  if (body === "" && !input.card) raise(ctx, "validation.bad_input", "Write the message.");
  const timing: Timing = input.timing ?? (input.at !== undefined ? "at" : "now");
  if (timing === "at" && (typeof input.at !== "number" || !Number.isFinite(input.at))) raise(ctx, "validation.bad_input", "Say when, as a time.");

  // the same call again (a resumed turn, a retry) is the same message
  if (input.idempotencyKey) {
    const had = rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE agent = ? AND idem = ?", agent, input.idempotencyKey)[0];
    if (had) return answer(ctx, had, (await person(callOf(ctx), had.teammate))?.name ?? "them", null);
  }

  // the same words to the same teammate a moment ago (a parked call released by a plain "send it", then asked again in the next turn) are that message, never a second one
  if (!input.card && body !== "") {
    const twin = rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE agent = ? AND person = ? AND teammate = ? AND body = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1", agent, ctx.actingFor, input.to, body, ctx.now() - TWIN_MS)[0];
    if (twin) return answer(ctx, twin, (await person(callOf(ctx), twin.teammate))?.name ?? "them", null);
  }
  const call = callOf(ctx);
  const them = await person(call, input.to);
  if (!them || them.status !== "active") raise(ctx, "validation.not_found", "That person is not in this Space.");
  const mine = (await person(call, me))?.name ?? "Your person";
  const origin = ctx.thread && threadBy(ctx.db, ctx.thread) ? ctx.thread : null;

  const refusal = await privacyRefusal(ctx, { person: me, teammate: input.to, origin, text: [body, input.card?.title ?? "", input.card?.detail ?? ""].join("\n") });
  if (refusal) raise(ctx, "validation.precondition_failed", `Not sent to ${first(them.name)}. ${refusal}`, { reason: "private" });

  const now = ctx.now();
  const presence = (await readPresence(call, [input.to])).get(input.to)!;
  const time = await readPublicTime(call, input.to);
  const self = !(await writesForPerson(call, agent));
  const d = decide(ctx.db, { person: me, teammate: input.to, timing, wantedAt: input.at ?? null, urgent: input.urgent === true, presence, time, now, ...(self ? { agent } : {}) });

  const agentName = self ? ((await call("agents.get", { agentId: agent }).catch(() => null)) as { agent?: { name?: string } } | null)?.agent?.name ?? "Agent" : "";
  const dm = self ? agentChat(ctx, agent, input.to, agentName) : directChat(ctx, me, input.to);
  const id = mintId("adm", now);
  const key = input.idempotencyKey ?? id;
  // a card says it all: its title is the ask, its detail the reason (the agent's words when it gave none), so the message carries the card alone and nothing is said twice
  const asked = input.card ? { ...input.card, ...(input.card.detail?.trim() ? {} : body !== "" ? { detail: body } : {}) } : null;
  const card = asked ? await makeCard(ctx, asked, { to: input.to, personName: mine, key }) : null;
  const said = card ? "" : body;
  const words = input.urgent === true && d.at !== null && d.at <= now ? "now (urgent)" : dueWords(d, them.name, time.timezone, now);
  ctx.db.run(
    `INSERT INTO chat_agent_dm (id, person, agent, teammate, origin, dm, body, blocks, timing, urgent, state, due_at, reason, task, request, card, idem, created_at, wanted_at, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, me, agent, input.to, origin, dm.id, said, JSON.stringify(card ? [card.block] : []), timing, input.urgent === true ? 1 : 0, d.at, d.reason ?? null,
    card?.task ?? null, card?.request ?? null, input.card ? JSON.stringify({ kind: input.card.kind, title: input.card.title.trim() }) : null, input.idempotencyKey ?? null, now, input.at ?? null, self ? "self" : "person",
  );
  const row = rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE id = ?", id)[0]!;
  if (d.at !== null && d.at <= now) {
    const m = sendNow(ctx, row);
    // as itself, the agent says where it went, in the chat it was asked in, and that the chat is theirs
    if (self) quietLine(ctx, origin, agent, `Sent to ${first(them.name)} in ${agentName}'s chat with them (private to them).`, { dmId: id, state: "sent", teammate: input.to, threadId: dm.id });
    return answer(ctx, { ...row, state: "sent", message: m.id, sentAt: now }, them.name, words);
  }
  quietLine(ctx, origin, agent, `Scheduled for ${them.name}: ${words}.`, { dmId: id, state: "scheduled", teammate: input.to, threadId: dm.id, ...(d.at !== null ? { dueAt: d.at } : {}), ...(d.reason ? { reason: d.reason } : {}) });
  return answer(ctx, row, them.name, words);
}

function answer(ctx: ChatCtx, row: DmRow, name: string, words: string | null) {
  const sent = row.state === "sent";
  return {
    state: sent ? ("sent" as const) : ("scheduled" as const), threadId: row.dm, ...(row.message ? { messageId: row.message } : {}), ...(!sent && row.dueAt !== null ? { dueAt: row.dueAt } : {}),
    when: `${sent ? `Sent to ${name}` : `Scheduled for ${name}: ${words ?? (row.dueAt === null ? "when they are next online" : new Date(row.dueAt).toISOString())}`}${row.mode === "self"
      ? ", as yourself, in your own chat with them. Their reply lands there and you answer it there. What they write is private to them and you: the person you work for gets one line saying you are connected, and you do not relay their words unless they share them."
      : ". Their reply comes back to this chat."}`,
    as: row.mode,
    ...(row.task ? { taskId: row.task } : {}), ...(row.request ? { requestId: row.request } : {}),
  };
}

// ---- the teammate's mute ----------------------------------------------------------------------------------------------------------------------------

export async function mute(ctx: ChatCtx, input: { personId: string; undo?: boolean }) {
  ensureAgentDm(ctx.db);
  if (ctx.principal.kind !== "person") raise(ctx, "validation.precondition_failed", "Only a person mutes agent messages.");
  const me = ctx.principal.id;
  if (!input.personId?.startsWith("usr_") || input.personId === me) raise(ctx, "validation.bad_input", "Name the person whose agents you mute.");
  if (input.undo === true) {
    ctx.db.run("DELETE FROM chat_agent_dm_mute WHERE teammate = ? AND person = ?", me, input.personId);
    return { until: null };
  }
  const now = ctx.now();
  const time = await readPublicTime(callOf(ctx), me);
  const until = endOfDay(now, time.timezone);
  ctx.db.run("INSERT INTO chat_agent_dm_mute (teammate, person, until) VALUES (?, ?, ?) ON CONFLICT(teammate, person) DO UPDATE SET until = excluded.until", me, input.personId, until);
  // what waits for them now waits for tomorrow, and the person hears it once, in the chat their latest message came from
  ctx.db.run("UPDATE chat_agent_dm SET due_at = ?, reason = 'muted' WHERE person = ? AND teammate = ? AND state = 'scheduled' AND (due_at IS NULL OR due_at < ?)", until, input.personId, me, until);
  const last = rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE person = ? AND teammate = ? AND origin IS NOT NULL ORDER BY created_at DESC LIMIT 1", input.personId, me)[0];
  if (last) {
    const name = (await person(callOf(ctx), me))?.name ?? "Your teammate";
    quietLine(ctx, last.origin, last.agent, `${name} muted agent messages from you for today. What your agents send them waits until tomorrow.`, { dmId: last.id, state: "muted", teammate: me, until });
  }
  return { until };
}

// ---- the periodic send ------------------------------------------------------------------------------------------------------------------------------

/** Every waiting message whose time came, checked again (presence, hours, mute, limit) and sent, or moved to its new time. Returns the ids sent. */
export async function sendDue(ctx: ChatCtx): Promise<string[]> {
  ensureAgentDm(ctx.db);
  const now = ctx.now();
  const due = rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE state = 'scheduled' AND (due_at IS NULL OR due_at <= ?) ORDER BY created_at LIMIT 50", now);
  if (due.length === 0) return [];
  const call = callOf(ctx);
  const presence = await readPresence(call, [...new Set(due.map((r) => r.teammate))]);
  const sent: string[] = [];
  for (const row of due) {
    if (!threadBy(ctx.db, row.dm)) { ctx.db.run("UPDATE chat_agent_dm SET state = 'canceled' WHERE id = ?", row.id); continue; }
    const time = await readPublicTime(call, row.teammate);
    const d = decide(ctx.db, { person: row.person, teammate: row.teammate, timing: row.timing, wantedAt: row.wantedAt, urgent: row.urgent, presence: presence.get(row.teammate) ?? { personId: row.teammate, state: "unknown" }, time, now, ...(row.mode === "self" ? { agent: row.agent } : {}) });
    if (d.at === null || d.at > now) { ctx.db.run("UPDATE chat_agent_dm SET due_at = ?, reason = ? WHERE id = ?", d.at, d.reason ?? null, row.id); continue; }
    sendNow(ctx, row);
    sent.push(row.id);
    const name = (await person(call, row.teammate))?.name ?? "them";
    quietLine(ctx, row.origin, row.agent, `Sent to ${name}: ${clip(row.body || row.card?.title || "", 120)}`, { dmId: row.id, state: "sent", teammate: row.teammate, threadId: row.dm });
  }
  return sent;
}

// ---- back to the agent ------------------------------------------------------------------------------------------------------------------------------

/** The teammate wrote in the direct chat: within a day of the agent's message, and before the person wrote there themselves, it goes back to the chat the person asked in. */
export async function onDirectReply(ctx: ChatCtx, event: { payload: { messageId?: string; threadId?: string; author?: { kind?: string; id?: string } } }): Promise<string[]> {
  ensureAgentDm(ctx.db);
  const p = event.payload;
  if (p.author?.kind !== "person" || !p.threadId || !p.messageId) return [];
  const now = ctx.now();
  const row = rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE dm = ? AND teammate = ? AND state = 'sent' AND sent_at > ? ORDER BY sent_at DESC LIMIT 1", p.threadId, p.author.id, now - REPLY_WINDOW)[0];
  if (!row || !row.origin || !row.message) return [];
  const m = messageBy(ctx.db, p.messageId);
  const agentMsg = messageBy(ctx.db, row.message);
  if (!m || !agentMsg || m.thread !== row.dm || m.seq <= agentMsg.seq) return [];
  // the person picked the conversation up themselves: it is theirs now, not the agent's
  const spoke = row.mode !== "self" && ctx.db.all("SELECT 1 AS x FROM chat_message WHERE thread = ? AND author = ? AND threadSeq > ? AND threadSeq < ? AND deleted_at IS NULL LIMIT 1", row.dm, row.person, agentMsg.seq, m.seq).length > 0;
  if (spoke) return [];
  if (row.mode === "self") {
    // The conversation is the agent's with the teammate, and it is theirs: the chat the agent was asked in gets ONE line the first time they write back, with no words of theirs in it, and never another
    // for that direct chat. The agent still reads its own chat as a participant; nothing the teammate writes reaches the person unless the teammate shares it (owner ruling 6 Nov).
    if (ctx.db.all("SELECT 1 AS x FROM chat_agent_dm WHERE dm = ? AND mode = 'self' AND replied_at IS NOT NULL LIMIT 1", row.dm).length > 0) return [];
    const who = first((await person(callOf(ctx), row.teammate))?.name ?? "your teammate");
    const agentName = ((await callOf(ctx)("agents.get", { agentId: row.agent }).catch(() => null)) as { agent?: { name?: string } } | null)?.agent?.name ?? "The agent";
    quietLine(ctx, row.origin, row.agent, `Connected with ${who}. ${agentName} is talking with ${who} directly.`, { dmId: row.id, state: "connected", teammate: row.teammate, threadId: row.dm });
    ctx.db.run("UPDATE chat_agent_dm SET replied_at = ? WHERE dm = ? AND mode = 'self'", now, row.dm);
    return [m.id];
  }
  const name = (await person(callOf(ctx), row.teammate))?.name ?? "Your teammate";
  const said = m.body.trim() || (m.attachments.length > 0 ? "(sent a file)" : "");
  if (said === "") return [];
  const id = relay(ctx, row, `${first(name)} replied: ${clip(said, MAX_RELAY)}`, { kind: "reply", from: row.teammate, messageId: m.id });
  if (id) ctx.db.run("UPDATE chat_agent_dm SET replied_at = ? WHERE id = ?", now, row.id);
  return id ? [id] : [];
}

/** The teammate answered a card in the direct chat: the answer goes back to the agent, once. */
export async function onCardAnswered(ctx: ChatCtx, event: { name: string; payload: { taskId?: string; by?: string; note?: string; requestId?: string } }): Promise<string[]> {
  ensureAgentDm(ctx.db);
  const p = event.payload;
  const row = p.taskId ? rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE task = ?", p.taskId)[0] : p.requestId ? rows(ctx.db, "SELECT * FROM chat_agent_dm WHERE request = ?", p.requestId)[0] : undefined;
  if (!row || row.answeredAt !== null) return [];
  // a key request made in the person's chat is told to the agent there by the engine already (engine.key_request_answered)
  if (row.request && row.origin) return [];
  const name = first((await person(callOf(ctx), row.teammate))?.name ?? "Your teammate");
  const title = row.card?.title ?? "your request";
  const note = p.note?.trim() ? ` "${clip(p.note.trim(), 500)}"` : "";
  const text = event.name === "task.approved" ? `${name} ${row.card?.kind === "review" ? "reviewed it: looks good" : "approved"}: ${title}.${note}`
    : event.name === "vault.request_fulfilled" ? `${name} added the ${title} key.`
    : event.name === "vault.request_declined" ? `${name} did not add the ${title} key.${note}`
    : `${name} sent it back: ${title}.${note}`;
  const id = relay(ctx, row, text, { kind: "answer", from: row.teammate, ...(p.taskId ? { taskId: p.taskId } : {}), outcome: event.name });
  ctx.db.run("UPDATE chat_agent_dm SET answered_at = ? WHERE id = ?", ctx.now(), row.id);
  return id ? [id] : [];
}

/** A person's agent messages, oldest first (tests and the host read them). */
export const dmRows = (db: Db, person: string): DmRow[] => { ensureAgentDm(db); return rows(db, "SELECT * FROM chat_agent_dm WHERE person = ? ORDER BY created_at", person); };

// ---- a plain "send it" approves the card --------------------------------------------------------------------------------------------------------------

const YES = /^\s*(yes|yep|yeah|ok|okay|sure|go ahead|do it|send it|send that|please do|approved?)\b/i;

/**
 * The person answered a "Send this to <name>?" card in words (owner rule, Auto mode: a plain instruction in the person's own message is the approval). Their own typed message in the chat the card is in,
 * that says yes or asks to send to that teammate, presses the card for them: the held message goes, the card shows it was sent and approved in chat, and the agent's parked turn carries on. Only a person's
 * own typed words, from their own signed-in device, count; the press is theirs (tasks.act as them), so nothing is approved that they could not approve with a tap.
 */
export async function approveInChat(ctx: ChatCtx, threadId: string, body: string): Promise<string[]> {
  if (!ctx.call || ctx.principal.kind !== "person" || !threadId) return [];
  const asks = askedIn(body).filter((a) => a.act === "send");
  if (asks.length === 0 && !YES.test(body)) return [];
  const cards = (ctx.db.all("SELECT blocks FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 40", threadId) as Row[])
    .flatMap((r) => json<Array<{ type?: string; data?: { icon?: string; target?: { type?: string; id?: string } } }>>(r["blocks"], []))
    .filter((b) => b.type === "link_card" && b.data?.icon === "approval" && b.data.target?.type === "task" && typeof b.data.target.id === "string")
    .map((b) => b.data!.target!.id!);
  const done: string[] = [];
  for (const taskId of [...new Set(cards)]) {
    try {
      const t = ((await ctx.call("tasks.get", { taskId })) as { task?: { state?: string; approver?: { id?: string }; blocks?: Array<{ data?: { cap?: string; input?: { to?: string } } }> } }).task;
      const held = t?.blocks?.[0]?.data;
      if (!t || held?.cap !== "chat.message_person" || t.state !== "awaiting_approval" || t.approver?.id !== ctx.principal.id || typeof held.input?.to !== "string") continue;
      const to = held.input.to;
      const name = ((await person(callOf(ctx), to))?.name ?? "").toLowerCase();
      const parts = name.split(/\s+/).filter(Boolean);
      const covers = asks.length === 0 || asks.some((a) => a.target === "" || a.target === to || parts.includes(a.target) || parts.join(" ") === a.target);
      if (!covers) continue;
      await ctx.call("tasks.working_notes.set", { taskId, key: "approved_in", value: "chat" });
      await ctx.call("tasks.act", { taskId, action: "approve", note: "Approved in chat" });
      done.push(taskId);
    } catch (e) { ctx.log.warn("a plain yes did not press the card", { taskId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return done;
}
