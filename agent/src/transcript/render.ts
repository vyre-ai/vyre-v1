// The words of a turn, two ways. plain() is what another engine reads (a person's text, an agent's text, one short line per tool call and block); markdown() is the rendered
// chats/<id>/transcript.md view: append-only, so a turn's text never changes once written and the file only grows at the end.
import { cut } from "./summary.ts";
import type { Part, Turn } from "./types.ts";

type ToolCallPart = Extract<Part, { kind: "tool_call" }>;
type ToolResultPart = Extract<Part, { kind: "tool_result" }>;

/** The outcome of a call in a few words: ok or failed, and the first line of what came back. */
function outcome(call: ToolCallPart, result: ToolResultPart | undefined): string {
  if (!result) return "no result seen";
  const first = cut(result.output.split("\n").find((l) => l.trim() !== "") ?? "", 100);
  return `${result.ok ? "ok" : "failed"}${first ? `: ${first}` : ""}`;
}

/** The lines of a turn's tool calls, each with how it ended. */
export function toolLines(turn: Turn): string[] {
  const results = new Map<string, ToolResultPart>();
  for (const p of turn.parts) if (p.kind === "tool_result") results.set(p.id, p);
  return turn.parts.flatMap((p) => (p.kind === "tool_call" ? [`${p.summary} -> ${outcome(p, results.get(p.id))}`] : []));
}

/** A turn as words: the text, then the work done. Thinking is the engine's own and is not carried. */
export function plain(turn: Turn, o: { tools?: boolean } = {}): string {
  const text = turn.parts.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join("\n").trim();
  const lines = o.tools === false ? [] : toolLines(turn).map((l) => `[${l}]`);
  const blocks = turn.parts.flatMap((p) => (p.kind === "block" ? [`[shown: ${p.type}]`] : []));
  return [text, ...lines, ...blocks].filter((s) => s !== "").join("\n");
}

const when = (at: number): string => new Date(at).toISOString();

/** One turn of chats/<id>/transcript.md. */
export function markdown(turn: Turn): string {
  const who = turn.role === "person" ? `person ${turn.authorId}` : `agent ${turn.authorId}${turn.engine ? ` on ${turn.engine}${turn.model ? ` ${turn.model}` : ""}` : ""}`;
  const head = `## Turn ${turn.n}: ${who}, ${when(turn.at)}`;
  const body = plain(turn, { tools: false });
  const calls = toolLines(turn).map((l) => `- ${l}`);
  const err = turn.error ? [`Failed: ${turn.error.code}: ${turn.error.message}`] : [];
  return [head, body, ...(calls.length ? [calls.join("\n")] : []), ...err].filter((s) => s !== "").join("\n\n") + "\n";
}

/** The file from turn `from` on. Rendering from 1 and rendering a longer run give the same start. */
export function render(turns: readonly Turn[], o: { title?: string; from?: number } = {}): string {
  const from = o.from ?? 1;
  const head = from <= 1 ? `# ${o.title ?? "Transcript"}\n\n` : "";
  return head + turns.filter((t) => t.n >= from).map(markdown).join("\n");
}
