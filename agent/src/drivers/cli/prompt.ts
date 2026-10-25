// What a CLI engine is sent for one turn. A resumed engine session already holds what it said and was told, so it gets only what happened in the thread since its own last reply;
// a fresh one (no session to resume, or a switch from another engine) gets the recent thread. The canonical transcript (agent/src/transcript) decides when to roll a session over.
import type { StoredMessage, TurnInput } from "../../turn-engine/types.ts";

const MAX_MESSAGES = 40;
const MAX_CHARS = 20_000;

const say = (m: StoredMessage): string => `${m.author.id}: ${m.body}`;

export function defaultPrompt(input: TurnInput, fresh: boolean, steered: readonly StoredMessage[] = []): string {
  const self = input.agent.id;
  const trigger = input.trigger;
  const rows = input.history.filter((m) => m.id !== trigger?.id && m.body.trim() !== "");
  let last = -1;
  if (!fresh) rows.forEach((m, i) => { if (m.author.kind === "agent" && m.author.id === self) last = i; });
  let context = rows.slice(last + 1).slice(-MAX_MESSAGES).map(say).join("\n");
  if (context.length > MAX_CHARS) context = context.slice(-MAX_CHARS);
  const parts: string[] = [];
  if (context !== "") parts.push(`${fresh ? "Earlier in this thread" : "Since your last reply"}:\n${context}`);
  if (input.resumed) {
    const r = input.resumed;
    parts.push(`(${r.toolName} was ${r.approved ? "approved" : "declined"}.)`);
  }
  for (const m of steered) parts.push(say(m));
  if (trigger && trigger.body.trim() !== "") parts.push(trigger.author.id === input.asker && trigger.author.kind === "person" ? trigger.body : say(trigger));
  return parts.length > 0 ? parts.join("\n\n") : "(continue)";
}
