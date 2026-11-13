// Approvals wake Claude Code and Codex agents (lane l-runson; core-solid Wave 1). A CLI engine calls Vyre's tools over MCP: a call held at the Gate answers the engine at once ("held"), and its
// turn ends. When a person answers the hold, the agent's next turn is started with a note from Vyre as its input: what was held, who answered, and what it gave back. The note is the engine's
// input only, never a chat message, so nothing is put in a person's name; the chat gets a quiet line from the agent's turn status ("Approved by Olivia").
// A turn that parked on the hold itself (an API engine's, engine_waits) is resumed by the engine and is not touched here.
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../../agent/src/turn-engine/types.ts";

const pending = new Map<string, string[]>();
// A note is for the turn of the person whose held call or review it answers (lib/agent-asker.ts): another person who writes to the same agent in the same chat must not receive what the first one's held
// call gave back. A routine's or a watcher's note belongs to nobody and goes to whoever's turn is next.
const key = (threadId: string, agentId: string, person: string): string => `${threadId}\u0000${agentId}\u0000${person}`;

/** A note for the agent's next turn in this chat, for `person`'s turn (omitted: for any turn). */
export function queueHeldNote(threadId: string, agentId: string, text: string, person = ""): void {
  const k = key(threadId, agentId, person);
  pending.set(k, [...(pending.get(k) ?? []), text].slice(-10));
}

/** The notes waiting for this agent in this chat for this asker, and the ones for nobody, taken (each is given once). With no asker (the server waking the agent): every note. */
export function takeHeldNotes(threadId: string, agentId: string, asker?: string): string[] {
  const out: string[] = [];
  const prefix = `${threadId}\u0000${agentId}\u0000`;
  for (const [k, v] of [...pending]) {
    if (!k.startsWith(prefix)) continue;
    const who = k.slice(prefix.length);
    if (asker !== undefined && who !== "" && who !== asker) continue;
    out.push(...v);
    pending.delete(k);
  }
  return out;
}

/** The opener with the notes put on the next turn's input. */
export function withHeldNotes(open: OpenSession): OpenSession {
  return async (spec) => {
    const s = await open(spec);
    const send = (input: TurnInput): AsyncIterable<DriverEvent> => {
      const notes = takeHeldNotes(input.threadId, input.agent.id, input.asker);
      return s.send(notes.length === 0 ? input : { ...input, notice: [...(input.notice ? [input.notice] : []), ...notes].join("\n") });
    };
    // a plain wrapper: some sessions are frozen, so a Proxy may not answer for `send`
    const out: EngineSession = {
      send,
      sendToolResult: (id, r) => s.sendToolResult(id, r),
      inject: (m) => s.inject(m),
      cancel: () => s.cancel(),
      close: () => s.close(),
      get warm() { return s.warm; },
      // the model that really runs is the inner session's word (a turn moved to another model records that one, not the one asked for)
      get model() { return (s as { model?: string }).model; },
      ...(s.providerLatencyMs !== undefined ? { providerLatencyMs: s.providerLatencyMs } : {}),
    } as EngineSession;
    return out;
  };
}

/** The note an agent is given. `result` is what the held call answered (cut short); `note` is why it was declined. */
export function heldNote(o: { approved: boolean; cap: string; by: string; result?: unknown; note?: string }): string {
  const what = o.cap.replace(/[._]/g, " ");
  if (!o.approved) return `Your held call ${what} was declined by ${o.by}${o.note ? `: ${o.note}` : ""}. It did not run. Go on without it.`;
  let said = "";
  if (o.result !== undefined && o.result !== null) { try { said = JSON.stringify(o.result); } catch { said = ""; } }
  return `Your held call ${what} was approved by ${o.by} and ran${said ? `: ${said.length > 600 ? `${said.slice(0, 600)}...` : said}` : ""}. Carry on from there.`;
}
