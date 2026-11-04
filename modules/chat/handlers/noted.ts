// chat.noted (MEMORY-RULES 4): when memory remembers something in a place other people share, the room gets one quiet line, "Noted: decision, go with Harbor", with Undo. Nothing is remembered silently
// where others read. The line is one link_card (the shape the app already draws); Undo is memory.undo on the fact, named by the card's target.
import { ensure } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

const TITLE = 140;
const KINDS = new Set(["decision", "fact", "commitment", "preference", "question", "role"]);

export async function noted(ctx: ChatCtx, input: { threadId: string; factId: string; kind: string; text: string; replaces?: string; disputed?: boolean }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const kind = KINDS.has(input.kind) ? input.kind : "fact";
  const words = input.text.replace(/\s+/g, " ").trim();
  const title = words.length > TITLE ? `${words.slice(0, TITLE - 1)}…` : words;
  const lead = input.disputed ? `Noted: ${kind}, in question` : input.replaces ? `Noted: ${kind}, updated` : `Noted: ${kind}`;
  postLinkCard(ctx, t.id, { icon: "fact", lead, title, target: { type: "fact", id: input.factId }, actions: [{ key: "undo", label: "Undo" }] }, `${lead}, ${title}`);
  return { posted: true };
}
