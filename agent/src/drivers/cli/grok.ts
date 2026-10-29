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
import type { CliAdapter, CommandOptions } from "./types.ts";

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
      ...(o.model !== null ? ["-m", o.model] : []),
      ...(o.resume !== null ? ["--resume", o.resume] : []),
    ];
  },
  encode: (prompt) => prompt,
  decoder: createClaudeDecoder,
};
