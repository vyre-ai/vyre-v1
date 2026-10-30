// Codex headless (ARCH 6.6): `codex exec --json`. Each turn is one process; the next turn continues the thread with `codex exec resume <thread id>`. Vyre's tools come through the MCP
// server named in the command line's `-c` overrides, with the token read from the environment variable the override names.
//
// Event lines read here (codex-cli 0.x, `exec --json`):
//   thread.started   thread_id
//   item.started     item: command_execution | mcp_tool_call | file_change (in progress)
//   item.completed   item: agent_message {text} | reasoning {text} | mcp_tool_call | command_execution {exit_code} | file_change | error
//   turn.completed   usage {input_tokens (includes cached), cached_input_tokens, output_tokens}
//   turn.failed      error {message}
//   error            message
// CHECKED against OpenAI's Codex docs (30 Oct 2026): `codex exec --json` JSONL with thread.started, turn.started, turn.completed (usage input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens), turn.failed, item.* and error;
// `codex exec resume <SESSION_ID>`; prompt on stdin with `-`; `--skip-git-repo-check`; `CODEX_API_KEY`; config.toml mcp_servers stdio keys command/args/env/env_vars and HTTP keys url/bearer_token_env_var.
// STILL NEEDS A REAL ACCOUNT to prove: that `-c mcp_servers.vyre.*` overrides on the command line (the docs show only config.toml), the exact item field names (server, tool, exit_code), flag order before `resume`,
// and a ChatGPT sign-in (auth.json) through the sandbox. The docs give no complete schema for every event.
// Codex does not stream deltas: a message arrives whole when it is done.
import { num, obj, parseLine, str } from "./json.ts";
import type { Json } from "./json.ts";
import type { CliAdapter, CliDecoder, CliEvent, CommandOptions } from "./types.ts";
import { TOKEN_ENV } from "./types.ts";

const MCP_FAILURE = /mcp/i;

/** The tool name of a started item, and whether it counts as activity worth showing. */
function nameOf(item: Json): string {
  switch (str(item["type"])) {
    case "mcp_tool_call": return `${str(item["server"])}.${str(item["tool"])}`;
    case "command_execution": return "command";
    case "file_change": return "file_change";
    case "web_search": return "web_search";
    default: return "";
  }
}

function okOf(item: Json): boolean {
  if (item["error"] !== undefined && item["error"] !== null) return false;
  const status = str(item["status"]);
  if (status === "failed" || status === "declined") return false;
  const code = item["exit_code"];
  return typeof code === "number" ? code === 0 : true;
}

export function createCodexDecoder(): CliDecoder {
  const called = new Set<string>();
  let lastError = "";
  let ended = false;

  return {
    push(line) {
      const j = parseLine(line);
      if (!j) return [];
      switch (str(j["type"])) {
        case "thread.started": return str(j["thread_id"]) !== "" ? [{ type: "session", id: str(j["thread_id"]) }] : [];
        case "item.started": {
          const item = obj(j["item"]);
          const name = item ? nameOf(item) : "";
          if (!item || name === "" || str(item["id"]) === "" || called.has(str(item["id"]))) return [];
          called.add(str(item["id"]));
          return [{ type: "tool", phase: "call", id: str(item["id"]), name }];
        }
        case "item.completed": {
          const item = obj(j["item"]);
          if (!item) return [];
          const t = str(item["type"]);
          if (t === "agent_message") return str(item["text"]) !== "" ? [{ type: "text", text: str(item["text"]) }] : [];
          if (t === "reasoning") return str(item["text"]) !== "" ? [{ type: "thinking", text: str(item["text"]) }] : [];
          const name = nameOf(item);
          if (name === "" || str(item["id"]) === "") return [];
          const out: CliEvent[] = [];
          if (!called.has(str(item["id"]))) { called.add(str(item["id"])); out.push({ type: "tool", phase: "call", id: str(item["id"]), name }); }
          out.push({ type: "tool", phase: "result", id: str(item["id"]), ok: okOf(item) });
          return out;
        }
        case "turn.completed": {
          if (ended) return [];
          ended = true;
          const u = obj(j["usage"]);
          const out: CliEvent[] = [];
          const input = num(u?.["input_tokens"]);
          const output = num(u?.["output_tokens"]);
          if (input > 0 || output > 0) out.push({ type: "usage", inputTokens: input, outputTokens: output });
          out.push({ type: "end" });
          return out;
        }
        case "turn.failed": {
          if (ended) return [];
          ended = true;
          const e = obj(j["error"]);
          return [{ type: "end", error: { message: str(e?.["message"]) || lastError || "the engine reported an error" } }];
        }
        case "error": {
          const message = str(j["message"]);
          if (message !== "") lastError = message;
          // Codex reports an MCP server that did not start as an error line and carries on without its tools.
          if (MCP_FAILURE.test(message) && /vyre/i.test(message)) return [{ type: "mcp", status: "failed", detail: message.slice(0, 200) }];
          return [];
        }
        default: return [];
      }
    },
    finish() {
      if (ended) return [];
      ended = true;
      return lastError !== "" ? [{ type: "end", error: { message: lastError } }] : [];
    },
  };
}

export const codex: CliAdapter = {
  id: "codex",
  bin: "codex",
  persistent: false,
  models: [{ id: "gpt-5-codex", label: "GPT-5 Codex" }, { id: "gpt-5", label: "GPT-5" }],
  systemFlag: false,
  env: () => ({}),
  command(o: CommandOptions) {
    const toml = (v: string): string => JSON.stringify(v);
    return [
      "codex", "exec", "--json", "--skip-git-repo-check",
      // Codex's own sandbox stays on inside ours: read-only unless a work folder was granted and the chat is not in plan mode.
      "-c", `sandbox_mode=${toml(o.workFolder !== null && !o.planMode && o.noTools !== true ? "workspace-write" : "read-only")}`,
      // ASSUMED until the live recording: Codex's stdio server block takes command, args and env_vars (names of variables to pass on), as its HTTP block takes bearer_token_env_var.
      ...(o.noTools === true ? [] : o.mcpStdio
        ? ["-c", `mcp_servers.vyre.command=${toml(o.mcpStdio.command)}`, "-c", `mcp_servers.vyre.args=[${o.mcpStdio.args.map(toml).join(", ")}]`, "-c", `mcp_servers.vyre.env_vars=[${toml(TOKEN_ENV)}]`]
        : ["-c", `mcp_servers.vyre.url=${toml(o.mcpUrl)}`, "-c", `mcp_servers.vyre.bearer_token_env_var=${toml(TOKEN_ENV)}`]),
      // installed plugin MCP servers (same unproven -c form as vyre's); a secret is passed by variable name, the host fills it from the Vault
      ...Object.entries(o.plugins?.mcpServers ?? {}).flatMap(([n, m]) => [
        "-c", `mcp_servers.plugin_${n}.command=${toml(m.command)}`, "-c", `mcp_servers.plugin_${n}.args=[${m.args.map(toml).join(", ")}]`,
        ...(Object.keys(m.env).length ? ["-c", `mcp_servers.plugin_${n}.env_vars=[${Object.keys(m.env).map(toml).join(", ")}]`] : []),
      ]),
      ...(o.model !== null ? ["-m", o.model] : []),
      ...(o.resume !== null ? ["resume", o.resume] : []),
      // The prompt comes on stdin.
      "-",
    ];
  },
  encode: (prompt) => prompt,
  decoder: createCodexDecoder,
};
