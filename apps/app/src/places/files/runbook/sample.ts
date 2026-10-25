// The sample behind the runbook tests and screenshots: the note "Deploy website.md" with four shell blocks (the prototype's Runbooks/Deploy website.md), the server and four agent computers,
// and a small scripted shell. `call` answers runbooks.run, runbooks.set_target and runs.stop and writes the runs and their output into the fake replica, so the live queries of the screen
// (runbooks.parse, runs.list, runs.get, targets) update the way the kernel's would. The shell prints one line per tick: `tick()` is one step, `drain()` runs everything to the end,
// `autoplay` ticks on a timer for the screenshot page. On an agent's computer `npm` is not installed (exit 127), which is how Run all shows stopping at the first error.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { RunbookData } from "./data.tsx";
import { SERVER, parseRunnable } from "./model.ts";
import type { BlockRow, RunRow, Target, TargetRow } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
export const NOTE_ID = "fil_rb_deploy";
const MIN = 60_000;

export const DEPLOY_TEXT = [
  "# Deploy website", "",
  "Run these in order. Each block can run on its own, or use Run all to go top to bottom. It stops at the first block that fails.", "",
  "## 1. Get the latest code", "", "```sh", "git pull origin main", "```", "",
  "## 2. Build", "", "The build takes about fifteen seconds. If it fails, stop and tell the team.", "", "```sh", "npm ci && npm run build", "```", "",
  "## 3. Ship it", "", "```sh", "railway up --service website --detach", "```", "",
  "## 4. Check the site", "", "A healthy site answers with 200.", "", "```sh", "curl -sI https://vyre.run | head -1", "```", "",
].join("\n");

export const COMPUTERS: ReadonlyArray<{ id: string; name: string; online: boolean }> = [
  { id: "cmp_docs", name: "Docs's computer", online: true },
  { id: "cmp_intake", name: "Intake's computer", online: true },
  { id: "cmp_assistant", name: "Assistant's computer", online: true },
  { id: "cmp_research", name: "Research's computer", online: true },
];
const targetRows = (): TargetRow[] => [
  { target: SERVER, name: "Space server", online: true },
  ...COMPUTERS.map((c): TargetRow => ({ target: { kind: "computer", computerId: c.id }, name: c.name, online: c.online })),
];

interface Script { lines: string[]; exit: number; ms: number }

/** What a command prints and how long it takes (a scripted stand-in for the real shell). */
export function script(code: string, onComputer: boolean): Script {
  const c = code.trim();
  if (onComputer && /npm (ci|run)/.test(c)) return { lines: ["zsh: command not found: npm", "This computer has no Node installed."], exit: 127, ms: 400 };
  if (/^git pull/.test(c)) return { lines: ["From github.com:vyre-ai/website", " * branch            main       -> FETCH_HEAD", "Already up to date."], exit: 0, ms: 900 };
  if (/npm ci/.test(c)) {
    return { lines: ["added 312 packages in 9s", "", "> website@0.4.2 build", "> next build", "", "Creating an optimized production build ...", "Compiled successfully", "Collecting page data ...", "Generating static pages (14/14)", "", "Route (app)                  Size", "/                            4.1 kB", "/pricing                     2.8 kB", "/about                       1.9 kB"], exit: 0, ms: 14_200 };
  }
  if (/railway up/.test(c)) return { lines: ["Indexing...", "Uploading...", "Build Logs: https://railway.com/project/website/service/web", "Deployed. Service web is live."], exit: 0, ms: 6300 };
  if (/curl/.test(c)) return { lines: ["HTTP/2 200"], exit: 0, ms: 700 };
  return { lines: ["done"], exit: 0, ms: 500 };
}

interface Job { runId: string; ids: string[]; scripts: Script[]; i: number; line: number; seq: number; all: boolean }

export type Variant = "fresh" | "ran" | "fail" | "running";

export interface SampleRunbook {
  data: RunbookData;
  replica: FakeReplica;
  fileId: string;
  text: string;
  calls: { cap: string; input: unknown }[];
  copied: string[];
  /** One step of the shell: a line of output, or the end of a block. False when nothing is running. */
  tick(): boolean;
  /** Run everything that is going to the end. */
  drain(): void;
  /** The blocks of the note, as runbooks.parse returns them. */
  blocks(): BlockRow[];
  runs(): RunRow[];
  failNext(cap: string, code: string): void;
  dispose(): void;
}

export function createSampleRunbook(variant: Variant = "fresh", o: { autoplay?: boolean; text?: string } = {}): SampleRunbook {
  const text = o.text ?? DEPLOY_TEXT;
  const replica = createFakeReplica("spc_northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const copied: string[] = [];
  const failing = new Map<string, string>();
  const clock = { now: SAMPLE_NOW, offsetMin: 0 };
  const jobs: Job[] = [];
  let actor = "Irfad Imtiaz";
  let seq = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  replica.put("meta", [{ id: NOTE_ID, text } as Row]);
  const meta = (): { text: string; target?: Target } => replica.rows("meta")[0] as unknown as { text: string; target?: Target };
  const runRow = (id: string): RunRow & Row => replica.rows("runs").find((r) => r.id === id) as unknown as RunRow & Row;
  const patchRun = (id: string, patch: Partial<RunRow>): void => replica.put("runs", [{ ...runRow(id), ...patch } as unknown as Row]);
  const patchBlock = (id: string, blockId: string, patch: Partial<RunRow["blocks"][number]>): void => {
    const r = runRow(id);
    patchRun(id, { blocks: r.blocks.map((b) => (b.blockId === blockId ? { ...b, ...patch } : b)) });
  };

  replica.resolve("runbooks.parse", () => ({ title: "Deploy website", blocks: parseRunnable(meta().text), ...(meta().target ? { runsOn: meta().target as Target } : {}) }) as CapMap["runbooks.parse"]["out"]);
  replica.resolve("runbooks.targets", () => ({ targets: targetRows() }));
  replica.resolve("runbooks.runs.list", (_t, input) => ({ runs: (replica.rows("runs") as unknown as RunRow[]).filter((r) => r.fileId === input.fileId).sort((a, b) => b.at - a.at) }) as CapMap["runbooks.runs.list"]["out"]);
  replica.resolve("runbooks.runs.get", (_t, input) => {
    const run = (replica.rows("runs") as unknown as RunRow[]).find((r) => r.runId === input.runId);
    const out = (replica.rows("out") as unknown as { runId: string; blockId: string; seq: number; stream: "stdout" | "stderr"; text: string }[])
      .filter((x) => x.runId === input.runId && (input.blockId === undefined || x.blockId === input.blockId) && x.seq > (input.after ?? -1))
      .sort((a, b) => a.seq - b.seq)
      .map(({ blockId, seq: n, stream, text: t }) => ({ blockId, seq: n, stream, text: t }));
    return { run: run as RunRow, output: out } as CapMap["runbooks.runs.get"]["out"];
  });

  const start = (): void => {
    if (!o.autoplay || timer !== null) return;
    timer = setInterval(() => { if (!tick() && timer !== null) { clearInterval(timer); timer = null; } }, 170);
  };

  function tick(): boolean {
    const job = jobs[0];
    if (!job) return false;
    const id = job.ids[job.i] as string;
    const sc = job.scripts[job.i] as Script;
    if (job.line < sc.lines.length) {
      replica.put("out", [{ id: `${job.runId}:${job.seq}`, runId: job.runId, blockId: id, seq: job.seq, stream: sc.exit !== 0 && job.line > 0 ? "stderr" : "stdout", text: sc.lines[job.line] as string } as Row]);
      job.seq += 1;
      job.line += 1;
      patchBlock(job.runId, id, { ms: Math.round((sc.ms * job.line) / sc.lines.length) });
      return true;
    }
    const ok = sc.exit === 0;
    patchBlock(job.runId, id, { state: ok ? "succeeded" : "failed", exit: sc.exit, ms: sc.ms });
    const finish = (state: RunRow["state"], exit: number): void => {
      const r = runRow(job.runId);
      patchRun(job.runId, { state, exit, durationMs: r.blocks.reduce((n, b) => n + (b.ms ?? 0), 0) });
      jobs.shift();
    };
    if (!ok && job.all) {
      for (const rest of job.ids.slice(job.i + 1)) patchBlock(job.runId, rest, { state: "stopped" });
      finish("failed", sc.exit);
      return true;
    }
    job.i += 1;
    job.line = 0;
    if (job.i >= job.ids.length) { finish(ok ? "succeeded" : "failed", sc.exit); return true; }
    patchBlock(job.runId, job.ids[job.i] as string, { state: "running" });
    return true;
  }

  const drain = (): void => { let guard = 0; while (tick() && guard++ < 5000); };

  const writes: Record<string, (i: any) => unknown> = {
    "runbooks.run": (i: { fileId: string; blockId?: string; all?: boolean; target?: Target }) => {
      const blocks = parseRunnable(meta().text);
      const target = i.target ?? meta().target ?? SERVER;
      const ids = i.all ? blocks.map((b) => b.blockId) : [i.blockId as string];
      if (!ids.length || ids.some((id) => !blocks.some((b) => b.blockId === id))) throw Object.assign(new Error("validation.precondition_failed"), { code: "validation.precondition_failed" });
      const computer = COMPUTERS.find((c) => target.kind === "computer" && c.id === target.computerId);
      if (target.kind === "computer" && (!computer || !computer.online)) throw Object.assign(new Error("validation.precondition_failed"), { code: "validation.precondition_failed" });
      if (jobs.length) throw Object.assign(new Error("validation.conflict"), { code: "validation.conflict" });
      const runId = `run_${++seq}`;
      const scripts = ids.map((id) => script((blocks.find((b) => b.blockId === id) as BlockRow).code, target.kind === "computer"));
      const row: RunRow = { runId, fileId: i.fileId, versionId: "ver_1", by: actor, target, at: clock.now, state: "running", all: i.all === true, blocks: ids.map((blockId, n): RunRow["blocks"][number] => ({ blockId, state: n === 0 ? "running" : "queued" })) };
      replica.put("runs", [{ id: runId, ...row } as unknown as Row]);
      jobs.push({ runId, ids, scripts, i: 0, line: 0, seq: 0, all: i.all === true });
      start();
      return { runId };
    },
    "runbooks.set_target": (i: { target: Target }) => { replica.put("meta", [{ id: NOTE_ID, text: meta().text, target: i.target } as unknown as Row]); return { ok: true }; },
    "runs.stop": (i: { runId: string }) => {
      const job = jobs[0];
      if (!job || job.runId !== i.runId) return { run: runRow(i.runId) };
      const id = job.ids[job.i] as string;
      replica.put("out", [{ id: `${job.runId}:${job.seq}`, runId: job.runId, blockId: id, seq: job.seq, stream: "stdout", text: "^C" } as Row]);
      patchBlock(job.runId, id, { state: "stopped", exit: 130 });
      for (const rest of job.ids.slice(job.i + 1)) patchBlock(job.runId, rest, { state: "stopped" });
      const r = runRow(job.runId);
      patchRun(job.runId, { state: "stopped", exit: 130, durationMs: r.blocks.reduce((n, b) => n + (b.ms ?? 0), 0) });
      jobs.shift();
      return { run: runRow(i.runId) };
    },
  };

  const data: RunbookData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      const code = failing.get(cap);
      if (code) { failing.delete(cap); throw Object.assign(new Error(code), { code }); }
      const w = writes[cap];
      if (!w) throw new Error(`no answer for ${cap}`);
      return w(input);
    },
    clock: () => clock,
    copy: (t) => void copied.push(t),
  };

  // seeds: earlier runs, made with the same shell at earlier times
  const earlier = (by: string, minutesAgo: number, target: Target, all: boolean, blockIndex?: number): void => {
    const saved = { now: clock.now, actor };
    clock.now = SAMPLE_NOW - minutesAgo * MIN;
    actor = by;
    const blocks = parseRunnable(text);
    void writes["runbooks.run"]!({ fileId: NOTE_ID, target, ...(all ? { all: true } : { blockId: (blocks[blockIndex ?? 0] as BlockRow).blockId }) });
    drain();
    clock.now = saved.now;
    actor = saved.actor;
  };
  const intake: Target = { kind: "computer", computerId: "cmp_intake" };
  if (variant === "ran") {
    earlier("Intake", 110, intake, true);
    earlier("Docs", 6, SERVER, true);
  } else if (variant === "fail") {
    replica.put("meta", [{ id: NOTE_ID, text, target: intake } as unknown as Row]);
    earlier("Intake", 2, intake, true);
  } else if (variant === "running") {
    void writes["runbooks.run"]!({ fileId: NOTE_ID, all: true, target: SERVER });
    for (let n = 0; n < 5 + 9; n++) tick(); // block 1 done, block 2 half printed
  }

  return {
    data, replica, fileId: NOTE_ID, text, calls, copied, tick, drain,
    blocks: () => parseRunnable(meta().text),
    runs: () => (replica.rows("runs") as unknown as RunRow[]).sort((a, b) => b.at - a.at),
    failNext: (cap, code) => void failing.set(cap, code),
    dispose: () => { if (timer !== null) { clearInterval(timer); timer = null; } },
  };
}
