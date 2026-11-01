// "Catch me up" (rc.9 flow 3): what a person missed in a thread, read from their cursor. A plain read of the messages after it, no model and no cost, so it is the same for everyone who read as far.
// The answer is kept per thread, person, cursor and newest message: opening the thread again without anything new reads it from there.
import { askerOf } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";

const MAX_LOOK = 400;
const MAX_AT = 20;
const kept = new Map<string, unknown>();

type Row = Record<string, unknown>;
const snip = (s: string): string => { const one = s.replace(/\s+/g, " ").trim(); return one.length > 120 ? `${one.slice(0, 117)}...` : one; };

export async function catchUp(ctx: ChatCtx, input: { threadId: string }) {
  const t = load(ctx, input.threadId);
  const me = askerOf(ctx);
  const cur = Number(((ctx.db.all("SELECT seq FROM chat_thread_read WHERE thread = ? AND principal = ?", t.id, me) as Row[])[0] ?? {})["seq"] ?? 0);
  const rows = ctx.db.all('SELECT id, threadSeq, author, kind, body, blocks, pinned FROM chat_message WHERE "thread" = ? AND threadSeq > ? AND author <> ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT ?', t.id, cur, me, MAX_LOOK) as Row[];
  const top = rows.length > 0 ? Number(rows[0]!["threadSeq"]) : cur;
  const key = `${t.id}|${me}|${cur}|${top}|${rows.length}`;
  const hit = kept.get(key);
  if (hit) return hit;
  rows.reverse();
  const who = new Map<string, number>();
  const tasks: Array<{ messageId: string; title: string }> = [];
  const decisions: Array<{ messageId: string; text: string }> = [];
  const at: Array<{ messageId: string; author: string; text: string }> = [];
  for (const r of rows) {
    const author = String(r["author"]);
    if (String(r["kind"]) !== "system") who.set(author, (who.get(author) ?? 0) + 1);
    const body = String(r["body"] ?? "");
    let blocks: Array<{ type?: string; data?: { target?: { type?: string }; lead?: string; title?: string } }> = [];
    try { blocks = JSON.parse(String(r["blocks"] ?? "[]")); } catch { blocks = []; }
    const card = blocks.find((b) => b.type === "link_card")?.data;
    if (card?.target?.type === "task") tasks.push({ messageId: String(r["id"]), title: snip(card.title ?? "") });
    else if (card?.target?.type === "fact") decisions.push({ messageId: String(r["id"]), text: snip(card.title ?? "") });
    else if (Number(r["pinned"] ?? 0) === 1) decisions.push({ messageId: String(r["id"]), text: snip(body) });
    if (body.includes("@") && at.length < MAX_AT && String(r["kind"]) !== "system") at.push({ messageId: String(r["id"]), author, text: snip(body) });
  }
  const out = {
    unread: rows.length, since: cur, top,
    people: [...who.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ id, count: n })),
    tasks: tasks.slice(0, 5), decisions: decisions.slice(0, 5), at,
    firstMessageId: rows.length > 0 ? String(rows[0]!["id"]) : null,
  };
  if (kept.size > 500) kept.clear();
  kept.set(key, out);
  return out;
}
