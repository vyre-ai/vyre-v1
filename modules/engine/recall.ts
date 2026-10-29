// Per-message recall (spec 2.15): before a turn runs, ask the memory module what it knows that matches the message, as the person who wrote it, and hand the lines to the driver on the turn input.
// A person's own layer is only ever read for that person (the call acts for the asker). A memory that is slow, off or failing never holds a turn up: the turn runs without the lines.
import type { EngineSession, OpenSession, RecallLine, TurnInput } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

const QUOTES = 3;
const QUOTE_CHARS = 320;

interface QuoteRow { ref: string; text: string; author: { id: string; name?: string }; at: number; threadTitle?: string; threadId: string; link: string }

/** The lines memory recalls for the message that caused this turn: facts from the pointer and the exact words of past chat lines, both as the asker; none for a wake, a resumed call or a message nobody wrote. */
export async function recallFor(call: Call, input: TurnInput): Promise<RecallLine[]> {
  const t = input.trigger;
  if (input.resumed || !t || t.author.kind !== "person" || t.body.trim() === "") return [];
  const facts = (async (): Promise<RecallLine[]> => {
    try {
      const out = (await call("memory.pointer", { threadId: input.threadId, agentId: input.agent.id, text: t.body }, input.asker)) as { lines?: RecallLine[] };
      return out.lines ?? [];
    } catch { return []; }
  })();
  const quotes = (async (): Promise<RecallLine[]> => {
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
