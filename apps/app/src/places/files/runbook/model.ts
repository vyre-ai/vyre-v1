// The runbook viewer's logic without a renderer (spec 2.16 Runbooks, 3.5 Files > run a runbook): where fenced shell blocks sit in the note, what a block's run looks like,
// what Run all says when it stops, how a run reads in History. A runbook is markdown; fenced `sh` or `bash` blocks get Run buttons, a "Runs on" bar picks the server or an
// agent computer, Run all goes top to bottom and stops at the first error, output streams under the block, every run is kept in History (who, where, when, exit, duration).
import type { CapMap } from "../../../../../../generated/types.ts";

export type Parse = CapMap["runbooks.parse"]["out"];
export type BlockRow = Parse["blocks"][number];
export type Target = { kind: "server" | "computer"; computerId?: string };
export type TargetRow = CapMap["runbooks.targets"]["out"]["targets"][number];
export type RunRow = CapMap["runbooks.runs.list"]["out"]["runs"][number];
export type RunState = RunRow["state"];
export type OutputRow = CapMap["runbooks.runs.get"]["out"]["output"][number];

export function blockIds(blocks: readonly BlockRow[]): string[] {
  const out: string[] = [];
  for (const b of blocks) out.push(b.blockId);
  return out;
}

export const SERVER: Target = { kind: "server" };

// ---------------------------------------------------------------- the note

export type Segment =
  | { kind: "prose"; text: string }
  | { kind: "code"; lang: string; code: string; line: number; /** index among the runnable blocks, the index runbooks.parse uses */ runIndex: number | null };

/** The runnable languages. The contract parses sh and bash; other fenced code is shown but has no Run button. */
export const RUNNABLE: readonly string[] = ["sh", "bash"];

/** Splits the note's text at its fenced blocks, keeping prose and code in order. Line is the 1-based line of the opening fence. */
export function splitRunbook(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /^```([\w-]*)[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm;
  let last = 0;
  let run = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before.trim()) out.push({ kind: "prose", text: before });
    const lang = (m[1] ?? "").toLowerCase();
    const runnable = RUNNABLE.includes(lang);
    out.push({ kind: "code", lang: m[1] ?? "", code: m[2] ?? "", line: text.slice(0, m.index).split("\n").length, runIndex: runnable ? run : null });
    if (runnable) run += 1;
    last = re.lastIndex;
  }
  const rest = text.slice(last);
  if (rest.trim()) out.push({ kind: "prose", text: rest });
  return out;
}

export const runnableCount = (segments: readonly Segment[]): number => segments.filter((s) => s.kind === "code" && s.runIndex !== null).length;

/** A stable id for a block: its index and a short hash of its code, so an edit above it does not rename it and an edit inside it does. */
export function blockIdOf(index: number, code: string): string {
  let h = 5381;
  for (let i = 0; i < code.length; i++) h = ((h << 5) + h + code.charCodeAt(i)) >>> 0;
  return `b${index}_${h.toString(16).slice(-4).padStart(4, "0")}`;
}

/** What runbooks.parse returns for a note's text (the kernel's handler does the same; the samples and tests use this one). */
export function parseRunnable(text: string): BlockRow[] {
  const rows: BlockRow[] = [];
  for (const s of splitRunbook(text)) {
    if (s.kind !== "code" || s.runIndex === null) continue;
    rows.push({ blockId: blockIdOf(s.runIndex, s.code), index: s.runIndex, lang: s.lang.toLowerCase() === "bash" ? "bash" : "sh", code: s.code, line: s.line });
  }
  return rows;
}

// ---------------------------------------------------------------- colours of a command line

export type Tok = { text: string; kind: "k" | "s" | "c" | "t" };
const COMMANDS = new Set(["git", "npm", "npx", "pnpm", "yarn", "rsync", "cd", "echo", "railway", "curl", "docker", "make", "ssh", "sudo", "export", "node", "pip", "python3", "brew", "cp", "mv", "rm", "mkdir"]);

/** One line of shell as coloured pieces: the first command word, quoted strings, a trailing comment. */
export function highlight(line: string): Tok[] {
  const out: Tok[] = [];
  const push = (text: string, kind: Tok["kind"]): void => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.text += text; else out.push({ text, kind });
  };
  let i = 0;
  let first = true;
  while (i < line.length) {
    const c = line[i] as string;
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) { push(line.slice(i), "c"); break; }
    if (c === '"' || c === "'") {
      const j = line.indexOf(c, i + 1);
      const end = j < 0 ? line.length : j + 1;
      push(line.slice(i, end), "s");
      i = end;
      first = false;
      continue;
    }
    if (/\s/.test(c)) { push(c, "t"); i += 1; continue; }
    let j = i;
    while (j < line.length && !/[\s"'#]/.test(line[j] as string)) j += 1;
    if (j === i) j = i + 1;
    const word = line.slice(i, j);
    push(word, first && COMMANDS.has(word) ? "k" : "t");
    first = false;
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- where it runs

export const sameTarget = (a: Target, b: Target): boolean => a.kind === b.kind && (a.computerId ?? "") === (b.computerId ?? "");

/** "Space server" or the computer's name from the targets list. */
export function targetName(t: Target, targets: readonly TargetRow[]): string {
  if (t.kind === "server") return "Space server";
  return targets.find((x) => sameTarget(x.target, t))?.name ?? "An agent's computer";
}

// ---------------------------------------------------------------- runs

export const isActive = (s: RunState): boolean => s === "queued" || s === "running";

export interface BlockStatus {
  runId: string;
  state: RunState;
  exit?: number;
  ms?: number;
  by: string;
  at: number;
  target: Target;
  /** True when the run was Run all (the block is one of several). */
  all: boolean;
}

/** The latest word on each block: the newest run that has the block, however it was run. */
export function latestByBlock(runs: readonly RunRow[]): Map<string, BlockStatus> {
  const out = new Map<string, BlockStatus>();
  const newest = [...runs].sort((a, b) => b.at - a.at);
  for (const r of newest) {
    for (const b of r.blocks) {
      if (out.has(b.blockId)) continue;
      out.set(b.blockId, { runId: r.runId, state: b.state, ...(b.exit !== undefined ? { exit: b.exit } : {}), ...(b.ms !== undefined ? { ms: b.ms } : {}), by: r.by, at: r.at, target: r.target, all: r.all });
    }
  }
  return out;
}

/** The Run all that is going now, if any. */
export const activeAll = (runs: readonly RunRow[]): RunRow | undefined => runs.find((r) => r.all && isActive(r.state));

/** "Stop · block 2 of 4": the position of the block that is running. */
export function progressLine(run: RunRow, order: readonly string[]): string {
  const running = run.blocks.find((b) => b.state === "running") ?? run.blocks.find((b) => b.state === "queued");
  const at = running ? order.indexOf(running.blockId) : -1;
  return at < 0 ? "Stop" : `Stop · block ${at + 1} of ${order.length}`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

/** The line after Run all ends, said once in words. Null while it is still going. */
export function allSummary(run: RunRow, order: readonly string[], where: string): string | null {
  if (!run.all || isActive(run.state)) return null;
  const failed = run.blocks.find((b) => b.state === "failed");
  if (failed) {
    const n = order.indexOf(failed.blockId) + 1;
    return `Stopped at block ${n}. It exited with ${failed.exit ?? 1}, so the blocks after it did not run.`;
  }
  if (run.state === "stopped") return "Stopped. The blocks after it did not run.";
  const ran = run.blocks.filter((b) => b.state === "succeeded").length;
  return `Ran ${ran} ${ran === 1 ? "block" : "blocks"} on ${where}. All finished with exit 0.`;
}

/** The status line under a block. */
export function statusWords(s: BlockStatus): { text: string; tone: "run" | "ok" | "bad" | "quiet" } {
  if (s.state === "running") return { text: "Running", tone: "run" };
  if (s.state === "queued") return { text: "Waiting", tone: "quiet" };
  if (s.state === "stopped" && s.exit === undefined) return { text: "Did not run", tone: "quiet" };
  const code = s.exit ?? (s.state === "succeeded" ? 0 : 1);
  return { text: `Exit ${code}`, tone: code === 0 ? "ok" : "bad" };
}

/** A block shows an output panel once it has been run or is waiting; a block that Run all never reached shows the quiet line only. */
export const hasOutputPanel = (s: BlockStatus): boolean => s.state !== "stopped" || s.exit !== undefined;

/** The output of one block as text, in the order it arrived. */
export function outputText(rows: readonly OutputRow[], blockId?: string): string {
  return rows.filter((r) => blockId === undefined || r.blockId === blockId).sort((a, b) => a.seq - b.seq).map((r) => r.text).join("\n");
}

/** History row title: "Block 2", "Run all", or "Run all · stopped at block 2". */
export function runLabel(run: RunRow, order: readonly string[]): string {
  if (!run.all) {
    const only = run.blocks[0];
    const n = only ? order.indexOf(only.blockId) + 1 : 0;
    return n > 0 ? `Block ${n}` : "Block";
  }
  const failed = run.blocks.find((b) => b.state === "failed");
  if (failed) return `Run all · stopped at block ${order.indexOf(failed.blockId) + 1}`;
  return run.state === "stopped" ? "Run all · stopped" : "Run all";
}

/** History row second line: where it ran, how it ended, how long it took. */
export function runDetail(run: RunRow, where: string): string {
  const end = isActive(run.state) ? "running" : run.exit !== undefined ? `exit ${run.exit}` : run.state;
  const dur = run.durationMs !== undefined ? ` · ${fmtDuration(run.durationMs)}` : "";
  return `${where} · ${end}${dur}`;
}

/** The newest runs first. */
export const newestFirst = (runs: readonly RunRow[]): RunRow[] => [...runs].sort((a, b) => b.at - a.at);

// ---------------------------------------------------------------- times

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9:41 am" for today, "Oct 24, 8:10 am" for another day. `offsetMin` is the person's UTC offset. */
export function fmtTime(at: number, now: number, offsetMin: number): string {
  const d = new Date(at + offsetMin * 60_000);
  const n = new Date(now + offsetMin * 60_000);
  const h = d.getUTCHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  const same = d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate();
  return same ? clock : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${clock}`;
}

/** What the person is told when a run call fails. */
export function runError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const text = `${typeof e?.code === "string" ? e.code : ""} ${typeof e?.message === "string" ? e.message : ""}`;
  if (text.includes("permission.needs_team")) return "Running commands needs a Team Space.";
  if (text.includes("permission")) return "You need Use on this file and terminal access to run it.";
  if (text.includes("conflict")) return "Something is already running. Wait for it, or stop it first.";
  if (text.includes("precondition")) return "That computer is not available. Pick another place to run it.";
  return "Could not run that. Try again.";
}
