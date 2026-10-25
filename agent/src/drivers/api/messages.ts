// The thread as the model reads it, and what happens when it grows past the window (ARCH 6.6: compaction at 80% of context).
import { tokens } from "../../transcript/tokens.ts";
import type { StoredMessage, TurnInput } from "../../turn-engine/types.ts";
import type { ApiTool, Msg, SystemBlock } from "./types.ts";

export const COMPACT_AT = 0.8;
/** After compaction the kept tail uses at most this share of the window, leaving room to grow before the next one. */
export const KEEP_SHARE = 0.4;
export const TOOL_RESULT_CHARS = 100_000;

/** Roles the model sees: this agent's own earlier messages are its replies; everything else is user text, named when more than one voice is in the thread. */
export function threadMessages(input: TurnInput): Msg[] {
  const self = input.agent.id;
  const rows: StoredMessage[] = [...input.history];
  if (input.trigger && !rows.some((r) => r.id === input.trigger?.id)) rows.push(input.trigger);
  const others = new Set<string>();
  let anyAgent = false;
  for (const r of rows) {
    if (r.author.kind === "agent" && r.author.id === self) continue;
    others.add(r.author.id);
    if (r.author.kind === "agent") anyAgent = true;
  }
  const named = others.size > 1 || anyAgent;
  const out: Msg[] = [];
  for (const r of rows) {
    const mine = r.author.kind === "agent" && r.author.id === self;
    if (r.body.trim() === "") continue;
    pushMerged(out, mine ? { role: "assistant", text: r.body, calls: [] } : { role: "user", text: named ? `${r.author.id}: ${r.body}` : r.body });
  }
  const first = out[0];
  // Every provider wants the conversation to open with the user.
  if (first && first.role === "assistant") out[0] = { role: "user", text: `(earlier reply) ${first.text}` };
  if (input.resumed) {
    const r = input.resumed;
    const body = typeof r.result.content === "string" ? r.result.content : JSON.stringify(r.result.content ?? null);
    pushMerged(out, { role: "user", text: `(tool ${r.toolName} ${r.approved ? "was approved" : "was declined"}; ${r.result.ok ? "result" : "error"}: ${cap(body)})` });
  }
  const last = out[out.length - 1];
  if (!last || last.role !== "user") pushMerged(out, { role: "user", text: "(continue)" });
  return out;
}

export function pushMerged(out: Msg[], m: Msg): void {
  const last = out[out.length - 1];
  if (last && last.role === "user" && m.role === "user") { out[out.length - 1] = { role: "user", text: `${last.text}\n\n${m.text}` }; return; }
  if (last && last.role === "assistant" && last.calls.length === 0 && m.role === "assistant" && m.calls.length === 0) { out[out.length - 1] = { role: "assistant", text: `${last.text}\n\n${m.text}`, calls: [] }; return; }
  out.push(m);
}

export function cap(text: string, max: number = TOOL_RESULT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[cut: ${text.length - max} more characters]`;
}

export function msgTokens(m: Msg): number {
  if (m.role === "user") return tokens(m.text) + 4;
  if (m.role === "tool") return tokens(m.content) + 8;
  return tokens(m.text) + 4 + m.calls.reduce((n, c) => n + tokens(c.name) + tokens(JSON.stringify(c.input ?? {})) + 8, 0);
}

export function promptTokens(system: readonly SystemBlock[], tools: readonly ApiTool[], messages: readonly Msg[]): number {
  let n = 0;
  for (const b of system) n += tokens(b.text);
  for (const t of tools) n += tokens(t.name) + tokens(t.description) + tokens(JSON.stringify(t.inputSchema ?? null));
  for (const m of messages) n += msgTokens(m);
  return n;
}

/** The part of the prompt that does not change between calls of one send: system blocks and tool list. */
export function fixedTokens(system: readonly SystemBlock[], tools: readonly ApiTool[]): number {
  return promptTokens(system, tools, []);
}

export type Summarize = (dropped: readonly Msg[]) => Promise<string>;

/** One line per dropped user ask or reply: what a switch or a rollover would keep if no cheap model were reachable. */
export function extractive(dropped: readonly Msg[]): string {
  const lines: string[] = [];
  for (const m of dropped) {
    if (m.role === "tool") continue;
    const words = m.text.replace(/\s+/g, " ").trim();
    if (words === "") continue;
    lines.push(`${m.role === "user" ? "Asked" : "Answered"}: ${words.length > 200 ? `${words.slice(0, 200)}...` : words}`);
  }
  return lines.join("\n");
}

export interface Compacted { messages: Msg[]; dropped: number }

/**
 * If the prompt is over 80% of the window, replace the oldest messages with a summary and keep the newest ones that fit in 40%.
 * The cut falls on a user message so a tool call is never separated from its results.
 */
export async function compact(fixed: number, messages: readonly Msg[], window: number, summarize?: Summarize): Promise<Compacted> {
  let total = fixed;
  for (const m of messages) total += msgTokens(m);
  if (total <= window * COMPACT_AT) return { messages: [...messages], dropped: 0 };
  const room = Math.max(0, window * KEEP_SHARE - fixed);
  let used = 0;
  let from = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    used += msgTokens(m);
    if (used > room && from < messages.length) break;
    from = i;
  }
  // Move the cut forward to the next user message that opens a step.
  while (from < messages.length && messages[from]?.role !== "user") from += 1;
  if (from >= messages.length) from = Math.max(0, messages.length - 1);
  while (from > 0 && messages[from]?.role !== "user") from -= 1;
  const dropped = messages.slice(0, from);
  if (dropped.length === 0) return { messages: [...messages], dropped: 0 };
  let summary = "";
  if (summarize) { try { summary = await summarize(dropped); } catch { summary = ""; } }
  if (summary.trim() === "") summary = extractive(dropped);
  const head: Msg = { role: "user", text: `Earlier in this conversation (shortened to fit the model's window; ${dropped.length} messages):\n${summary}` };
  // Two user messages in a row are fine on every provider, so the kept tail is not touched.
  return { messages: [head, ...messages.slice(from)], dropped: dropped.length };
}
