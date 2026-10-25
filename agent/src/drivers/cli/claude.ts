// Claude Code headless (ARCH 6.6): `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`. One process serves many turns: a user message is a JSON line on
// stdin, the answer is a run of event lines ending in a `result` line. Grok Build's headless mode speaks the same event schema (grok.ts), so the decoder is shared.
//
// Event lines read here (Claude Code 2.x):
//   system/init       session_id, mcp_servers [{name, status}]
//   stream_event      Anthropic stream events: message_start, content_block_start, content_block_delta (text_delta, thinking_delta, input_json_delta), message_delta
//   assistant         a whole message: content blocks text, thinking, tool_use, and usage
//   user              tool_result blocks (the CLI ran the tool, through MCP or one of its own)
//   result            subtype success | error_*, is_error, result, session_id, usage
// With partial messages on, the text of a message arrives twice: as deltas and again in its `assistant` line. The deltas are the ones passed on; the whole message only fills in when no delta
// was seen for it (an older CLI, or partial messages off).
import { arr, num, obj, parseLine, str } from "./json.ts";
import type { Json } from "./json.ts";
import type { CliAdapter, CliDecoder, CliEvent, CommandOptions } from "./types.ts";
import { TOKEN_ENV } from "./types.ts";

interface Tally { input: number; output: number }

function tallyOf(u: Json | null): Tally {
  if (!u) return { input: 0, output: 0 };
  return { input: num(u["input_tokens"]) + num(u["cache_read_input_tokens"]) + num(u["cache_creation_input_tokens"]), output: num(u["output_tokens"]) };
}

/** The MCP server block the CLI is started with. The token is the environment variable's, expanded by the CLI: the command line holds only its name. */
export function mcpConfigJson(url: string, socket?: { path: string; shim: string }): string {
  // Through a sandbox's socket the CLI starts the shim as a stdio server; the token reaches it by name from the environment, as with the URL form.
  if (socket) return JSON.stringify({ mcpServers: { vyre: { type: "stdio", command: "node", args: [socket.shim, socket.path], env: { [TOKEN_ENV]: "${" + TOKEN_ENV + "}" } } } });
  return JSON.stringify({ mcpServers: { vyre: { type: "http", url, headers: { Authorization: "Bearer ${" + TOKEN_ENV + "}" } } } });
}

export function createClaudeDecoder(): CliDecoder {
  const streamed = new Set<string>();
  const called = new Set<string>();
  const perMessage = new Map<string, Tally>();
  let current = "";
  let sawText = false;
  let sid = "";
  /** The session id, once per change: the init line and the result line both carry it. */
  const session = (id: string): CliEvent[] => (id !== "" && id !== sid ? ((sid = id), [{ type: "session", id }]) : []);

  function onStream(ev: Json): CliEvent[] {
    switch (str(ev["type"])) {
      case "message_start": {
        const m = obj(ev["message"]);
        current = str(m?.["id"]);
        return [];
      }
      case "content_block_start": {
        const b = obj(ev["content_block"]);
        if (b && str(b["type"]) === "tool_use" && str(b["id"]) !== "" && !called.has(str(b["id"]))) {
          called.add(str(b["id"]));
          return [{ type: "tool", phase: "call", id: str(b["id"]), name: str(b["name"]) }];
        }
        return [];
      }
      case "content_block_delta": {
        const d = obj(ev["delta"]);
        if (!d) return [];
        const t = str(d["type"]);
        if (t === "text_delta" && str(d["text"]) !== "") { streamed.add(current); sawText = true; return [{ type: "text", text: str(d["text"]) }]; }
        if (t === "thinking_delta" && str(d["thinking"]) !== "") { streamed.add(current); return [{ type: "thinking", text: str(d["thinking"]) }]; }
        return [];
      }
      default:
        return [];
    }
  }

  function onAssistant(j: Json): CliEvent[] {
    const m = obj(j["message"]);
    if (!m) return [];
    const id = str(m["id"]);
    perMessage.set(id, tallyOf(obj(m["usage"])));
    const out: CliEvent[] = [];
    for (const raw of arr(m["content"])) {
      const b = obj(raw);
      if (!b) continue;
      const t = str(b["type"]);
      if (t === "text" && str(b["text"]) !== "" && !streamed.has(id)) { sawText = true; out.push({ type: "text", text: str(b["text"]) }); }
      else if (t === "thinking" && str(b["thinking"]) !== "" && !streamed.has(id)) out.push({ type: "thinking", text: str(b["thinking"]) });
      else if (t === "tool_use" && str(b["id"]) !== "" && !called.has(str(b["id"]))) { called.add(str(b["id"])); out.push({ type: "tool", phase: "call", id: str(b["id"]), name: str(b["name"]) }); }
    }
    return out;
  }

  function onUser(j: Json): CliEvent[] {
    const m = obj(j["message"]);
    const out: CliEvent[] = [];
    for (const raw of arr(m?.["content"])) {
      const b = obj(raw);
      if (b && str(b["type"]) === "tool_result" && str(b["tool_use_id"]) !== "") out.push({ type: "tool", phase: "result", id: str(b["tool_use_id"]), ok: b["is_error"] !== true });
    }
    return out;
  }

  function onResult(j: Json): CliEvent[] {
    const out: CliEvent[] = [];
    out.push(...session(str(j["session_id"])));
    const failed = j["is_error"] === true || str(j["subtype"]).startsWith("error");
    const text = str(j["result"]);
    if (!failed && !sawText && text !== "") out.push({ type: "text", text });
    const u = obj(j["usage"]);
    let total = tallyOf(u);
    if (!u) { total = { input: 0, output: 0 }; for (const t of perMessage.values()) { total.input += t.input; total.output += t.output; } }
    if (total.input > 0 || total.output > 0) out.push({ type: "usage", inputTokens: total.input, outputTokens: total.output });
    streamed.clear(); called.clear(); perMessage.clear(); current = ""; sawText = false;
    if (!failed) { out.push({ type: "end" }); return out; }
    const subtype = str(j["subtype"]);
    const code = subtype === "error_max_turns" ? "engine.step_limit" : undefined;
    out.push({ type: "end", error: { ...(code ? { code } : {}), message: text !== "" ? text : subtype !== "" ? subtype : "the engine reported an error" } });
    return out;
  }

  return {
    push(line) {
      const j = parseLine(line);
      if (!j) return [];
      switch (str(j["type"])) {
        case "system": {
          if (str(j["subtype"]) !== "init") return [];
          const out: CliEvent[] = session(str(j["session_id"]));
          for (const raw of arr(j["mcp_servers"])) {
            const s = obj(raw);
            if (!s || str(s["name"]) !== "vyre") continue;
            const status = str(s["status"]);
            if (status === "connected") out.push({ type: "mcp", status: "ok" });
            else if (status === "failed" || status === "needs-auth" || status === "disabled") out.push({ type: "mcp", status: "failed", detail: status });
          }
          return out;
        }
        case "stream_event": { const ev = obj(j["event"]); return ev ? onStream(ev) : []; }
        case "assistant": return onAssistant(j);
        case "user": return onUser(j);
        case "result": return onResult(j);
        default: return [];
      }
    },
    finish: () => [],
  };
}

const MODELS = [
  { id: "opus", label: "Claude Opus" },
  { id: "sonnet", label: "Claude Sonnet" },
  { id: "haiku", label: "Claude Haiku" },
] as const;

/** The CLI's own file and shell tools a granted work folder turns on. The sandbox is the wall; this only says what the CLI may ask for inside it. */
export const WORK_FOLDER_TOOLS: readonly string[] = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];

export const claudeCode: CliAdapter = {
  id: "claude_code",
  bin: "claude",
  persistent: true,
  models: MODELS,
  systemFlag: true,
  env: () => ({}),
  command(o: CommandOptions) {
    const allowed = ["mcp__vyre__*", ...(o.workFolder !== null ? WORK_FOLDER_TOOLS : [])];
    return [
      "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--mcp-config", mcpConfigJson(o.mcpUrl, o.mcpSocket), "--strict-mcp-config",
      "--permission-mode", o.planMode ? "plan" : "default",
      "--allowedTools", ...allowed,
      // A chat on the person's computer runs Vyre's tools only: the CLI's own tools are switched off unless a work folder was granted.
      ...(o.workFolder !== null ? ["--add-dir", o.workFolder] : ["--tools", ""]),
      ...(o.model !== null ? ["--model", o.model] : []),
      ...(o.resume !== null ? ["--resume", o.resume] : []),
      ...(o.system !== null && o.system !== "" ? ["--append-system-prompt", o.system] : []),
    ];
  },
  encode: (prompt) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n",
  decoder: createClaudeDecoder,
};
