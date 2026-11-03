// The canonical transcript of a chat, written by the engine (ARCH 6.9): every turn becomes rows through chat.transcript.append, the person's words and what the agent said and did, so the rolling
// summary (chat.transcript.summarize) can stand for older turns and any line stays one transcript_search away. Written as the asker; a transcript that cannot be written never holds a turn up.
import { createTurnBuilder } from "../../agent/src/transcript/turns.ts";
import type { Part } from "../../agent/src/transcript/types.ts";
import type { DriverEvent, EngineSession, OpenSession, ToolResult, TurnInput } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
type Row = { role: string; kind: string; content: unknown; toolName?: string; toolCallId?: string };

/** Summarise again after this many written turns of a thread. */
export const SUMMARIZE_EVERY = 5;

/** Rows for what an agent did in one turn: its words, each tool call with a one-line summary, and each result. */
export function rowsOf(parts: readonly Part[]): Row[] {
  const out: Row[] = [];
  for (const p of parts) {
    if (p.kind === "text" && p.text.trim() !== "") out.push({ role: "assistant", kind: "text", content: p.text });
    else if (p.kind === "tool_call") out.push({ role: "assistant", kind: "tool_call", content: p.summary, toolName: p.name, toolCallId: p.id });
    else if (p.kind === "tool_result") out.push({ role: "tool", kind: "tool_result", content: p.output, toolCallId: p.id });
  }
  return out;
}

/** Engines that keep their own session, with their own tool results in it: they are not given the private results section. */
const CLI_DRIVERS: ReadonlySet<string> = new Set(["claude_code", "codex", "grok"]);
/** Per chat, agent and asker: how many recent turns' tool results are kept, and how much of each. */
const KEEP_RESULT_TURNS = 3;
const RESULT_CHARS = 1_500;
const RESULTS_CHARS = 6_000;

/** One turn's calls and what each returned, as the lines of the private results section. */
function resultLines(parts: readonly Part[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.kind !== "tool_result") continue;
    const call = parts.find((c): c is Extract<Part, { kind: "tool_call" }> => c.kind === "tool_call" && c.id === p.id);
    const said = p.output.length > RESULT_CHARS ? `${p.output.slice(0, RESULT_CHARS)}…` : p.output;
    out.push(`- ${call ? `${call.name}: ${call.summary}` : "a tool"}${p.ok ? "" : " (failed)"}\n  ${said.replace(/\n/g, "\n  ")}`);
  }
  return out;
}

/** A transcript turn id (trn_ and lower-case letters and digits) made from an engine id, with a letter saying whose turn it is. */
export const turnIdOf = (who: "p" | "a", id: string): string => `trn_${who}${id.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

export function withTranscript(open: OpenSession, call: Call, now: () => number = Date.now): OpenSession {
  const written = new Map<string, number>();
  // What a tool returned is the asker's private turn detail: it is not in the shared transcript (chat.transcript.append keeps it for them), so an API engine, which keeps no session of its own
  // between turns, would forget its own work. It is kept here per chat, agent and asker, and only a later turn for that same person is given it.
  const recent = new Map<string, string[][]>();
  const keyOf = (i: TurnInput): string => `${i.threadId}|${i.agent.id}|${i.asker}`;
  const append = async (threadId: string, turnId: string, rows: Row[], asker: string): Promise<void> => {
    if (rows.length === 0) return;
    try { await call("chat.transcript.append", { threadId, turnId, rows }, asker); } catch (e) { if (process.env["VYRE_DEBUG_TRANSCRIPT"]) console.log("append failed", e); }
  };
  return async (spec) => {
    const session = await open(spec);
    let builder: ReturnType<typeof createTurnBuilder> | null = null;
    return Object.create(session, {
      send: {
        value: (given: TurnInput) => (async function* (): AsyncGenerator<DriverEvent> {
          const api = !CLI_DRIVERS.has(spec.account?.driver ?? "");
          const kept = api ? (recent.get(keyOf(given)) ?? []).flat() : [];
          let text = kept.join("\n");
          if (text.length > RESULTS_CHARS) text = `…${text.slice(text.length - RESULTS_CHARS)}`;
          const input: TurnInput = text !== "" && given.context ? { ...given, context: { ...given.context, sections: [...given.context.sections, { id: "results", stable: false, text }] } } : given;
          const t = input.trigger;
          if (t && t.author.kind === "person" && t.body.trim() !== "" && !input.resumed) await append(input.threadId, turnIdOf("p", t.id), [{ role: "user", kind: "text", content: t.body }], input.asker);
          builder = createTurnBuilder({ threadId: input.threadId, authorId: input.agent.id, engine: spec.account?.driver ?? "engine", model: input.agent.model ?? null, now });
          try {
            for await (const ev of session.send(input)) { builder.push(ev); yield ev; }
          } finally {
            const parts = builder.build().parts;
            const rows = rowsOf(parts);
            builder = null;
            const lines = resultLines(parts);
            if (api && lines.length > 0) recent.set(keyOf(input), [...(recent.get(keyOf(input)) ?? []), lines].slice(-KEEP_RESULT_TURNS));
            await append(input.threadId, turnIdOf("a", input.turnId), rows, input.asker);
            const n = (written.get(input.threadId) ?? 0) + 1;
            written.set(input.threadId, n);
            if (n % SUMMARIZE_EVERY === 0) { try { await call("chat.transcript.summarize", { threadId: input.threadId, idempotencyKey: `sum:${input.turnId}` }, input.asker); } catch { /* the next one will */ } }
          }
        })(),
      },
      sendToolResult: { value: (id: string, r: ToolResult) => { builder?.toolResult(id, r); session.sendToolResult(id, r); } },
    }) as EngineSession;
  };
}
