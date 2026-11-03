// What a CLI engine is sent for one turn. A resumed engine session already holds what it said and was told, so it gets only what happened in the thread since its own last reply;
// a fresh one (no session to resume, or a switch from another engine) gets the recent thread. The canonical transcript (agent/src/transcript) decides when to roll a session over.
import { contextPrompt, speaker } from "../../turn-engine/context.ts";
import type { TurnContext } from "../../turn-engine/context.ts";
import { recallText } from "../../turn-engine/recall.ts";
import type { StoredMessage, TurnInput } from "../../turn-engine/types.ts";

const MAX_MESSAGES = 40;
const MAX_CHARS = 20_000;

const say = (m: StoredMessage, ctx?: TurnContext): string => `${speaker(ctx, m.author.id)}: ${m.body}`;

/**
 * `sent` is what a resumed session already holds of the turn context (section id to hash): the caller keeps one per session, so a stable section is sent once and again only when it changes.
 */
export function defaultPrompt(input: TurnInput, fresh: boolean, steered: readonly StoredMessage[] = [], sent?: Map<string, string>): string {
  const self = input.agent.id;
  const trigger = input.trigger;
  const rows = input.history.filter((m) => m.id !== trigger?.id && m.body.trim() !== "");
  let last = -1;
  if (!fresh) rows.forEach((m, i) => { if (m.author.kind === "agent" && m.author.id === self) last = i; });
  let context = rows.slice(last + 1).slice(-MAX_MESSAGES).map((m) => say(m, input.context)).join("\n");
  if (context.length > MAX_CHARS) context = context.slice(-MAX_CHARS);
  const parts: string[] = [];
  const front = contextPrompt(input.context, fresh, sent);
  if (front !== "") parts.push(front);
  if (context !== "") parts.push(`${fresh ? "Earlier in this thread" : "Since your last reply"}:\n${context}`);
  if (input.resumed) {
    const r = input.resumed;
    // a declined call carries the person's reason in the result's message; the agent reads it
    const why = !r.approved && typeof (r.result.content as { message?: unknown } | null)?.message === "string" ? ` ${(r.result.content as { message: string }).message}` : "";
    parts.push(`(${r.toolName} was ${r.approved ? "approved" : "declined"}.${why})`);
  }
  if (input.handover) {
    // the same turn, going on after the computer it started on went away: what is done stays done
    const h = input.handover;
    const said = h.said.trim() === "" ? "" : ` You had already written: """${h.said.length > 4000 ? `...${h.said.slice(-4000)}` : h.said}"""`;
    const steps = h.steps.length === 0 ? " You had not used any tool yet." : ` Steps you had already taken, in order: ${h.steps.slice(-40).join(", ")}.`;
    parts.push(`(You started answering the message below on ${h.from}, which went to sleep. You are going on from where you stopped.${said}${steps} Do not repeat a step that is done; continue the answer.)`);
  }
  for (const m of steered) parts.push(say(m, input.context));
  const recalled = input.recall ? recallText(input.recall) : "";
  if (recalled !== "") parts.push(recalled);
  if (trigger && trigger.body.trim() !== "") parts.push(trigger.author.id === input.asker && trigger.author.kind === "person" ? trigger.body : say(trigger, input.context));
  return parts.length > 0 ? parts.join("\n\n") : "(continue)";
}
