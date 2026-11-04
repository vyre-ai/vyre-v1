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
  const lead = `Noted: ${kind}`;
  const cut = (x: string): string => { const w = x.replace(/\s+/g, " ").trim(); return w.length > 60 ? `${w.slice(0, 59)}…` : w; };
  // the words that differ between two statements about one thing: "Thursday" against "Friday"
  const tok = (x: string): string[] => x.replace(/[.,;:!?"]/g, "").split(/\s+/).filter((w) => w !== "");
  const diff = (a: string, b: string): string => {
    const other = new Set(tok(b).map((w) => w.toLowerCase()));
    const d = tok(a).filter((w) => !other.has(w.toLowerCase())).join(" ");
    const v = d !== "" ? d : cut(a);
    return `${v.charAt(0).toUpperCase()}${v.slice(1)}`;
  };
  if (input.question) {
    // "Maya said Thursday on Monday. Omar said Friday today. Which holds?": both people, by name, what they said, and when; the answers are the two values
    const q = input.question;
    const name = async (id: string): Promise<string> => {
      try { return (((await ctx.call?.("search.resolve", { kind: "person", itemId: id })) as { hit?: { title?: string } } | undefined)?.hit?.title) ?? "Someone"; } catch { return "Someone"; }
    };
    const when = (at: number): string => (new Date(at).toISOString().slice(0, 10) === new Date(ctx.now()).toISOString().slice(0, 10) ? "today" : `on ${DAYS[new Date(at).getUTCDay()]}`);
    const [na, nb] = [await name(q.a.by), await name(q.b.by)];
    const [va, vb] = [diff(q.a.text, q.b.text), diff(q.b.text, q.a.text)];
    postLinkCard(ctx, t.id, {
      icon: "fact", lead: "Open question", title: `${na.split(" ")[0]} and ${nb.split(" ")[0]} disagree`, sub: "Which holds? Vyre will not guess.", style: "question",
      body: `${na} said ${va} ${when(q.a.at)}.\n${nb} said ${vb} ${when(q.b.at)}.`,
      actions: [{ key: "a", label: va, cap: "memory.question.resolve", input: { questionId: q.questionId, resolution: "keep_a" } }, { key: "b", label: vb, cap: "memory.question.resolve", input: { questionId: q.questionId, resolution: "keep_b" } }],
    }, `Open question: ${va} or ${vb}`);
    return { posted: true };
  }
  postLinkCard(ctx, t.id, { icon: "fact", lead, title, style: "noted", target: { type: "fact", id: input.factId }, actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: input.factId } }] }, `${lead}, ${title}`);
  return { posted: true };
}
