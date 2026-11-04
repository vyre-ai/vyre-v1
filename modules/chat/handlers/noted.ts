// chat.noted (MEMORY-RULES 4): when memory remembers something in a place other people share, the room gets one quiet line, "Noted: decision, go with Harbor", with Undo. Nothing is remembered silently
// where others read. The line is one link_card (the shape the app already draws); Undo is memory.undo on the fact, named by the card's target.
import { ensure } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

interface Said { text: string; by: string; at: number }
const TITLE = 140;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const KINDS = new Set(["decision", "fact", "commitment", "preference", "question", "role"]);

export async function noted(ctx: ChatCtx, input: { threadId: string; factId: string; kind: string; text: string; replaces?: string; disputed?: boolean; question?: { questionId: string; a: Said; b: Said } }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const kind = KINDS.has(input.kind) ? input.kind : "fact";
  const words = input.text.replace(/\s+/g, " ").trim();
  const title = words.length > TITLE ? `${words.slice(0, TITLE - 1)}…` : words;
  const lead = input.disputed ? `Noted: ${kind}, in question` : input.replaces ? `Noted: ${kind}, updated` : `Noted: ${kind}`;
  const cut = (x: string): string => { const w = x.replace(/\s+/g, " ").trim(); return w.length > 60 ? `${w.slice(0, 59)}…` : w; };
  if (input.question) {
    // "Maya said on Monday: ... Omar said today: ... Which holds?": both people, by name, and when
    const q = input.question;
    const name = async (id: string): Promise<string> => {
      try { return (((await ctx.call?.("search.resolve", { kind: "person", itemId: id })) as { hit?: { title?: string } } | undefined)?.hit?.title) ?? "Someone"; } catch { return "Someone"; }
    };
    const when = (at: number): string => (new Date(at).toISOString().slice(0, 10) === new Date(ctx.now()).toISOString().slice(0, 10) ? "today" : `on ${DAYS[new Date(at).getUTCDay()]}`);
    const say = async (x: Said): Promise<string> => `${await name(x.by)} said ${when(x.at)}: ${cut(x.text)}`;
    postLinkCard(ctx, t.id, {
      icon: "fact", lead: "Open question", title: "Two statements about one thing", body: `${await say(q.a)}\n${await say(q.b)}\nWhich holds?`,
      actions: [{ key: "a", label: `${(await name(q.a.by)).split(" ")[0]}: ${cut(q.a.text)}`, cap: "memory.question.resolve", input: { questionId: q.questionId, resolution: "keep_a" } }, { key: "b", label: `${(await name(q.b.by)).split(" ")[0]}: ${cut(q.b.text)}`, cap: "memory.question.resolve", input: { questionId: q.questionId, resolution: "keep_b" } }],
    }, `Open question: ${cut(q.a.text)} or ${cut(q.b.text)}`);
    return { posted: true };
  }
  postLinkCard(ctx, t.id, { icon: "fact", lead, title, target: { type: "fact", id: input.factId }, actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: input.factId } }] }, `${lead}, ${title}`);
  return { posted: true };
}
