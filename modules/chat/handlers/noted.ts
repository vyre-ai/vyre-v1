// chat.noted (MEMORY-RULES 4): when memory remembers something in a place other people share, the room gets one quiet line, "Noted: decision, go with Harbor", with Undo. Nothing is remembered silently
// where others read. The line is one link_card (the shape the app already draws); Undo is memory.undo on the fact, named by the card's target.
import { ensure } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

const TITLE = 140;
const KINDS = new Set(["decision", "fact", "commitment", "preference", "question", "role"]);

export async function noted(ctx: ChatCtx, input: { threadId: string; factId: string; kind: string; text: string; replaces?: string; disputed?: boolean; question?: { questionId: string; a: string; b: string } }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const kind = KINDS.has(input.kind) ? input.kind : "fact";
  const words = input.text.replace(/\s+/g, " ").trim();
  const title = words.length > TITLE ? `${words.slice(0, TITLE - 1)}…` : words;
  const lead = input.disputed ? `Noted: ${kind}, in question` : input.replaces ? `Noted: ${kind}, updated` : `Noted: ${kind}`;
  const cut = (x: string): string => { const w = x.replace(/\s+/g, " ").trim(); return w.length > 60 ? `${w.slice(0, 59)}…` : w; };
  if (input.question) {
    // two people said different things: one open question with a choice for each, answered by memory.question.resolve (the older answer is replaced)
    const q = input.question;
    postLinkCard(ctx, t.id, {
      icon: "fact", lead: "Open question", title: "Two statements about one thing", body: `One said: ${cut(q.a)}\nAnother said: ${cut(q.b)}\nWhich holds?`,
      actions: [{ key: "a", label: cut(q.a), cap: "memory.question.resolve", input: { questionId: q.questionId, resolution: "keep_a" } }, { key: "b", label: cut(q.b), cap: "memory.question.resolve", input: { questionId: q.questionId, resolution: "keep_b" } }],
    }, `Open question: ${cut(q.a)} or ${cut(q.b)}`);
    return { posted: true };
  }
  postLinkCard(ctx, t.id, { icon: "fact", lead, title, target: { type: "fact", id: input.factId }, actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: input.factId } }] }, `${lead}, ${title}`);
  return { posted: true };
}
