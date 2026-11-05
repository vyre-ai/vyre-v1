// The hooks config a CLI engine is handed (lane l-hooks), so its own built-in tools and subagents pass through Vyre's hooks like every other model's. Each hook is the vyre-hook shim of the MCP bridge
// (modules/engine/mcp-bridge.ts): `<node> <shim> <socket> hook <Event>`. Vyre's own tools are asked by the tool session already, so only PreToolUse, PostToolUse and the subagent events are reported
// here, and the shim lets mcp__vyre__* calls go by. Claude Code, Grok and Codex all read the same shape.
//   Claude Code  `--settings <json>`: CHECKED, listed in `claude --help` (2.1.x).
//   Grok         `$HOME/.grok/hooks/*.json` and `<project>/.grok/hooks/*.json`, same shape (Grok Build 1.0.70 docs, in its binary). A headless `-p` run trusts your own hooks, not the project's: NOT proven on a real run.
//   Codex        `<project>/.codex/hooks.json`, trusted by a `hooks.state."<file>:<event>:<group>:<hook>".trusted_hash`. The hash is sha256 of the sorted-key JSON of {event_name, hooks:[hook]}, which
//                reproduces the hashes in a real ~/.codex/config.toml. The codex CLI was not installed here: NOT proven on a real run.
import { createHash } from "node:crypto";
import path from "node:path";
import type { CliId } from "./types.ts";

export interface Stdio { command: string; args: readonly string[] }
const EVENTS = ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop"] as const;
const TIMEOUT = 55;

const q = (s: string): string => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
/** The command a CLI runs for one event. */
export const shimCommand = (s: Stdio, event: string): string => `${[s.command, ...s.args].map(q).join(" ")} hook ${event}`;

export interface HooksJson { hooks: Record<string, Array<{ hooks: Array<{ type: "command"; command: string; timeout: number }> }>> }
export function hooksJson(s: Stdio): HooksJson {
  return { hooks: Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ type: "command" as const, command: shimCommand(s, e), timeout: TIMEOUT }] }]])) };
}
export const claudeSettings = (s: Stdio): string => JSON.stringify(hooksJson(s));

const snake: Record<string, string> = { PreToolUse: "pre_tool_use", PostToolUse: "post_tool_use", SubagentStart: "subagent_start", SubagentStop: "subagent_stop" };
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
/** What Codex records as trusted for one hook of ours. */
export function codexHash(event: string, command: string, timeout: number = TIMEOUT): string {
  return `sha256:${createHash("sha256").update(canon({ event_name: snake[event] ?? event, hooks: [{ async: false, command, timeout, type: "command" }] })).digest("hex")}`;
}
export const codexFile = (workFolder: string): string => path.join(workFolder, ".codex", "hooks.json");
/** The `-c` overrides that trust our Codex hooks and the work folder they sit in. */
export function codexTrust(workFolder: string, s: Stdio): string[] {
  const file = codexFile(workFolder);
  const toml = (v: string): string => JSON.stringify(v);
  return [
    "-c", `projects.${toml(workFolder)}.trust_level=${toml("trusted")}`,
    ...EVENTS.flatMap((e) => ["-c", `hooks.state.${toml(`${file}:${snake[e]}:0:0`)}.trusted_hash=${toml(codexHash(e, shimCommand(s, e)))}`]),
  ];
}

/** The files to write before the engine starts (absolute path to text). Claude Code needs none: its config is a flag. */
export function hookFiles(engine: CliId, o: { workFolder: string | null; stdio?: Stdio; home?: string }): Record<string, string> {
  if (!o.stdio || o.workFolder === null) return {};
  const text = `${JSON.stringify(hooksJson(o.stdio), null, 2)}\n`;
  if (engine === "codex") return { [codexFile(o.workFolder)]: text };
  if (engine === "grok") return { [path.join(o.workFolder, ".grok", "hooks", "vyre.json")]: text, ...(o.home ? { [path.join(o.home, ".grok", "hooks", "vyre.json")]: text } : {}) };
  return {};
}
