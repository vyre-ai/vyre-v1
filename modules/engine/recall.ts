// Per-message recall (spec 2.15): before a turn runs, ask the memory module what it knows that matches the message, as the person who wrote it, and hand the lines to the driver on the turn input.
// A person's own layer is only ever read for that person (the call acts for the asker). A memory that is slow, off or failing never holds a turn up: the turn runs without the lines.
import type { EngineSession, OpenSession, RecallLine, TurnInput } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** The lines memory recalls for the message that caused this turn; none for a wake, a resumed call or a message nobody wrote. */
export async function recallFor(call: Call, input: TurnInput): Promise<RecallLine[]> {
  const t = input.trigger;
  if (input.resumed || !t || t.author.kind !== "person" || t.body.trim() === "") return [];
  try {
    const out = (await call("memory.pointer", { threadId: input.threadId, agentId: input.agent.id, text: t.body }, input.asker)) as { lines?: RecallLine[] };
    return out.lines ?? [];
  } catch { return []; }
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
