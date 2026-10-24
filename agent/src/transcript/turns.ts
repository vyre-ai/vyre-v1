// A turn built from what an engine streams (DriverEvent, agent/src/turn-engine/types.ts): text and thinking coalesced, each tool call with its one-line summary, its links and,
// when the result arrives, a redacted and capped output. The same builder serves an API driver and the CLI stream adapter, so the rows look alike whichever engine wrote them.
import type { DriverEvent } from "../turn-engine/types.ts";
import { commitLinks, cleanLinks, resultText, textLinks, toolLinks } from "./links.ts";
import { redact } from "./sanitize.ts";
import { clip, cut, describe, toolKind } from "./summary.ts";
import type { Link, NewTurn, Part } from "./types.ts";

/** Long tool output is noise in a transcript: a result keeps its first 4,000 characters. */
export const OUTPUT_CAP = 4000;

type ToolCallPart = Extract<Part, { kind: "tool_call" }>;

export interface TurnBuilderOptions {
  threadId: string;
  authorId: string;
  engine: string;
  model: string | null;
  now?: () => number;
  /** The folder paths are made relative to. */
  cwd?: string | null;
}

export interface TurnBuilder {
  push(ev: DriverEvent): void;
  /** The result of a tool call the engine ran (or the CLI reported). `content` is whatever the tool returned. */
  toolResult(callId: string, r: { ok: boolean; content: unknown }): void;
  /** The turn so far. Calling it again after more events gives the longer turn. */
  build(): NewTurn;
}

function argsOf(name: string, input: unknown): ToolCallPart["args"] {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = toolKind(name);
  const out: ToolCallPart["args"] = {};
  const path = i["file_path"] ?? i["notebook_path"] ?? (kind !== "run" ? i["path"] : undefined);
  if (typeof path === "string" && path && ["read", "edit", "write", "search"].includes(kind)) out.path = cut(clip(path, 500), 300);
  if (typeof i["command"] === "string" && i["command"] && kind === "run") out.command = cut(clip(i["command"], 4000), 1000);
  const q = i["query"] ?? (kind === "search" ? i["pattern"] : undefined) ?? (kind === "fetch" ? i["url"] : undefined);
  if (typeof q === "string" && q) out.query = cut(clip(q, 500), 300);
  return out;
}

/** What a tool returned, as text: a string as it is, `{ data }` as JSON, a CLI's content blocks joined. */
export function outputText(content: unknown): string {
  if (typeof content === "string") return content;
  const joined = resultText(content);
  if (joined) return joined;
  if (content && typeof content === "object" && "data" in content) {
    try { return JSON.stringify((content as { data: unknown }).data); } catch { return ""; }
  }
  try { return content === undefined ? "" : JSON.stringify(content); } catch { return ""; }
}

export function createTurnBuilder(o: TurnBuilderOptions): TurnBuilder {
  const now = o.now ?? Date.now;
  const cwd = o.cwd ?? null;
  const at = now();
  const parts: Part[] = [];
  const tokens = { in: 0, out: 0 };
  const commits = new Set<string>();
  let error: NewTurn["error"];

  const last = (): Part | undefined => parts[parts.length - 1];
  const grow = (kind: "text" | "thinking", text: string): void => {
    const tail = last();
    if (tail && tail.kind === kind) tail.text += text;
    else parts.push({ kind, text });
  };

  return {
    push(ev) {
      switch (ev.type) {
        case "text": grow("text", ev.text); break;
        case "thinking": grow("thinking", ev.text); break;
        case "tool_call": {
          const tool = toolKind(ev.name);
          parts.push({
            kind: "tool_call", id: ev.id, name: ev.name, tool, summary: redact(describe(ev.name, ev.input)).text, args: argsOf(ev.name, ev.input), links: toolLinks(ev.name, ev.input, cwd),
          });
          const input = (ev.input && typeof ev.input === "object" ? ev.input : {}) as Record<string, unknown>;
          if (ev.name === "Bash" && typeof input["command"] === "string" && /\bgit\b[^|;&\n]*\bcommit\b/.test(input["command"])) commits.add(ev.id);
          break;
        }
        case "block": parts.push({ kind: "block", type: ev.kind, data: ev.payload ?? null }); break;
        case "usage": tokens.in += ev.inputTokens; tokens.out += ev.outputTokens; break;
        case "error": error = { code: ev.code, message: redact(ev.message).text }; break;
        case "done": break;
      }
    },
    toolResult(callId, r) {
      const raw = outputText(r.content);
      const clean = redact(raw.length > OUTPUT_CAP ? raw.slice(0, OUTPUT_CAP) : raw).text;
      parts.push({ kind: "tool_result", id: callId, ok: r.ok, output: clean, cut: raw.length > OUTPUT_CAP });
      if (commits.delete(callId)) {
        const call = parts.find((p): p is ToolCallPart => p.kind === "tool_call" && p.id === callId);
        if (call) call.links = [...call.links, ...commitLinks(raw)];
      }
    },
    build() {
      const out: Part[] = parts.map((p): Part => {
        if (p.kind === "text" || p.kind === "thinking") return { kind: p.kind, text: redact(p.text).text };
        if (p.kind === "tool_call") return { ...p, links: cleanLinks(p.links) };
        return { ...p };
      });
      // A turn's links: what its tool calls touched and what its own words name (a commit, a url).
      const links = cleanLinks(out.flatMap((p): Link[] => (p.kind === "tool_call" ? p.links : p.kind === "text" ? textLinks(p.text) : [])));
      return {
        threadId: o.threadId, role: "agent", authorId: o.authorId, engine: o.engine, model: o.model, at, parts: out, links, tokens: { ...tokens },
        ...(error ? { error } : {}),
      };
    },
  };
}

/** A person's message as a turn. */
export function personTurn(o: { threadId: string; authorId: string; text: string; at: number }): NewTurn {
  const clean = redact(o.text).text;
  return {
    threadId: o.threadId, role: "person", authorId: o.authorId, engine: null, model: null, at: o.at, parts: [{ kind: "text", text: clean }], links: cleanLinks(textLinks(clean)), tokens: { in: 0, out: 0 },
  };
}
