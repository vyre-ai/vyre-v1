// memory.quote (memory ruling 1B and 3): exact recall, line by line. It asks the chat module for the words of every message and transcript row (turns, tool calls and results, which is what a run
// step is) that the ASKER could open themselves, and answers with the stored text, who wrote it, when, and a link that opens the chat scrolled to that line. Nothing is stored here and nothing
// is paraphrased: no card, no recall. Access is the chat module's (chat.history.search), run as the asker, so a person who was not in a chat never gets a line from it, not even through an agent.
import { actorOf, ensure, loadFact, makeAccess, raise } from "../projections.ts";
import { recallable } from "../../../lib/recall-intent.ts";
import { chatAudience } from "../../../lib/audience.ts";
import type { MemCtx } from "../projections.ts";

interface HistoryHit {
  source: "message" | "step"; ref: string; messageId?: string; threadId: string; threadTitle?: string; threadKind: string; seq: number; role: string;
  author: { kind: "person" | "agent" | "actor" | "service"; id: string }; text: string; truncated?: boolean; at: number; link: string; score: number;
}

export interface Quote {
  ref: string; source: "message" | "step"; text: string; truncated?: boolean; author: { kind: "person" | "agent" | "actor" | "service"; id: string; name?: string }; role: string; at: number;
  threadId: string; threadTitle?: string; threadKind?: string; link: string; score: number;
}

/** A person's or agent's name, when the asker may see it; cached for the call. */
async function nameOf(ctx: MemCtx, cache: Map<string, string | undefined>, a: { kind: string; id: string }): Promise<string | undefined> {
  if (cache.has(a.id)) return cache.get(a.id);
  let name: string | undefined;
  try {
    if (a.kind === "agent") name = ((await ctx.call("agents.get", { agentId: a.id })) as { agent?: { name?: string } }).agent?.name;
    else if (a.kind === "person") name = ((await ctx.call("search.resolve", { kind: "person", itemId: a.id })) as { hit?: { title?: string } }).hit?.title;
  } catch { name = undefined; }
  cache.set(a.id, name);
  return name;
}

export async function findQuotes(ctx: MemCtx, input: { q?: string; ref?: string; threadId?: string; excludeThreadId?: string; limit?: number; minCoverage?: number }): Promise<Quote[]> {
  ensure(ctx.db);
  const out = (await ctx.call("chat.history.search", input)) as { hits?: HistoryHit[] };
  const names = new Map<string, string | undefined>();
  const quotes: Quote[] = [];
  // The same words said twice in one chat (a message and the turn row that repeats it, or an agent that echoes the person) are one quote, credited to whoever said them first.
  const first = new Map<string, HistoryHit>();
  // a search by words never returns a greeting, a thanks or an imported session's pasted preamble: they say nothing. A line asked for by its ref is returned whatever it says.
  const hits = (out.hits ?? []).filter((h) => input.ref !== undefined || h.role.startsWith("tool") || recallable(h.text));
  for (const h of hits) {
    const key = `${h.threadId}\u0000${h.text.replace(/\s+/g, " ").trim().toLowerCase()}`;
    const at = first.get(key);
    if (!at || h.at < at.at) first.set(key, h);
  }
  const done = new Set<string>();
  for (const h0 of hits) {
    const key = `${h0.threadId}\u0000${h0.text.replace(/\s+/g, " ").trim().toLowerCase()}`;
    if (done.has(key)) continue;
    done.add(key);
    const h = first.get(key) ?? h0;
    const name = await nameOf(ctx, names, h.author);
    quotes.push({
      ref: h.ref, source: h.source, text: h.text, ...(h.truncated ? { truncated: true } : {}), author: { ...h.author, ...(name ? { name } : {}) }, role: h.role, at: h.at, threadId: h.threadId,
      ...(h.threadTitle ? { threadTitle: h.threadTitle } : {}), threadKind: h.threadKind, link: h.link, score: h.score,
    });
  }
  return quotes;
}

/**
 * A recalled fact is handed to the model with its fact id as the ref; asking for its exact words (rule 3: exact recall quotes the source span) answers with the words as the person wrote them,
 * who said them, when it was learned and where, if the asker may read the fact. Replaced and removed facts are quoted too, and say so.
 */
async function quoteOfFact(ctx: MemCtx, access: ReturnType<typeof makeAccess>, factId: string): Promise<Quote[]> {
  const f = loadFact(ctx, factId);
  if (!f || f.layer === "person" || f.state === "source_removed" || !(await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view", f.audience))) return [];
  const replaced = f.status === "closed" ? " (replaced by a later statement)" : f.state === "disputed" ? " (disputed: two people disagree)" : "";
  return [{
    ref: f.id, source: "message", text: `${f.span ?? f.text}${replaced}`, author: { kind: "person", id: f.sourcePerson }, role: "user", at: f.learnedAt, threadId: f.sourceRef,
    threadKind: f.sourceKind === "channel" ? "channel" : "chat", link: f.sourceLink ?? `/chats/${f.sourceRef}${f.msgId ? `?m=${f.msgId}` : ""}`, score: 1,
  }];
}

export async function quote(ctx: MemCtx, input: { q?: string; ref?: string; threadId?: string; excludeThreadId?: string; limit?: number; minCoverage?: number }) {
  if ((input.q === undefined || input.q.trim() === "") && !input.ref) raise(ctx, "validation.bad_input", "Say what to quote: some words to look for, or the ref of a line you were given.");
  actorOf(ctx);
  // a fact id as the ref: the exact words the fact was learned from
  if (input.ref?.startsWith("fct_")) return { quotes: await quoteOfFact(ctx, makeAccess(ctx, { ...(input.excludeThreadId !== undefined ? { thread: input.excludeThreadId } : {}) }), input.ref) };
  const quotes = await findQuotes(ctx, input);
  // words go into a chat only from a chat everyone there also reads (hole 8, the one memory check in makeAccess): recall names the chat it is for, and an agent's own tool call carries it.
  // A line asked for by its ref is held to the same rule: a ref is no way around it.
  const access = makeAccess(ctx, { ...(input.excludeThreadId !== undefined ? { thread: input.excludeThreadId } : {}) });
  const shown: Quote[] = [];
  // rule 8: a private chat that gained people keeps what was said before for the person who started it. Those earlier words go only into a chat nobody else reads.
  const sharedAt = new Map<string, { at: number; starter: string } | null>();
  const earlier = async (q: Quote): Promise<boolean> => {
    let s = sharedAt.get(q.threadId);
    if (s === undefined) {
      try {
        const th = ((await ctx.call("threads.get", { threadId: q.threadId })) as { thread?: { sharedAt?: unknown; starter?: unknown } }).thread;
        s = th && typeof th.sharedAt === "number" ? { at: th.sharedAt, starter: typeof th.starter === "string" ? th.starter : "" } : null;
      } catch { s = null; }
      sharedAt.set(q.threadId, s);
    }
    return s !== null && q.at < s.at;
  };
  for (const q of quotes) {
    if (!(await access.showsFrom(q.threadId))) continue;
    if (await earlier(q)) {
      const s = sharedAt.get(q.threadId)!;
      const room = input.excludeThreadId !== undefined ? await chatAudience((cap, i) => ctx.call(cap, i), input.excludeThreadId) : { space: false, people: [actorOf(ctx)] };
      if (room.space || room.people.some((p) => p !== s.starter)) continue;
    }
    shown.push(q);
  }
  return { quotes: shown };
}
