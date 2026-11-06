// The question island's model: the open questions agents asked in this chat, oldest first, the newest showing. An open question is a question block still waiting for an answer, with options or in words;
// a terminal ask and a mount ask have their own cards in the list and are not here. Pure.
import { questionOptions, terminalAskOf } from "./model.ts";
import { mountOffers } from "./mountcard.ts";
import type { Message, QuestionOption } from "./model.ts";

export interface OpenQuestion {
  /** The question block's id: what chat.answer_block answers. */
  id: string;
  /** The agent that asked. */
  agentId: string;
  prompt: string;
  options: readonly QuestionOption[];
  at: number;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Every question a chat is waiting on, oldest first. */
export function openQuestions(messages: readonly Message[]): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  for (const m of messages) {
    if (m.author.kind !== "agent") continue;
    for (const b of m.blocks) {
      if (b.type !== "question" || b.state !== "waiting") continue;
      const d = (b.data ?? {}) as Record<string, unknown>;
      if (d["answer"] !== undefined || terminalAskOf(d) !== null) continue;
      const options = questionOptions(d);
      if (mountOffers(options) !== null) continue;
      const prompt = text(d["prompt"]) || text(d["title"]);
      if (prompt === "") continue;
      out.push({ id: b.id, agentId: m.author.id, prompt, options, at: m.createdAt });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The ones not put away, with the index that shows: the newest unless the person stepped to another. A put-away question is not in the list. */
export function islandView(all: readonly OpenQuestion[], dismissed: ReadonlySet<string>, picked: string | null): { list: OpenQuestion[]; index: number } {
  const list = all.filter((q) => !dismissed.has(q.id));
  const at = picked === null ? -1 : list.findIndex((q) => q.id === picked);
  return { list, index: at >= 0 ? at : list.length - 1 };
}
