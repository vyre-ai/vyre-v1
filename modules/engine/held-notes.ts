// Approvals wake Claude Code and Codex agents (lane l-runson; core-solid Wave 1). A CLI engine calls Vyre's tools over MCP: a call held at the Gate answers the engine at once ("held"), and its
// turn ends. When a person answers the hold, the agent's next turn is started with a note from Vyre as its input: what was held, who answered, and what it gave back. The note is the engine's
// input only, never a chat message, so nothing is put in a person's name; the chat gets a quiet line from the agent's turn status ("Approved by Olivia").
// A turn that parked on the hold itself (an API engine's, engine_waits) is resumed by the engine and is not touched here.
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../../agent/src/turn-engine/types.ts";

const pending = new Map<string, string[]>();
const key = (threadId: string, agentId: string): string => `${threadId}\u0000${agentId}`;

/** A note for the agent's next turn in this chat. */
export function queueHeldNote(threadId: string, agentId: string, text: string): void {
  const k = key(threadId, agentId);
  pending.set(k, [...(pending.get(k) ?? []), text].slice(-10));
}

/** The notes waiting for this agent in this chat, taken (each is given once). */
export function takeHeldNotes(threadId: string, agentId: string): string[] {
  const k = key(threadId, agentId);
  const v = pending.get(k) ?? [];
  pending.delete(k);
  return v;
}

/** The opener with the notes put on the next turn's input. */
export function withHeldNotes(open: OpenSession): OpenSession {
  return async (spec) => {
    const s = await open(spec);
    const send = (input: TurnInput): AsyncIterable<DriverEvent> => {
      const notes = takeHeldNotes(input.threadId, input.agent.id);
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
      ...(s.providerLatencyMs !== undefined ? { providerLatencyMs: s.providerLatencyMs } : {}),
    };
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
