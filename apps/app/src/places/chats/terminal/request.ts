// "Run this" (rc.8): an agent asked the person to run a command (terminal.request). Run in my terminal types the command on the host and waits for the person to press Enter; the card then watches the
// session until the command is done and hands what it printed back as the answer. Nothing runs without the person pressing Enter, and what comes back is what terminal.read returns (already scrubbed).
import type { CapMap } from "../../../../../../generated/types.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Row = CapMap["terminal.list"]["out"]["terminals"][number];

export interface RunDeps { call: Call; newKey(): string; sleep?: (ms: number) => Promise<void> }
export interface RunTarget { host?: "agent_computer" | "space_server" | "device"; agentId?: string }

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The session to type in: the newest live one on that kind of host, else a new one. */
export async function sessionFor(d: RunDeps, t: RunTarget): Promise<string> {
  const host = t.host ?? "device";
  const list = ((await d.call("terminal.list", {})) as CapMap["terminal.list"]["out"]).terminals as Row[];
  const hit = list.filter((r) => r.state !== "exited" && r.host === host && (host !== "agent_computer" || t.agentId === undefined || r.agentId === t.agentId)).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (hit) return hit.terminalId;
  const key = d.newKey();
  const opened = host === "space_server"
    ? ((await d.call("terminal.open_server", { idempotencyKey: key })) as { terminal: { terminalId: string } })
    : ((await d.call("terminal.open", { host, ...(host === "agent_computer" && t.agentId ? { agentId: t.agentId } : {}), idempotencyKey: key })) as { terminal: { terminalId: string } });
  return opened.terminal.terminalId;
}

/** Type the command without Enter, and remember where the screen was, so the output that follows is the command's. */
export async function typeCommand(d: RunDeps, terminalId: string, command: string): Promise<{ cursor: number }> {
  const at = (await d.call("terminal.read", { terminalId, lines: 1 })) as { next: number };
  await d.call("terminal.input", { terminalId, data: command });
  return { cursor: at.next };
}

export interface Waited { state: "done" | "exited" | "timeout"; output: string }

/** Watch the session: Enter makes it running, and running then idle is the command done. Gives up after `timeoutMs`; the output is whatever was printed since the command was typed. */
export async function waitForRun(d: RunDeps, terminalId: string, cursor: number, o: { everyMs?: number; timeoutMs?: number; startMs?: number } = {}): Promise<Waited> {
  const sleep = d.sleep ?? realSleep;
  const every = o.everyMs ?? 1000;
  const limit = o.timeoutMs ?? 600_000;
  let waited = 0;
  let sawRunning = false;
  let state: Waited["state"] = "timeout";
  while (waited <= limit) {
    const rows = ((await d.call("terminal.status", { terminalIds: [terminalId] }).catch(() => ({ rows: [] }))) as { rows: Array<{ state: string }> }).rows;
    const s = rows[0]?.state;
    if (s === "exited") { state = "exited"; break; }
    if (s === "running") sawRunning = true;
    else if (s === "idle" && sawRunning) { state = "done"; break; }
    await sleep(every);
    waited += every;
  }
  const read = (await d.call("terminal.read", { terminalId, since: cursor }).catch(() => ({ text: "" }))) as { text: string };
  return { state, output: read.text };
}

const TAIL = 4000;

/** What goes back to the agent: that it ran and what it printed (the end of it when long), or that the person did not finish it. */
export function answerOf(w: Waited, command: string): { other: string } {
  const tail = w.output.length > TAIL ? `…${w.output.slice(-TAIL)}` : w.output;
  const lead = w.state === "done" ? "Ran in my terminal." : w.state === "exited" ? "The terminal closed before it finished." : "I typed it but it was still running when I stopped waiting.";
  return { other: `${lead}\n$ ${command}\n${tail}`.trim() };
}
