// @reads /modules/chat/migrations/0005_note_offer.sql
// "Save as a note?" (owner idea 4 Nov 2026): when something in a chat is worth keeping (a link, an answer to keep, a decision, a snippet, an address) the agent can offer a small card, once, with a
// preview of the note. Save makes a private note in the person's Notes that links back to that message; Not now closes the card and is remembered.
//   chat.note_offer.make     the agent's tool (offer_note). Written by Vyre itself: an agent cannot post this card with chat.post, so every offer passes the rules here.
//   rules                    the person's switch Offer to save useful things from chats as notes (Settings, Notes) is on; the same topic is offered at most once in a chat; never within 15 minutes of
//                            another offer in that chat; never in a chat where the person said Not now in the last day. Anything else answers offered false with the reason, and the agent carries on.
//   chat.note_offer.answer   the person's Save or Not now. Save calls notes.create as the person, saved from this chat and message, so the note is theirs and private, whoever else reads the chat.
//   privacy                  the note holds only what the offer shows (the preview the person read before pressing Save). The card and the note are the person's: the chat shows a quiet "Saved to Notes"
//                            line to everyone who reads the chat, with no title, and the link back opens only for people who can read the chat.
import { readFileSync } from "node:fs";
import { askerOf, blockBy, ensure, insertBlock, insertMessage, mintId, messageBy, patchBlockInMessage, raise, threadBy } from "../projections.ts";
import type { ChatCtx, Db, ThreadRec } from "../projections.ts";
import { canSpeak, deliver } from "./post.ts";

const SCHEMA = readFileSync(new URL("../migrations/0005_note_offer.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();
function ensureOffers(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  try { db.all("SELECT id FROM chat_note_offer WHERE id = ?", "probe"); } catch { for (const s of SCHEMA) db.run(s); }
  ready.add(db);
}

const MIN = 60_000;
export const TOO_SOON_MS = 15 * MIN;
export const DECLINED_MS = 24 * 60 * MIN;
const MAX_TITLE = 200;
const MAX_BODY = 4_000;
type Row = Record<string, unknown>;
export type Why = "off" | "already_offered" | "too_soon" | "declined_recently";
export const topicKey = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

function visible(ctx: ChatCtx, threadId: string): ThreadRec {
  const t = threadBy(ctx.db, threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  return t;
}

/** The person's switch; a setting that cannot be read leaves offers on, as the person last saw it. */
async function offersOn(ctx: ChatCtx): Promise<boolean> {
  try {
    const r = (await ctx.call?.("settings.get", { key: "notes.offers" })) as { row?: { value?: unknown } } | null | undefined;
    return r?.row?.value !== false;
  } catch { return true; }
}

export async function make(ctx: ChatCtx, input: { threadId: string; title: string; body: string; topic: string; messageId?: string }): Promise<{ offered: boolean; why?: Why; blockId?: string; messageId?: string }> {
  ensureOffers(ctx.db);
  const t = visible(ctx, input.threadId);
  const person = askerOf(ctx);
  if (ctx.principal.kind !== "agent" || !person.startsWith("usr_")) raise(ctx, "permission.no_grant", "An agent offers a person a note.");
  const title = input.title.trim();
  const body = input.body.trim();
  const topic = topicKey(input.topic);
  if (title === "" || title.length > MAX_TITLE) raise(ctx, "validation.bad_input", `A note offer needs a title of up to ${MAX_TITLE} characters.`);
  if (body === "" || body.length > MAX_BODY) raise(ctx, "validation.bad_input", `A note offer needs the note's words, at most ${MAX_BODY} characters.`);
  if (topic === "") raise(ctx, "validation.bad_input", "Say what the offer is about, in a few words.");
  if (input.messageId !== undefined) {
    const m = messageBy(ctx.db, input.messageId);
    if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  }
  if (!(await offersOn(ctx))) return { offered: false, why: "off" };
  const now = ctx.now();
  if ((ctx.db.all('SELECT id FROM chat_note_offer WHERE thread = ? AND person = ? AND topic = ?', t.id, person, topic) as Row[]).length > 0) return { offered: false, why: "already_offered" };
  const recent = ctx.db.all('SELECT state, created_at FROM chat_note_offer WHERE thread = ? AND person = ? ORDER BY created_at DESC', t.id, person) as Row[];
  const last = recent[0];
  if (last && now - Number(last["created_at"]) < TOO_SOON_MS) return { offered: false, why: "too_soon" };
  if (recent.some((r) => String(r["state"]) === "dismissed" && now - Number(r["created_at"]) < DECLINED_MS)) return { offered: false, why: "declined_recently" };

  const blockId = mintId("blk", now);
  const data: Record<string, unknown> = { threadId: t.id, blockId, person, title, body, topic, state: "offered", ...(input.messageId ? { messageId: input.messageId } : {}) };
  const m = insertMessage(ctx, t.id, { author: ctx.principal.id, kind: ctx.principal.kind === "agent" ? "agent" : "text", body: "", blocks: [{ type: "note_offer", v: 1, id: blockId, data, state: "done", traceId: ctx.trace.traceId }] });
  insertBlock(ctx, { id: blockId, thread: t.id, message: m.id, type: "note_offer", data });
  ctx.db.run("UPDATE chat_block SET state = 'done' WHERE id = ?", blockId);   // nothing waits on it: the turn goes on
  deliver(ctx, t, m, [], { kind: ctx.principal.kind, id: ctx.principal.id }, { notify: false });
  ctx.db.run('INSERT INTO chat_note_offer (id, thread, person, topic, block, message, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', mintId("nof", now), t.id, person, topic, blockId, m.id, "offered", now);
  return { offered: true, blockId, messageId: m.id };
}

export async function answer(ctx: ChatCtx, input: { threadId: string; blockId: string; decision: "save" | "dismiss" }): Promise<{ state: "saved" | "dismissed"; noteId?: string }> {
  ensureOffers(ctx.db);
  const block = blockBy(ctx.db, input.blockId);
  const t = threadBy(ctx.db, input.threadId);
  if (!block || !t || block.thread !== t.id || block.type !== "note_offer" || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That offer does not exist.");
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "Only the person it was offered to answers it.");
  const person = askerOf(ctx);
  const row = (ctx.db.all("SELECT * FROM chat_note_offer WHERE block = ?", block.id) as Row[])[0];
  if (!row || String(row["person"]) !== person) raise(ctx, "validation.not_found", "That offer does not exist.");
  // answering twice is the same answer; the other answer comes too late
  const was = String(row["state"]);
  if (was !== "offered") {
    const again = input.decision === "save" ? "saved" : "dismissed";
    if (was === again) return { state: again, ...(row["note"] ? { noteId: String(row["note"]) } : {}) };
    raise(ctx, "validation.precondition_failed", "That offer was already answered.", { reason: "closed" });
  }
  const data = block.data as { title?: string; body?: string; messageId?: string };
  const now = ctx.now();
  if (input.decision === "dismiss") {
    ctx.db.run("UPDATE chat_note_offer SET state = 'dismissed', answered_at = ? WHERE block = ?", now, block.id);
    patchBlockInMessage(ctx.db, block.message, block.id, (b) => ({ ...b, data: { ...(b["data"] as Record<string, unknown>), state: "dismissed" } }));
    return { state: "dismissed" };
  }
  // the person's own note, saved from this chat and the message the offer is about (else the offer itself)
  const made = (await ctx.call?.("notes.create", {
    title: String(data.title ?? ""), body: String(data.body ?? ""), source: { threadId: t.id, messageId: data.messageId ?? block.message }, idempotencyKey: `offer:${block.id}`,
  })) as { note?: { noteId?: string } } | null;
  const noteId = made?.note?.noteId;
  if (!noteId) raise(ctx, "internal.unexpected", "The note could not be saved.");
  ctx.db.run("UPDATE chat_note_offer SET state = 'saved', note = ?, answered_at = ? WHERE block = ?", noteId, now, block.id);
  patchBlockInMessage(ctx.db, block.message, block.id, (b) => ({ ...b, data: { ...(b["data"] as Record<string, unknown>), state: "saved", noteId } }));
  return { state: "saved", noteId };
}

export const noteOfferHandlers = { "chat.note_offer.make": make, "chat.note_offer.answer": answer };
