// Claude Code headless (ARCH 6.6): `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`. One process serves many turns: a user message is a JSON line on
// stdin, the answer is a run of event lines ending in a `result` line. Grok Build's headless mode speaks the same event schema (grok.ts), so the decoder is shared.
//
// Event lines read here (Claude Code 2.x):
//   system/init       session_id, mcp_servers [{name, status}]
//   stream_event      Anthropic stream events: message_start, content_block_start, content_block_delta (text_delta, thinking_delta, input_json_delta), message_delta
//   assistant         a whole message: content blocks text, thinking, tool_use, and usage
//   user              tool_result blocks (the CLI ran the tool, through MCP or one of its own)
//   result            subtype success | error_*, is_error, result, session_id, usage
//   rate_limit_event  rate_limit_info {status allowed | allowed_warning | rejected, resetsAt (epoch seconds), rateLimitType five_hour | seven_day | ..., utilization (a fraction, when the engine says it)}
//   system/compact_boundary  compact_metadata {trigger manual | auto, pre_tokens, post_tokens (optional)}: the context was compacted
// CHECKED against the Claude Code 2.1.316 binary (its strings, not a live run): /compact is a local command with supportsNonInteractive true and argumentHint "<optional custom summarization
// instructions>", so `/compact <what to keep>` sent as a user message on stdin compacts with those instructions; `--resume <id>` of a session that is not there says "No conversation found with session ID: <id>".
// With partial messages on, the text of a message arrives twice: as deltas and again in its `assistant` line. The deltas are the ones passed on; the whole message only fills in when no delta
// was seen for it (an older CLI, or partial messages off).
import { arr, num, obj, parseLine, str } from "./json.ts";
import { toolDetail } from "./detail.ts";
import { claudeSettings } from "./hooks-config.ts";
import type { Json } from "./json.ts";
import type { Effort } from "../../turn-engine/types.ts";
import type { CliAdapter, CliDecoder, CliEvent, CommandOptions, NativePlugins } from "./types.ts";
import { TOKEN_ENV } from "./types.ts";

interface Tally { input: number; output: number }

/** A count the engine put in its usage, or nothing when it left the field out: "not reported" stays apart from 0. */
const given = (u: Json | null, key: string): number | undefined => (u && typeof u[key] === "number" && Number.isFinite(u[key]) ? (u[key] as number) : undefined);

function tallyOf(u: Json | null): Tally {
  if (!u) return { input: 0, output: 0 };
  return { input: num(u["input_tokens"]) + num(u["cache_read_input_tokens"]) + num(u["cache_creation_input_tokens"]), output: num(u["output_tokens"]) };
}

/** The MCP server block the CLI is started with. The token is the environment variable's, expanded by the CLI: the command line holds only its name. */
export function mcpConfigJson(url: string, stdio?: { command: string; args: readonly string[] }, plugins?: NativePlugins): string {
  const extra = Object.fromEntries(Object.entries(plugins?.mcpServers ?? {}).map(([name, m]) => [`plugin_${name}`, { type: "stdio", command: m.command, args: [...m.args], env: { ...m.env } }]));
  const cfg = JSON.parse(base(url, stdio)) as { mcpServers: Record<string, unknown> };
  return JSON.stringify({ mcpServers: { ...cfg.mcpServers, ...extra } });
}
function base(url: string, stdio?: { command: string; args: readonly string[] }): string {
  // Through a sandbox's socket the CLI starts the shim as a stdio server; the token reaches it by name from the environment, as with the URL form.
  if (stdio) return JSON.stringify({ mcpServers: { vyre: { type: "stdio", command: stdio.command, args: [...stdio.args], env: { [TOKEN_ENV]: "${" + TOKEN_ENV + "}" } } } });
  return JSON.stringify({ mcpServers: { vyre: { type: "http", url, headers: { Authorization: "Bearer ${" + TOKEN_ENV + "}" } } } });
}

/**
 * A subscription limit window as the engine reported it. five_hour is the session, seven_day the week (the per-model weekly windows are not the week and are left out).
 * The share used is what the engine says (utilization, a fraction of 1) or 100 when it says the window is rejected; a line that says neither gives nothing, never a guess.
 */
export function limitsOf(info: Json | null): CliEvent[] {
  if (!info) return [];
  const type = str(info["rateLimitType"]);
  const window = type === "five_hour" ? "session" : type === "seven_day" ? "week" : null;
  if (!window) return [];
  const u = info["utilization"];
  let pct: number | null = null;
  if (typeof u === "number" && Number.isFinite(u) && u >= 0) pct = u <= 1 ? u * 100 : u;
  else if (str(info["status"]) === "rejected") pct = 100;
  if (pct === null) return [];
  const at = info["resetsAt"];
  return [{ type: "limits", window, pct: Math.min(100, Math.round(pct * 10) / 10), ...(typeof at === "number" && Number.isFinite(at) && at > 0 ? { resetsAt: Math.round(at * 1000) } : {}) }];
}

export function createClaudeDecoder(): CliDecoder {
  const streamed = new Set<string>();
  const called = new Set<string>();
  const perMessage = new Map<string, Tally>();
  let current = "";
  let sawText = false;
  let sid = "";
  /** The model the engine says it ran on (the init line, then each message): a chat that picked none runs on the engine's own default, and this is the only place its name is. */
  let model = "";
  /** What the latest request of the turn sent (fresh and cached): the size of the context as the model last saw it. The result line's totals add every request of the turn together. */
  let lastContext = 0;
  const sawModel = (m: string): void => { if (m !== "" && !m.startsWith("<")) model = m; };
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
    sawModel(str(m["model"]));
    const tally = tallyOf(obj(m["usage"]));
    if (tally.input > 0) lastContext = tally.input;
    perMessage.set(id, tally);
    const out: CliEvent[] = [];
    for (const raw of arr(m["content"])) {
      const b = obj(raw);
      if (!b) continue;
      const t = str(b["type"]);
      if (t === "text" && str(b["text"]) !== "" && !streamed.has(id)) { sawText = true; out.push({ type: "text", text: str(b["text"]) }); }
      else if (t === "thinking" && str(b["thinking"]) !== "" && !streamed.has(id)) out.push({ type: "thinking", text: str(b["thinking"]) });
      else if (t === "tool_use" && str(b["id"]) !== "") {
        if (!called.has(str(b["id"]))) { called.add(str(b["id"])); out.push({ type: "tool", phase: "call", id: str(b["id"]), name: str(b["name"]) }); }
        // the whole message carries the call's input (the streamed start does not): what it touches, in safe words only
        const detail = toolDetail(str(b["name"]), b["input"]);
        if (detail !== "") out.push({ type: "tool", phase: "input", id: str(b["id"]), detail });
      }
    }
    return out;
  }

  /** The lines of a tool result that say how a test run went (counts, failing names), last twelve at most; nothing else of the output is kept. A result with no such lines has none. */
  function tail(content: unknown): string {
    const text = typeof content === "string" ? content : arr(content).map((p) => str(obj(p)?.["text"])).join("\n");
    return text.split("\n").map((l) => l.trim()).filter((l) => /^(?:ℹ\s+(?:pass|fail)\s+\d+|✖\s+\S|not ok\b|FAIL\b|Tests:)/i.test(l) || /\b\d+\s+(?:passed|passing|failed|failing)\b/i.test(l)).slice(-12).join("\n").slice(0, 500);
  }

  function onUser(j: Json): CliEvent[] {
    const m = obj(j["message"]);
    const out: CliEvent[] = [];
    // With --replay-user-messages the engine echoes each message we wrote when it takes it up: that is when it was read, mid-turn at a step boundary or as the start of the next turn.
    if (j["isReplay"] === true) out.push({ type: "read" });
    for (const raw of arr(m?.["content"])) {
      const b = obj(raw);
      if (b && str(b["type"]) === "tool_result" && str(b["tool_use_id"]) !== "") out.push({ type: "tool", phase: "result", id: str(b["tool_use_id"]), ok: b["is_error"] !== true, ...(tail(b["content"]) !== "" ? { output: tail(b["content"]) } : {}) });
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
    // the result line's own split and the dollar figure Claude Code priced the turn at (for a sign-in it is what the API would have charged, which the turn record does not bill)
    const cacheRead = given(u, "cache_read_input_tokens"), cacheWrite = given(u, "cache_creation_input_tokens"), costUsd = given(j, "total_cost_usd");
    // the result line names every model the turn used; a turn that used one is that model
    const used = Object.keys(obj(j["modelUsage"]) ?? {}).filter((k) => !k.startsWith("<"));
    if (used.length === 1) model = used[0]!;
    if (total.input > 0 || total.output > 0) {
      out.push({
        type: "usage", inputTokens: total.input, outputTokens: total.output, ...(model !== "" ? { model } : {}), ...(lastContext > 0 ? { contextTokens: lastContext } : {}),
        ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}), ...(costUsd !== undefined ? { costUsd } : {}),
      });
    }
    streamed.clear(); called.clear(); perMessage.clear(); current = ""; sawText = false; lastContext = 0;
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
          // the engine compacted its context (asked with /compact, or by itself near the window's end): how many tokens it held before, and after when it says
          if (str(j["subtype"]) === "compact_boundary") {
            const m = obj(j["compact_metadata"]);
            const pre = num(m?.["pre_tokens"]), post = num(m?.["post_tokens"]);
            return [{ type: "compacted", ...(pre > 0 ? { before: pre } : {}), ...(post > 0 ? { after: post } : {}) }];
          }
          if (str(j["subtype"]) !== "init") return [];
          sawModel(str(j["model"]));
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
        case "rate_limit_event": return limitsOf(obj(j["rate_limit_info"]));
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
/** The ones that change nothing. Ask first and Plan allow these alone: a headless CLI cannot stop to ask, so a tool that would prompt is withheld and the model asks the person in the chat. */
export const READ_ONLY_FOLDER_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];

/**
 * The chat mode as Claude Code's own `--permission-mode` (checked against `claude --help`, 2.1.314: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan; "default" is still accepted as manual):
 * Ask first is default, Auto is acceptEdits with every folder tool allowed by name (so none prompts), Plan is plan. No mode (a step, a one-shot job) keeps the older rule, where only plan mode is told apart.
 */
export function claudePermission(o: Pick<CommandOptions, "mode" | "planMode">): "default" | "acceptEdits" | "plan" {
  const mode = o.mode ?? (o.planMode ? "plan" : undefined);
  return mode === "plan" ? "plan" : mode === "auto" ? "acceptEdits" : "default";
}
/** Claude Code takes the four efforts under the same names (`--effort`: low, medium, high, xhigh, max). */
export const claudeEffort = (e: Effort | null | undefined): string | null => (e === undefined || e === null ? null : e);

/**
 * The leanest Claude Code call (a memory learning pass): its own short system prompt instead of Claude Code's, no tools, no MCP server, no settings and so no CLAUDE.md (`--setting-sources ""`),
 * no skills or slash commands, nothing saved to resume. CHECKED against Claude Code 2.1.316 with a recording endpoint: about 1,000 characters (some 300 tokens) besides our system prompt and
 * message, against 9,000 of system prompt alone without these flags and more again with a CLAUDE.md. Not --bare: it reads only ANTHROPIC_API_KEY and would refuse a subscription sign-in.
 */
export function claudeLean(o: Pick<CommandOptions, "model" | "system">): string[] {
  return [
    "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages",
    "--strict-mcp-config", "--tools", "", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence", "--permission-mode", "default",
    ...(o.model !== null ? ["--model", o.model] : []),
    "--system-prompt", o.system ?? "",
  ];
}

export const claudeCode: CliAdapter = {
  id: "claude_code",
  bin: "claude",
  persistent: true,
  steers: true,
  models: MODELS,
  systemFlag: true,
  env: () => ({}),
  command(o: CommandOptions) {
    if (o.lean === true) return claudeLean(o);
    const tools = o.noTools !== true;
    // Only a chat mode narrows the folder tools; the older planMode flag alone changes the permission mode and nothing else, as before.
    const folderTools = o.mode === "ask" || o.mode === "plan" ? READ_ONLY_FOLDER_TOOLS : WORK_FOLDER_TOOLS;
    // WebSearch runs on the vendor's side. WebFetch goes out through the sandbox's wall, which applies the Space's internet setting (owner ruling 3 Nov: anything public by default); under
    // "Only the AI providers" the wall refuses the page and the tool says so.
    // Skill opens one of the skills Vyre wrote into the work folder (.claude/skills) or a plugin brought: it only reads instructions, so every mode allows it; what the skill then does goes through the other tools
    const allowed = tools ? ["mcp__vyre__*", "WebSearch", "WebFetch", ...Object.keys(o.plugins?.mcpServers ?? {}).map((n) => `mcp__plugin_${n}__*`), ...(o.workFolder !== null ? [...folderTools, "Skill"] : [])] : [];
    const effort = claudeEffort(o.effort);
    return [
      "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages",
      ...(tools ? ["--mcp-config", mcpConfigJson(o.mcpUrl, o.mcpStdio, o.plugins)] : []), "--strict-mcp-config",
      // the hooks layer reaches the CLI's own built-in tools and subagents (hooks-config.ts)
      ...(tools && o.mcpStdio ? ["--settings", claudeSettings(o.mcpStdio)] : []),
      // installed plugins load natively: their commands, skills and agents come from the plugin folder in the work folder
      ...(tools ? (o.plugins?.dirs ?? []).flatMap((d) => ["--plugin-dir", d]) : []),
      "--permission-mode", claudePermission(o),
      ...(allowed.length > 0 ? ["--allowedTools", ...allowed] : []),
      // A chat on the person's computer runs Vyre's tools only: the CLI's own tools are switched off unless a work folder was granted. A session with noTools has neither.
      ...(tools && o.workFolder !== null ? ["--add-dir", o.workFolder] : ["--tools", ""]),
      ...(o.model !== null ? ["--model", o.model] : []),
      ...(effort !== null ? ["--effort", effort] : []),
      ...(o.resume !== null ? ["--resume", o.resume] : []),
      ...(o.system !== null && o.system !== "" ? ["--append-system-prompt", o.system] : []),
    ];
  },
  encode: (prompt) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n",
  // a slash command is one line: what to keep is folded onto it
  compactCommand: (keep) => { const k = keep.replace(/\s+/g, " ").trim(); return k === "" ? "/compact" : `/compact ${k}`; },
  decoder: createClaudeDecoder,
};
