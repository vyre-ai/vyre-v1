// Tool discovery, measured. Replays the tasks in tasks.ts through the REAL tool session (the listed set, tool_search ranking, loading, preloading and result hints are the code the engine runs) with a
// SCRIPTED model, so it costs nothing and gives the same numbers every run. The scripted model does what a careful one does: call a tool that is listed; otherwise tool_search for it with the
// words in the task row (first try, then the refined one), or, when the capability map names the tool, with the tool's own name; then call it. Per task it records the model calls, the input
// tokens (system + the tool list as sent + the conversation so far, summed over every call), whether every tool needed was there without a search, and the wall time (modelled: 2.5 s a call plus
// 25 ms per 1k input tokens, the same for every variant; the script's own run time is shown too).
//
//   node scripts/tool-discovery/measure.ts                 the baseline: what the engine does today
//   FEATURES=map,place,hints,learned node scripts/tool-discovery/measure.ts      with the features that exist switched on
//   JSON=1 ...                                              one JSON line per task and a summary, for diffing runs
import { readFileSync } from "node:fs";
import { createToolSession } from "../../agent/src/tools/call.ts";
import { buildCatalog, offerable, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import { slimTool } from "../../agent/src/drivers/api/slim.ts";
import { estimateTokens } from "../../lib/reply-format.ts";
import { CORE_READ_TOOLS, TEAMMATE_TOOLS } from "../../modules/engine/api-tools.ts";
import type { AgentToolRow, McpToolRow, RegistryCapRow, ToolCtx, ToolDef } from "../../agent/src/tools/types.ts";
import { MULTI, TASKS } from "./tasks.ts";
import type { Task } from "./tasks.ts";

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const FEATURES = new Set((process.env["FEATURES"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));

/** What every turn carries besides the tool list: identity, rules, the person, skills, history of a short chat (modules/engine/tests/context.sections.test.ts prints the parts). Constant across variants. */
const SYSTEM_BASE_TOKENS = 8000;
const MODEL_CALL_MS = 2500, MS_PER_1K_IN = 25, RESULT_TOKENS = 400, MAX_ROUNDS = 12;
/** What one tool call takes on the server (a read of a list). Sequential calls add up; calls made together cost the slowest. */
const TOOL_MS = 400;

const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
const mcp = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
const catalog = offerable(buildCatalog(reg.capabilities, mcp, reg.agentTools), () => false);
const defaults = parseDefaultTools(read("docs/frozen/agent-tools.md"));

export interface Row { id: string; area: string; modelCalls: number; tokensIn: number; searches: number; unprompted: boolean; found: boolean; wallMs: number }

/** What the features under test add: the map (text in the stable section), the tools a place preloads, and what is learned. Each is loaded only when its feature is on and its module exists. */
interface Features { mapText: string; preload(task: Task): string[] }
async function features(): Promise<Features> {
  let mapText = "";
  let placeTools: ((p: Task["place"]) => string[]) | undefined;
  if (FEATURES.has("map")) mapText = (await import("../../modules/engine/capability-map.ts")).CAPABILITY_MAP;
  if (FEATURES.has("place")) placeTools = (await import("../../modules/engine/place-tools.ts")).placeTools;
  // learned: one agent per area that has already done that area's tasks twice (the best case for it); its ten most used tools are listed at the start of the turn
  let top: ((area: string) => string[]) | undefined;
  if (FEATURES.has("learned")) {
    const { recordToolUse, topTools } = await import("../../modules/engine/tool-use.ts");
    const { harness } = await import("../../modules/engine/fixtures/harness.ts");
    const db = harness().ctx.db as never;
    for (const task of TASKS) for (const s of task.steps) if (!defaults.has(s.tool)) for (let i = 0; i < 2; i++) recordToolUse(db, `agt_${task.area}`, s.tool, 1000 + i);
    top = (area) => topTools(db, `agt_${area}`);
  }
  return { mapText, preload: (t) => [...TEAMMATE_TOOLS, ...CORE_READ_TOOLS, ...(placeTools ? placeTools(t.place) : []), ...(top ? top(t.area) : [])] };
}

async function runTask(task: Task, f: Features, n: number): Promise<Row> {
  const started = performance.now();
  const invoke = (async () => ({ status: "ok", output: { items: [] }, traceId: "trc_measure" })) as never;
  const session = createToolSession({ nextHints: true, invoke, catalog, defaults, levelFor: () => "manage", canEngineer: () => false });
  const threadId = `thr_${n}`;
  session.preload(threadId, f.preload(task));
  const ctx: ToolCtx = { space: "spc_m", agentId: "agt_m", asker: "usr_m", thread: { threadId, kind: task.place.kind, planMode: false, ...(task.place.scope ? { scope: task.place.scope } : {}) }, turnId: `trn_${n}` };

  const toolsNow = (): ToolDef[] => { const s = session.toolsFor(ctx); const have = session.loaded(threadId); return [...s.listed, ...s.searchable.filter((t) => have.has(t.name))]; };
  const have = (name: string): boolean => toolsNow().some((t) => t.name === name);
  const listTokens = (): number => estimateTokens(JSON.stringify(toolsNow().map((t) => slimTool({ name: t.name, description: t.summary, inputSchema: t.inputSchema ?? { type: "object", properties: {} } }))));
  const mapTokens = f.mapText ? estimateTokens(f.mapText) : 0;

  let context = estimateTokens(task.prompt), calls = 0, tokensIn = 0, searches = 0, found = true;
  const modelCall = (): void => { calls++; tokensIn += SYSTEM_BASE_TOKENS + mapTokens + listTokens() + context; };
  const unprompted = task.steps.every((s) => have(s.tool));

  outer: for (const step of task.steps) {
    if (!have(step.tool)) {
      // the map names tools: a model that has it asks for the tool by its own name
      const queries = [...(f.mapText.includes(step.tool) ? [step.tool] : []), step.natural, step.refined];
      for (const q of queries) {
        if (calls >= MAX_ROUNDS) { found = false; break outer; }
        modelCall(); searches++;
        const out = await session.call(ctx, "tool_search", { query: q });
        const size = out.kind === "result" ? estimateTokens(JSON.stringify(out.result.content)) : RESULT_TOKENS;
        context += 40 + size;
        if (have(step.tool)) break;
      }
      if (!have(step.tool)) { found = false; break; }
    }
    if (calls >= MAX_ROUNDS) { found = false; break; }
    modelCall();
    const out = await session.call(ctx, step.tool, {});
    context += 60 + (out.kind === "result" ? Math.max(RESULT_TOKENS, estimateTokens(JSON.stringify(out.result.content))) : RESULT_TOKENS);
  }
  modelCall();   // the answer
  const wallMs = calls * MODEL_CALL_MS + Math.round((tokensIn / 1000) * MS_PER_1K_IN);
  void started;
  return { id: task.id, area: task.area, modelCalls: calls, tokensIn, searches, unprompted, found, wallMs };
}

/**
 * A multi-part question: the steps are independent. Sequential, each step takes its own rounds one after another (the model asks for one tool per step). Parallel, every step takes its turn in the same
 * round: a step whose tool is not listed searches for it in that round, and all the calls of a round run together (the engine runs independent reads at once, six at most).
 */
async function runMultiTask(task: Task, f: Features, n: number, parallel: boolean): Promise<Row> {
  const invoke = (async () => ({ status: "ok", output: { items: [] }, traceId: "trc_measure" })) as never;
  const session = createToolSession({ nextHints: true, invoke, catalog, defaults, levelFor: () => "manage", canEngineer: () => false });
  const threadId = `thr_m${n}`;
  session.preload(threadId, f.preload(task));
  const ctx: ToolCtx = { space: "spc_m", agentId: "agt_m", asker: "usr_m", thread: { threadId, kind: task.place.kind, planMode: false }, turnId: `trn_m${n}` };
  const toolsNow = (): ToolDef[] => { const s = session.toolsFor(ctx); const have = session.loaded(threadId); return [...s.listed, ...s.searchable.filter((t) => have.has(t.name))]; };
  const have = (name: string): boolean => toolsNow().some((t) => t.name === name);
  const listTokens = (): number => estimateTokens(JSON.stringify(toolsNow().map((t) => slimTool({ name: t.name, description: t.summary, inputSchema: t.inputSchema ?? { type: "object", properties: {} } }))));
  const mapTokens = f.mapText ? estimateTokens(f.mapText) : 0;
  let context = estimateTokens(task.prompt), calls = 0, tokensIn = 0, searches = 0, toolMs = 0, found = true;
  const unprompted = task.steps.every((s) => have(s.tool));
  const modelCall = (): void => { calls++; tokensIn += SYSTEM_BASE_TOKENS + mapTokens + listTokens() + context; };
  const todo = task.steps.map((s) => ({ s, tries: 0, done: false }));
  const queriesFor = (s: Task["steps"][number]): string[] => [...(f.mapText.includes(s.tool) ? [s.tool] : []), s.natural, s.refined];
  while (todo.some((x) => !x.done) && calls < MAX_ROUNDS) {
    // one model call: the next action of every step (parallel) or of the first step still open (sequential)
    const open = todo.filter((x) => !x.done);
    const acting = parallel ? open : open.slice(0, 1);
    modelCall();
    let roundMs = 0;
    for (const x of acting) {
      if (have(x.s.tool)) {
        const out = await session.call(ctx, x.s.tool, {});
        context += 60 + (out.kind === "result" ? Math.max(RESULT_TOKENS, estimateTokens(JSON.stringify(out.result.content))) : RESULT_TOKENS);
        x.done = true; roundMs = parallel ? Math.max(roundMs, TOOL_MS) : roundMs + TOOL_MS; toolMs += parallel ? 0 : TOOL_MS;
      } else {
        const q = queriesFor(x.s)[x.tries++];
        if (q === undefined) { found = false; x.done = true; continue; }
        searches++;
        const out = await session.call(ctx, "tool_search", { query: q });
        context += 40 + (out.kind === "result" ? estimateTokens(JSON.stringify(out.result.content)) : RESULT_TOKENS);
      }
    }
    if (parallel) toolMs += roundMs;
  }
  modelCall();
  return { id: task.id, area: task.area, modelCalls: calls, tokensIn, searches, unprompted, found, wallMs: calls * MODEL_CALL_MS + toolMs + Math.round((tokensIn / 1000) * MS_PER_1K_IN) };
}

export async function runMulti(parallel: boolean): Promise<Row[]> {
  const f = await features();
  const rows: Row[] = [];
  for (const t of MULTI) rows.push(await runMultiTask(t, f, rows.length, parallel));
  return rows;
}

export async function runSet(): Promise<Row[]> {
  const f = await features();
  const rows: Row[] = [];
  for (const t of TASKS) {
    for (const s of t.steps) if (!catalog.byName(s.tool)) throw new Error(`task ${t.id} names ${s.tool}, which is not a tool`);
    rows.push(await runTask(t, f, rows.length));
  }
  return rows;
}

export function summarise(rows: readonly Row[]): { tasks: number; found: number; unprompted: number; avgCalls: number; avgTokensIn: number; totalTokensIn: number; avgSearches: number; avgWallS: number } {
  const n = rows.length, sum = (k: (r: Row) => number): number => rows.reduce((a, r) => a + k(r), 0);
  return { tasks: n, found: sum((r) => (r.found ? 1 : 0)), unprompted: sum((r) => (r.unprompted ? 1 : 0)), avgCalls: +(sum((r) => r.modelCalls) / n).toFixed(2), avgTokensIn: Math.round(sum((r) => r.tokensIn) / n), totalTokensIn: sum((r) => r.tokensIn), avgSearches: +(sum((r) => r.searches) / n).toFixed(2), avgWallS: +(sum((r) => r.wallMs) / n / 1000).toFixed(1) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").slice(-2).join("/"))) {
  const t0 = performance.now();
  const rows = await runSet();
  const s = summarise(rows);
  if (process.env["JSON"]) { for (const r of rows) console.log(JSON.stringify(r)); console.log(JSON.stringify({ features: [...FEATURES], ...s })); }
  else {
    console.log(`features: ${[...FEATURES].join(", ") || "none (baseline)"}`);
    console.log("task".padEnd(26), "area".padEnd(9), "calls", "searches", "tokens in", "unprompted", "found", "wall s");
    for (const r of rows) console.log(r.id.padEnd(26), r.area.padEnd(9), String(r.modelCalls).padStart(5), String(r.searches).padStart(8), String(r.tokensIn).padStart(9), String(r.unprompted).padStart(10), String(r.found).padStart(5), (r.wallMs / 1000).toFixed(1).padStart(6));
    console.log(`\n${s.tasks} tasks: right tools found ${s.found}/${s.tasks}, listed without a search ${s.unprompted}/${s.tasks}, avg ${s.avgCalls} model calls, ${s.avgSearches} searches, ${s.avgTokensIn} tokens in (total ${s.totalTokensIn}), ${s.avgWallS} s modelled wall; script ran in ${Math.round(performance.now() - t0)} ms`);
    console.log("\nmulti-part questions (steps independent): sequential, then parallel");
    for (const par of [false, true]) {
      const m = await runMulti(par);
      const ms = summarise(m);
      for (const r of m) console.log(`  ${par ? "parallel  " : "sequential"} ${r.id.padEnd(22)} calls ${r.modelCalls}  searches ${r.searches}  tokens in ${r.tokensIn}  wall ${(r.wallMs / 1000).toFixed(1)} s`);
      console.log(`  ${par ? "parallel  " : "sequential"} average: ${ms.avgCalls} model calls, ${ms.avgTokensIn} tokens in, ${ms.avgWallS} s modelled wall\n`);
    }
  }
}
