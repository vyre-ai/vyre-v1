// The round table (chat gap G57, DESIGN-chat-system "Discussions"): when a message asked several agents and each answered on its own, the answers sit on one card, a tab per agent, and the person
// goes with one. Pure: the answers are read from the chat's own messages (each agent's first message after the ask), so nothing is stored and a reload shows the same card.
export interface RoundMessage {
  messageId: string;
  threadSeq: number;
  author: { kind: string; id: string };
  body: string;
  kind?: string;
}
export interface RoundAnswer {
  agentId: string;
  messageId: string;
  text: string;
}

const TEXT_LIMIT = 400;

/**
 * The answers to the message `askId` from the agents named (or from any agent, for words to all of them): each agent's first plain message after it, in the order they came. `null` when the card should not show: fewer than two agents have answered, or the person has
 * written anything since the first answer (a Decided line is theirs too), so a decided or moved-on round folds away by itself.
 */
export function roundAnswers(
  messages: readonly RoundMessage[],
  askId: string,
  meId: string,
  agents: readonly string[] | null,
): RoundAnswer[] | null {
  const ask = messages.find((m) => m.messageId === askId);
  if (!ask) return null;
  const after = messages.filter((m) => m.threadSeq > ask.threadSeq).sort((a, b) => a.threadSeq - b.threadSeq);
  const wanted = agents === null ? null : new Set(agents);
  const out: RoundAnswer[] = [];
  const seen = new Set<string>();
  for (const m of after) {
    if (m.author.kind !== "agent" || (wanted !== null && !wanted.has(m.author.id)) || seen.has(m.author.id)) continue;
    if (m.body.trim() === "") continue;
    seen.add(m.author.id);
    const text = m.body.trim();
    out.push({
      agentId: m.author.id,
      messageId: m.messageId,
      text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text,
    });
  }
  if (out.length < 2) return null;
  const first = Math.min(...out.map((a) => after.find((m) => m.messageId === a.messageId)!.threadSeq));
  if (after.some((m) => m.author.id === meId && m.threadSeq > first)) return null;
  return out;
}

/** The ask a message answers: the latest message of the person's own before it that asked several agents (two or more tagged, or words to all of them). */
export function askBefore(
  messages: readonly (RoundMessage & { mentions?: readonly { kind: string; id: string }[] })[],
  afterId: string,
  meId: string,
  asks: (m: { body: string; mentions?: readonly { kind: string; id: string }[] | undefined }) => boolean,
): { messageId: string; agents: readonly string[] | null } | null {
  const at = messages.find((m) => m.messageId === afterId);
  if (!at) return null;
  const ask = messages
    .filter((m) => m.threadSeq < at.threadSeq && m.author.kind === "person" && m.author.id === meId && asks(m))
    .sort((a, b) => b.threadSeq - a.threadSeq)[0];
  if (!ask) return null;
  const tagged = (ask.mentions ?? []).filter((x) => x.kind === "agent").map((x) => x.id);
  return { messageId: ask.messageId, agents: tagged.length > 1 ? tagged : null };
}

const HEADLINE = /^\s*answer\s*:\s*(.+?)\s*(?:\n|$)/i;

/** The headline an agent opened with ("Answer: Object storage") and the rest of its answer. No such line: no headline, the whole text. */
export function splitHeadline(text: string): { headline?: string; rest: string } {
  const m = HEADLINE.exec(text);
  if (!m) return { rest: text };
  return { headline: m[1]!.replace(/^[*_`"]+|[*_`".]+$/g, "").trim(), rest: text.slice(m[0].length).trim() };
}

const same = (h: string): string =>
  h
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What the card may claim. "all" only when every agent gave a headline and they are the same after trimming case and punctuation; "some" (n of m) only for the largest identical group of two or more;
 * otherwise nothing is claimed and the card shows the headlines side by side (a wrong claim of agreement is worse than none).
 */
export function agreement(headlines: readonly (string | undefined)[]): {
  kind: "all" | "some" | "none";
  n: number;
  of: number;
} {
  const of = headlines.length;
  const counts = new Map<string, number>();
  for (const h of headlines) if (h !== undefined && same(h) !== "") counts.set(same(h), (counts.get(same(h)) ?? 0) + 1);
  const n = Math.max(0, ...counts.values());
  if (n >= 2 && n === of) return { kind: "all", n, of };
  if (n >= 2) return { kind: "some", n, of };
  return { kind: "none", n: 0, of };
}
