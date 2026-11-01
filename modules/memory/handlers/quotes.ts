// memory.quote (memory ruling 1B and 3): exact recall, line by line. It asks the chat module for the words of every message and transcript row (turns, tool calls and results, which is what a run
// step is) that the ASKER could open themselves, and answers with the stored text, who wrote it, when, and a link that opens the chat scrolled to that line. Nothing is stored here and nothing
// is paraphrased: no card, no recall. Access is the chat module's (chat.history.search), run as the asker, so a person who was not in a chat never gets a line from it, not even through an agent.
import { actorOf, ensure, raise } from "../projections.ts";
import { recallable } from "../../../lib/recall-intent.ts";
import type { MemCtx } from "../projections.ts";

interface HistoryHit {
  source: "message" | "step"; ref: string; messageId?: string; threadId: string; threadTitle?: string; threadKind: string; seq: number; role: string;
  author: { kind: "person" | "agent" | "actor" | "service"; id: string }; text: string; truncated?: boolean; at: number; link: string; score: number;
}

export interface Quote {
  ref: string; source: "message" | "step"; text: string; truncated?: boolean; author: { kind: "person" | "agent" | "actor" | "service"; id: string; name?: string }; role: string; at: number;
  threadId: string; threadTitle?: string; link: string; score: number;
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
      ...(h.threadTitle ? { threadTitle: h.threadTitle } : {}), link: h.link, score: h.score,
    });
  }
  return quotes;
}

export async function quote(ctx: MemCtx, input: { q?: string; ref?: string; threadId?: string; excludeThreadId?: string; limit?: number; minCoverage?: number }) {
  if ((input.q === undefined || input.q.trim() === "") && !input.ref) raise(ctx, "validation.bad_input", "Say what to quote: some words to look for, or the ref of a line you were given.");
  actorOf(ctx);
  return { quotes: await findQuotes(ctx, input) };
}
