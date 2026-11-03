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
import type { Effort } from "../../turn-engine/types.ts";
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

/**
 * The chat mode as Codex's own settings. CHECKED against codex-cli 0.164 (`codex exec --help`, `codex --help`): `-s/--sandbox` takes read-only, workspace-write, danger-full-access; the approval policy is
 * `-a/--ask-for-approval` (on-request, never) but only on the interactive command, so `exec` takes it as the config key `approval_policy` through `-c`, the way the sandbox already is. A headless run cannot
 * stop and ask, so Ask first and Plan both run read-only (the model describes a change and the person says yes in the chat, or picks Auto); Auto runs workspace-write when a work folder was granted.
 * Codex has no plan mode in `exec`: Plan is read-only plus the plan instruction the engine puts in the turn context, and Vyre's own tools refuse writes in plan mode on the MCP side.
 * Nothing here is ever danger-full-access or --dangerously-bypass-approvals-and-sandbox.
 */
export function codexSandbox(o: Pick<CommandOptions, "mode" | "planMode" | "workFolder" | "noTools">): "workspace-write" | "read-only" {
  const mode = o.mode ?? (o.planMode ? "plan" : "auto");   // no mode: the older rule, writable inside a granted folder unless plan mode
  return o.workFolder !== null && mode === "auto" && o.noTools !== true ? "workspace-write" : "read-only";
}
/**
 * The leanest Codex call (a memory learning pass): ephemeral, no user config, rules, AGENTS.md, environment, permission, app, collaboration or skill text, no shell, web search, agents, goals,
 * images, apps, plugins or hooks, and `instructions` replacing Codex's own instructions. CHECKED against codex-cli 0.166 with a recording endpoint: about 1,550 characters (some 500 tokens) besides
 * our instructions and message, of which 1,357 are the request_user_input tool no switch removes; without these flags about 37,000 (some 11,000 tokens). `base_instructions` is ignored by this
 * version and `model_instructions_file` needs a real file, so the instructions go in through `instructions`.
 */
export function codexLean(o: Pick<CommandOptions, "model" | "system">): string[] {
  const toml = (v: string): string => JSON.stringify(v);
  const off = ["shell_tool", "unified_exec", "multi_agent", "goals", "view_image", "apps", "plugins", "skill_search", "image_generation", "hooks", "shell_snapshot"];
  return [
    "codex", "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
    "-c", `sandbox_mode=${toml("read-only")}`, "-c", `approval_policy=${toml("never")}`,
    "-c", `instructions=${toml(o.system ?? "")}`,
    "-c", "include_environment_context=false", "-c", "include_permissions_instructions=false", "-c", "include_apps_instructions=false", "-c", "include_collaboration_mode_instructions=false",
    "-c", "project_doc_max_bytes=0", "-c", `web_search=${toml("disabled")}`, "-c", "skills.include_instructions=false", "-c", "skills.bundled.enabled=false",
    "-c", `model_reasoning_effort=${toml("low")}`,
    ...off.flatMap((f) => ["--disable", f]),
    ...(o.model !== null ? ["-m", o.model] : []),
    "-",
  ];
}

/** `model_reasoning_effort` is the config key Codex itself writes (low, medium, high are the values its config files show); max is high, as xhigh is not proven on every account. */
export const codexEffort = (e: Effort | null | undefined): string | null => (e === undefined || e === null ? null : e === "max" ? "high" : e);

const SECRET_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * A plugin's stdio server as Codex starts it. Codex gives a server only a short default environment, the plain values of its `env` table and the variables named in `env_vars`, by the same name, from
 * Codex's own environment (it never expands "${NAME}" inside a value). A secret is filled into Codex's environment under Vyre's own name (VYRE_PLUGIN_<n>, never the server's name: a plugin naming
 * OPENAI_API_KEY must not replace Codex's own key), so the server starts through sh, which moves the value to the name the server reads and drops Vyre's. Null when a name cannot be passed safely.
 * CHECKED against codex-cli 0.166 on a real run (see the overrides below).
 */
export function codexServer(m: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> }): { command: string; args: string[]; env: Record<string, string>; envVars: string[] } | null {
  const env: Record<string, string> = {};
  const moves: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(m.env)) {
    if (!ENV_NAME.test(k)) return null;
    const ref = SECRET_REF.exec(v);
    if (ref) moves.push([k, ref[1]!]); else env[k] = v;
  }
  if (moves.length === 0) return { command: m.command, args: [...m.args], env, envVars: [] };
  const script = `${moves.map(([to, from]) => `export ${to}="$${from}"; unset ${from};`).join(" ")} exec "$0" "$@"`;
  return { command: "/bin/sh", args: ["-c", script, m.command, ...m.args], env, envVars: moves.map(([, from]) => from) };
}

export const codex: CliAdapter = {
  id: "codex",
  bin: "codex",
  persistent: false,
  // the default the pinned CLI names; the account's own list comes from the CLI itself (models.ts, `codex app-server` model/list)
  models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }],
  systemFlag: false,
  env: () => ({}),
  command(o: CommandOptions) {
    if (o.lean === true) return codexLean(o);
    const toml = (v: string): string => JSON.stringify(v);
    return [
      "codex", "exec", "--json", "--skip-git-repo-check",
      // Codex's own sandbox stays on inside ours: read-only unless a work folder was granted and the chat is not in plan mode.
      "-c", `sandbox_mode=${toml(codexSandbox(o))}`,
      // Codex's workspace-write sandbox cuts its commands off the network unless told otherwise; Vyre's wall around it applies the Space's internet setting, so the commands may use the network
      // the wall allows (npm install, git clone, curl). The key is from Codex's config reference ([sandbox_workspace_write] network_access); not yet seen on a live run.
      "-c", "sandbox_workspace_write.network_access=true",
      ...(o.mode !== undefined ? ["-c", `approval_policy=${toml("never")}`] : []),
      ...(codexEffort(o.effort) !== null ? ["-c", `model_reasoning_effort=${toml(codexEffort(o.effort)!)}`] : []),
      // Codex's stdio server block takes command, args, env (plain values) and env_vars (names of variables passed on from Codex's environment). CHECKED against codex-cli 0.166 (a real run on a build box,
      // 3 Nov 2026): a plugin server started from these overrides saw its secret under its own name and its plain value, and neither Vyre's name for the secret nor Codex's own key. The HTTP form
      // (url, bearer_token_env_var) is still unproven.
      ...(o.noTools === true ? [] : o.mcpStdio
        ? ["-c", `mcp_servers.vyre.command=${toml(o.mcpStdio.command)}`, "-c", `mcp_servers.vyre.args=[${o.mcpStdio.args.map(toml).join(", ")}]`, "-c", `mcp_servers.vyre.env_vars=[${toml(TOKEN_ENV)}]`]
        : ["-c", `mcp_servers.vyre.url=${toml(o.mcpUrl)}`, "-c", `mcp_servers.vyre.bearer_token_env_var=${toml(TOKEN_ENV)}`]),
      // installed plugin MCP servers: a plain value is set in the server's env, a secret reaches it through codexServer below; the host fills the secret from the Vault into Codex's environment
      ...Object.entries(o.plugins?.mcpServers ?? {}).flatMap(([n, m0]) => {
        const m = codexServer(m0);
        if (!m) return [];
        return [
          "-c", `mcp_servers.plugin_${n}.command=${toml(m.command)}`, "-c", `mcp_servers.plugin_${n}.args=[${m.args.map(toml).join(", ")}]`,
          ...Object.entries(m.env).flatMap(([k, v]) => ["-c", `mcp_servers.plugin_${n}.env.${k}=${toml(v)}`]),
          ...(m.envVars.length ? ["-c", `mcp_servers.plugin_${n}.env_vars=[${m.envVars.map(toml).join(", ")}]`] : []),
        ];
      }),
      ...(o.model !== null ? ["-m", o.model] : []),
      ...(o.resume !== null ? ["resume", o.resume] : []),
      // The prompt comes on stdin.
      "-",
    ];
  },
  encode: (prompt) => prompt,
  decoder: createCodexDecoder,
};
