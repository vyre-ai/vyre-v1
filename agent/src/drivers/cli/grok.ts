// Grok Build headless (ARCH 6.6): `grok -p --output-format stream-json`. Each turn is one process that resumes the engine's session; the prompt comes on stdin.
//
// ASSUMED until the S7 live recording runs against a real account (the golden streams in agent/fixtures/golden-streams are written to this schema and are replaced by recordings then):
//  - the stream-json event schema is Claude Code's (Grok Build reads Claude Code's conventions), so the Claude decoder is used;
//  - `--mcp-config`, `--resume` and `-m` mean what they mean for Claude Code.
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
      "grok", "-p", "--output-format", "stream-json", "--no-auto-update",
      "--mcp-config", mcpConfigJson(o.mcpUrl),
      ...(o.model !== null ? ["-m", o.model] : []),
      ...(o.resume !== null ? ["--resume", o.resume] : []),
    ];
  },
  encode: (prompt) => prompt,
  decoder: createClaudeDecoder,
};
