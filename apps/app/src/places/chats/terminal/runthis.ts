// Run on a code block in a message (rc.9): which blocks offer it, which machine it runs on, and what happens. The rc.8 rules stay: the command is judged (terminal.risk, the person's rules, the Gate in
// terminal.run) and anything that is not read-only is typed into the terminal and waits for the person to press Enter. Only a command that merely reads runs at once, and its output comes back here.
import type { CapMap } from "../../../../../../generated/types.ts";
import { openHostCall } from "./hosts.ts";
import type { HostChoice } from "./hosts.ts";
import { answerOf, typeCommand, waitForRun } from "./request.ts";
import type { RunDeps } from "./request.ts";
import type { Risk } from "./RiskDot.tsx";

type Row = CapMap["terminal.list"]["out"]["terminals"][number];

const SHELL = /^(sh|bash|zsh|shell|console|terminal|shellsession)$/i;
const MAX_LINE = 2000;

/** The one command in a fenced block, or null: not a shell block, empty, or more than one command (a newline typed into a terminal would run the first line before the person looks). */
export function commandOf(lang: string, text: string, closed: boolean): string | null {
  if (!closed || !SHELL.test(lang.trim())) return null;
  const lines = text.replace(/\s*\\\n\s*/g, " ").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  if (lines.length !== 1) return null;
  const line = lines[0]!.replace(/^[$>]\s+/, "");
  return line === "" || line.length > MAX_LINE ? null : line;
}

/** The newest live session on that machine, else a new one. */
export async function sessionOn(d: RunDeps, h: HostChoice): Promise<string> {
  const list = ((await d.call("terminal.list", {})) as CapMap["terminal.list"]["out"]).terminals as Row[];
  const hit = list
    .filter((r) => r.state !== "exited" && (h.kind === "server" ? r.host === "space_server" : h.kind === "agent" ? r.host === "agent_computer" && r.agentId === h.agentId : r.host === "device" && (h.deviceId === undefined || r.deviceId === h.deviceId)))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (hit) return hit.terminalId;
  const open = openHostCall(h, d.newKey());
  return ((await d.call(open.cap, open.input)) as { terminal: { terminalId: string } }).terminal.terminalId;
}

export async function riskOf(d: RunDeps, command: string): Promise<Risk> {
  try { return ((await d.call("terminal.risk", { command })) as { risk: Risk }).risk; } catch { return "change"; }
}

export type RunResult =
  | { s: "ran"; terminalId: string; exitCode: number | null; output: string }
  | { s: "typed"; terminalId: string; cursor: number }
  | { s: "refused"; why: string };

/** Read-only: run it and bring the output back. Anything else: type it and leave the Enter to the person. */
export async function runThis(d: RunDeps, h: HostChoice, command: string, risk: Risk): Promise<RunResult> {
  const terminalId = await sessionOn(d, h);
  if (risk === "read") {
    try {
      const r = (await d.call("terminal.run", { command, terminalId, idempotencyKey: d.newKey() })) as { exitCode: number | null; output: string };
      return { s: "ran", terminalId, exitCode: r.exitCode, output: r.output };
    } catch (e) {
      const m = (e as { message?: string }).message;
      return { s: "refused", why: typeof m === "string" && m !== "" ? m : "Could not run it." };
    }
  }
  const { cursor } = await typeCommand(d, terminalId, command);
  return { s: "typed", terminalId, cursor };
}

/** After the person pressed Enter: what it printed. */
export async function finish(d: RunDeps, terminalId: string, cursor: number, command: string): Promise<string> {
  return answerOf(await waitForRun(d, terminalId, cursor), command).other;
}
