// Per-message recall (spec 2.15): before a turn runs, ask the memory module what it knows that matches the message, as the person who wrote it, and hand the lines to the driver on the turn input.
// A person's own layer is only ever read for that person (the call acts for the asker). A memory that is slow, off or failing never holds a turn up: the turn runs without the lines.
import { asksForWords, recallable } from "../../lib/recall-intent.ts";
import type { EngineSession, OpenSession, RecallLine, TurnInput } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

const QUOTES = 3;
const QUOTE_CHARS = 320;

interface QuoteRow { ref: string; text: string; author: { id: string; name?: string }; at: number; threadTitle?: string; threadId: string; link: string }

/** The lines memory recalls for the message that caused this turn: facts from the pointer and the exact words of past chat lines, both as the asker; none for a wake, a resumed call or a message nobody wrote. */
export async function recallFor(call: Call, input: TurnInput): Promise<RecallLine[]> {
  const t = input.trigger;
  // a greeting, thanks, a few words or an imported session's preamble is not something to recall against: nothing comes back for it, facts or quotes
  if (input.resumed || !t || t.author.kind !== "person" || !recallable(t.body)) return [];
  const facts = (async (): Promise<RecallLine[]> => {
    try {
      const out = (await call("memory.pointer", { threadId: input.threadId, agentId: input.agent.id, text: t.body }, input.asker)) as { lines?: RecallLine[] };
      return out.lines ?? [];
    } catch { return []; }
  })();
  // exact words of earlier chats come back only when the person asked to find what was said; otherwise every message would be matched against everything ever typed
  const quotes = (async (): Promise<RecallLine[]> => {
    if (!asksForWords(t.body)) return [];
    try {
      const out = (await call("memory.quote", { q: t.body, excludeThreadId: input.threadId, limit: QUOTES, minCoverage: 0.6 }, input.asker)) as { quotes?: QuoteRow[] };
      return (out.quotes ?? []).map((q): RecallLine => {
        // a quote is one line of the block: its line breaks are written as \n so the words stay exact and a quoted list cannot pass for the block's own lines
        const flat = q.text.replace(/\r?\n/g, "\\n");
        const cut = flat.length > QUOTE_CHARS;
        return {
          kind: "quote", ref: q.ref, title: q.threadTitle ? `"${q.threadTitle}"` : "an earlier chat", fact: cut ? `${flat.slice(0, QUOTE_CHARS)}...` : flat, path: q.link, sourceLink: q.link,
          by: q.author.id === input.asker ? "you" : q.author.name ?? q.author.id, at: q.at, ...(cut ? { cut: true } : {}),
        };
      });
    } catch { return []; }
  })();
  const [f, q] = await Promise.all([facts, quotes]);
  // What was handed to the model is written down by source id, so the chat can say "Used N memories" and show them. A failing record never holds the turn up.
  const lines = [...f.filter((l) => l.ref).map((l) => ({ kind: "fact" as const, ref: l.ref as string })), ...q.filter((l) => l.ref).map((l) => ({ kind: "quote" as const, ref: l.ref as string }))];
  if (lines.length > 0) await call("memory.recall.record", { threadId: input.threadId, messageId: t.id, agentId: input.agent.id, lines }, input.asker).catch(() => undefined);
  return [...f, ...q];
}

/** An OpenSession whose sessions get the recall on every send. */
export function withRecall(open: OpenSession, call: Call): OpenSession {
  return async (spec) => {
    const session = await open(spec);
    return Object.create(session, {
      send: {
        value: (input: TurnInput) => (async function* () {
          const lines = await recallFor(call, input);
          yield* session.send(lines.length > 0 ? { ...input, recall: lines } : input);
        })(),
      },
    }) as EngineSession;
  };
}
