// from vyre 0.6.9 core/transcripts/index.js@dbd2dfbab (turnOf, read) and core/transcripts/links.js@dbd2dfbab (Linker)
// The one place that reads Claude Code's session file (<folder>/<encoded cwd>/<session id>.jsonl). The format is not a published contract and can change under us, so every failure
// degrades to "no history" rather than an error: a line that is not JSON costs that line, and a line of a shape we do not know is skipped.
// Claude Code writes each content block of a reply as its own line and each tool result on a later user line naming the tool_use_id. We fold them back into the conversation's own shape:
// a person's message is a turn, and everything the agent did until the next message from the person is one agent turn (text, tool calls with their results).
// Text leaves here redacted. Lines Claude Code adds on its own (meta lines, command echoes, system reminders) and subagent lines (isSidechain) are not turns.
import { createTurnBuilder, personTurn } from "./turns.ts";
import type { TurnBuilder } from "./turns.ts";
import { redact } from "./sanitize.ts";
import { withoutSeed } from "./seed.ts";
import type { NewTurn } from "./types.ts";

export interface ClaudeImport {
  turns: NewTurn[];
  title: string | null;
  cwd: string | null;
  /** Lines that were not JSON (a live session's last line is often half written). */
  bad: number;
  /** Secrets replaced anywhere in the text. */
  redacted: number;
}

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const COMMAND_ECHO = /^<(?:local-)?command-/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What a person typed, from a user line's content; "" when the line holds none (a tool result, a command echo, a reminder). */
function personText(content: unknown): string {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) text = content.filter((p): p is Json => isObj(p) && p["type"] === "text" && typeof p["text"] === "string").map((p) => str(p["text"])).join("\n");
  text = text.replace(REMINDER, "").trim();
  if (COMMAND_ECHO.test(text)) return "";
  // A rolled or switched session's first message is Vyre's seed and then the person's words: the seed repeats what the transcript already holds.
  return withoutSeed(text).trim();
}

export function importClaudeSession(source: string | Iterable<string>, o: { threadId: string; personId: string; agentId: string; engine?: string }): ClaudeImport {
  const lines = typeof source === "string" ? source.split("\n") : source;
  const engine = o.engine ?? "claude_code";
  const out: ClaudeImport = { turns: [], title: null, cwd: null, bad: 0, redacted: 0 };

  let builder: TurnBuilder | null = null;
  let usage = new Map<string, { in: number; out: number }>();
  let model: string | null = null;

  const flush = (): void => {
    if (!builder) return;
    for (const u of usage.values()) builder.push({ type: "usage", inputTokens: u.in, outputTokens: u.out });
    const turn = builder.build();
    if (turn.parts.length > 0) out.turns.push(turn);
    builder = null;
    usage = new Map();
    model = null;
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let o2: unknown;
    try { o2 = JSON.parse(raw); } catch { out.bad++; continue; }
    if (!isObj(o2)) continue;
    if (o2["type"] === "custom-title") {
      if (str(o2["customTitle"]).trim()) out.title = redact(str(o2["customTitle"]).trim().slice(0, 120)).text;
      continue;
    }
    if (out.cwd === null && str(o2["cwd"])) out.cwd = str(o2["cwd"]);
    if (o2["isSidechain"] === true || o2["isMeta"] === true) continue;
    const ts = Date.parse(str(o2["timestamp"])) || 0;
    const m = isObj(o2["message"]) ? o2["message"] : null;
    if (!m) continue;

    if (o2["type"] === "user") {
      const content = m["content"];
      // Tool results come back on user lines; they belong to the agent turn that made the call.
      if (Array.isArray(content) && builder) {
        for (const b of content) {
          if (isObj(b) && b["type"] === "tool_result" && str(b["tool_use_id"])) builder.toolResult(str(b["tool_use_id"]), { ok: b["is_error"] !== true, content: b["content"] });
        }
      }
      const text = personText(content);
      if (text) {
        flush();
        const turn = personTurn({ threadId: o.threadId, authorId: o.personId, text, at: ts });
        out.redacted += redact(text).hits.length;
        out.turns.push(turn);
      }
      continue;
    }

    if (o2["type"] === "assistant") {
      const content = m["content"];
      if (!Array.isArray(content)) continue;
      if (!builder) {
        if (str(m["model"]) && !str(m["model"]).startsWith("<")) model = str(m["model"]).slice(0, 80);
        builder = createTurnBuilder({ threadId: o.threadId, authorId: o.agentId, engine, model, now: () => ts, cwd: out.cwd });
      }
      for (const b of content) {
        if (!isObj(b)) continue;
        if (b["type"] === "text" && str(b["text"])) { builder.push({ type: "text", text: str(b["text"]) }); out.redacted += redact(str(b["text"])).hits.length; }
        else if (b["type"] === "thinking" && str(b["thinking"])) builder.push({ type: "thinking", text: str(b["thinking"]) });
        else if (b["type"] === "tool_use" && str(b["name"])) builder.push({ type: "tool_call", id: str(b["id"]), name: str(b["name"]), input: b["input"] });
      }
      const u = isObj(m["usage"]) ? m["usage"] : null;
      const id = str(m["id"]);
      if (u && id) {
        const num = (k: string): number => (typeof u[k] === "number" && (u[k] as number) >= 0 ? (u[k] as number) : 0);
        usage.set(id, { in: num("input_tokens") + num("cache_read_input_tokens") + num("cache_creation_input_tokens"), out: num("output_tokens") });
      }
    }
  }
  flush();
  return out;
}
