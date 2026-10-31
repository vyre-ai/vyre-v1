// Grok Build headless (ARCH 6.6): `grok -p --output-format stream-json`. Each turn is one process that resumes the engine's session; the prompt comes on stdin.
//
// CHECKED against xAI's published CLI docs (docs.x.ai/build/cli/headless-scripting, 30 Oct 2026): `-p, --single <PROMPT>` runs one prompt; `--output-format` takes plain, json or streaming-json (NOT "stream-json");
// `-r, --resume <ID>`, `-m, --model`, `--no-auto-update` and `XAI_API_KEY` exist. The docs do not give the streaming-json event schema, an MCP flag, or how a prompt on stdin is read.
// STILL NEEDS A REAL ACCOUNT to prove (the golden streams in agent/fixtures/golden-streams are written to this schema and are replaced by recordings then):
//  - the streaming-json event schema is Claude Code's (Grok Build reads Claude Code's conventions), so the Claude decoder is used;
//  - `--mcp-config` means what it means for Claude Code, and the prompt is read from stdin when -p has no value;
//  - tool approval in headless mode: the docs name only `--always-approve`; Vyre does not pass it (its tools are gated by Vyre), so whether Grok's MCP calls run unattended is unproven.
// Measured in 0.6 on Grok Build 1.0.46: it imports MCP servers from ~/.claude.json and ~/.cursor/mcp.json unless switched off, so a Vyre session turns both off and gets Vyre's server only.
import { createClaudeDecoder, mcpConfigJson } from "./claude.ts";
import type { Effort } from "../../turn-engine/types.ts";
import type { CliAdapter, CommandOptions } from "./types.ts";

/**
 * CHECKED against `grok --help` (1.0.70): `--permission-mode` takes default, acceptEdits, auto, dontAsk, bypassPermissions, plan (a value outside the list is refused at parse), and `--reasoning-effort`
 * (alias `--effort`) takes a free value. Ask first is default, Auto is acceptEdits, Plan is plan. Vyre never passes --always-approve or bypassPermissions: Auto here is the CLI's accept-edits mode, and
 * whatever leaves Vyre is held by the Gate behind the MCP tools in every mode. Max maps to high, the highest effort named in the CLI's strings; an unknown value is the CLI's to refuse.
 */
export function grokPermission(o: Pick<CommandOptions, "mode" | "planMode">): "default" | "acceptEdits" | "plan" | null {
  const mode = o.mode ?? (o.planMode ? "plan" : undefined);
  return mode === undefined ? null : mode === "plan" ? "plan" : mode === "auto" ? "acceptEdits" : "default";
}
export const grokEffort = (e: Effort | null | undefined): string | null => (e === undefined || e === null ? null : e === "max" ? "high" : e);

export const grok: CliAdapter = {
  id: "grok",
  bin: "grok",
  persistent: false,
  models: [{ id: "grok-4", label: "Grok 4" }, { id: "grok-code-fast-1", label: "Grok Code Fast" }],
  systemFlag: false,
  env: () => ({ GROK_CLAUDE_MCPS_ENABLED: "0", GROK_CURSOR_MCPS_ENABLED: "0" }),
  command(o: CommandOptions) {
    return [
      "grok", "-p", "--output-format", "streaming-json", "--no-auto-update",
      "--mcp-config", mcpConfigJson(o.mcpUrl, o.mcpStdio),
      ...(grokPermission(o) !== null ? ["--permission-mode", grokPermission(o)!] : []),
      ...(o.model !== null ? ["-m", o.model] : []),
      ...(grokEffort(o.effort) !== null ? ["--reasoning-effort", grokEffort(o.effort)!] : []),
      ...(o.resume !== null ? ["--resume", o.resume] : []),
    ];
  },
  encode: (prompt) => prompt,
  decoder: createClaudeDecoder,
};
