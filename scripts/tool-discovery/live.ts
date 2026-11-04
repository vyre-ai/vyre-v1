// A real-model run of the tool-discovery tasks: the real API driver and adapter (real HTTP to the provider), the real turn engine and tool session (listed set, map, place and learned preloads, parallel
// reads, tool_batch), with the server's capabilities replaced by small canned answers, so it needs no Vyre server and writes nothing anywhere. Sequential (no "call together" line, the engine runs one call
// at a time, no parallel_tool_calls switch) against parallel (the line, the engine's parallel reads, the switch), on the same tasks.
//
// Keys come from the environment only (OPENCODE_API_KEY, SATVIEW_OPENROUTER_API_KEY) and are never printed, logged or written; error text is scrubbed of them before it is shown.
//   OPENCODE_API_KEY=... SATVIEW_OPENROUTER_API_KEY=... node scripts/tool-discovery/live.ts            (both)
//   LIVE_ONLY=opencode|openrouter   LIVE_MODEL_OPENCODE=...   LIVE_MODEL_OPENROUTER=...   LIVE_BUDGET_USD=0.8
import { createApiDriver, ADAPTERS, realFetch } from "../../agent/src/drivers/api/index.ts";
import { createEngineApiTools } from "../../modules/engine/api-tools.ts";
import { CAPABILITY_MAP } from "../../modules/engine/capability-map.ts";
import { recordToolUse, topTools } from "../../modules/engine/tool-use.ts";
import { harness } from "../../modules/engine/fixtures/harness.ts";
import { createTurnEngine } from "../../agent/src/turn-engine/index.ts";
import type { EngineSession, SessionSpec } from "../../agent/src/turn-engine/types.ts";
import type { ProviderAdapter, WireRequest } from "../../agent/src/drivers/api/types.ts";
import { MULTI, TASKS } from "./tasks.ts";

const KEYS: Record<string, string | undefined> = { opencode_go: process.env["OPENCODE_API_KEY"], openrouter: process.env["SATVIEW_OPENROUTER_API_KEY"] };
const secrets = Object.values(KEYS).filter((k): k is string => typeof k === "string" && k.length > 6);
const scrub = (s: string): string => secrets.reduce((a, k) => a.split(k).join("[key]"), s);
const BUDGET = Number(process.env["LIVE_BUDGET_USD"] ?? "0.8");
let spent = 0;

const PARALLEL_LINE = "When steps do not depend on each other, call their tools together in one step; call one after another only when a later call needs an earlier result.";
const BASE_RULES = "You work for the person who asked. Answer from what the tools return; be brief. If a tool result is empty, say so.";
const MORNING = MULTI.find((t) => t.id === "multi-six-reads")!;
const TASKS_RUN = [{ id: "morning round", prompt: MORNING.prompt, tools: MORNING.steps.map((s) => s.tool) }, { id: "calendar tomorrow", prompt: TASKS.find((t) => t.id === "cal-today")!.prompt, tools: ["calendar_list_events"] }, { id: "goals check", prompt: TASKS.find((t) => t.id === "goals-list")!.prompt, tools: ["goals_list", "goals_get"] }];

/** Small canned answers: enough for a model to answer from, small enough not to dominate the cost. */
const canned = (cap: string): unknown => ({ ok: true, capability: cap, items: [{ id: "x_1", title: "First item", when: "09:00" }, { id: "x_2", title: "Second item", when: "13:30" }], total: 2 });

interface Result { provider: string; model: string; task: string; mode: string; calls: number; tokensIn: number; tokensOut: number; wallS: number; biggestBatch: number; batches: number[]; ok: boolean; note: string; usd: number }

async function pickModel(provider: "opencode_go" | "openrouter"): Promise<{ id: string; inUsd: number; outUsd: number }> {
  const forced = process.env[provider === "openrouter" ? "LIVE_MODEL_OPENROUTER" : "LIVE_MODEL_OPENCODE"];
  if (provider === "opencode_go") {
    const driver = createApiDriver(ADAPTERS.opencode_go, { authorize: async () => ({ authorization: `Bearer ${KEYS["opencode_go"]}` }), context: async () => ({ system: [], tools: [] }) });
    const models = (await driver.models({ ref: "#live" })).map((m) => m.id);
    console.log(`opencode_go models: ${models.join(", ")}`);
    const prefer = ["glm", "kimi", "qwen", "deepseek", "minimax"];
    const id = forced ?? prefer.map((p) => models.find((m) => m.toLowerCase().includes(p))).find(Boolean) ?? models[0]!;
    return { id, inUsd: 0, outUsd: 0 };
  }
  // OpenRouter's public list carries price and what each model supports: the cheapest paid model that takes tools
  const j = (await (await fetch("https://openrouter.ai/api/v1/models")).json()) as { data: { id: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[] };
  const ok = j.data.filter((m) => (m.supported_parameters ?? []).includes("tools") && (m.context_length ?? 0) >= 64_000 && Number(m.pricing?.prompt) > 0 && !m.id.endsWith(":free") && !/(preview|exp|thinking)/i.test(m.id));
  ok.sort((a, b) => Number(a.pricing!.prompt) + Number(a.pricing!.completion) - (Number(b.pricing!.prompt) + Number(b.pricing!.completion)));
  const pick = forced ? j.data.find((m) => m.id === forced)! : ok[0]!;
  console.log(`openrouter: cheapest paid model with tools and 64k context: ${pick.id} (parallel_tool_calls listed: ${(pick.supported_parameters ?? []).includes("parallel_tool_calls")})`);
  return { id: pick.id, inUsd: Number(pick.pricing?.prompt ?? 0), outUsd: Number(pick.pricing?.completion ?? 0) };
}

async function runOne(provider: "opencode_go" | "openrouter", model: { id: string; inUsd: number; outUsd: number }, task: (typeof TASKS_RUN)[number], parallel: boolean): Promise<Result> {
  const mode = parallel ? "parallel" : "sequential";
  const h = harness();
  const db = h.ctx.db as never;
  // learned: this agent has used the task's tools twice before
  for (const t of task.tools) for (let i = 0; i < 2; i++) recordToolUse(db, "agt_live", t, 1000 + i);
  const invoke = (async (cap: string) => ({ status: "ok", output: canned(cap), traceId: "trc_live" })) as never;
  const system = async () => [{ text: `${BASE_RULES}${parallel ? ` ${PARALLEL_LINE}` : ""}\n${CAPABILITY_MAP}`, stable: true }];
  const apiTools = createEngineApiTools({ invoke, space: "spc_live", system, call: async () => undefined, usage: { record: (a, t) => recordToolUse(db, a, t, Date.now()), top: (a) => topTools(db, a) } });
  const base = ADAPTERS[provider];
  // sequential: the switch is not sent, so the provider's own default applies and the engine does not run calls together either
  const adapter: ProviderAdapter = parallel ? base : { ...base, request(r): WireRequest { const w = base.request(r); const b = { ...(w.body as Record<string, unknown>) }; delete b["parallel_tool_calls"]; return { ...w, body: b }; } };
  const driver = createApiDriver(adapter, { authorize: async () => ({ authorization: `Bearer ${KEYS[provider]}` }), context: apiTools.context, maxSteps: 14 });
  const sessions: { send(...a: never[]): unknown; stats(): { calls: number } }[] = [];
  const batches: number[] = [];
  const openSession = async (spec: SessionSpec): Promise<EngineSession> => {
    const s = await driver.open(spec);
    sessions.push(s as never);
    const send = s.send.bind(s);
    let n = 0;
    (s as { send: unknown }).send = (input: never) => (async function* () { for await (const e of send(input)) { if (e.type === "tool_call") n++; if (e.type === "tool_wait") { batches.push(n); n = 0; } yield e; } })();
    return s;
  };
  const engine = createTurnEngine({ holder: "live", openSession, callTool: apiTools.runner, ...(parallel && apiTools.toolClass ? { toolClass: apiTools.toolClass } : {}) });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "agt_live", mode: "lead", model: `${provider}/${model.id}` }] } as never);
  const t0 = Date.now();
  engine.receive({ threadId: "T", author: { kind: "person", id: "dana" }, body: task.prompt });
  let note = "";
  await Promise.race([engine.idle("T"), new Promise<void>((r) => setTimeout(() => { note = "timed out at 180 s"; r(); }, 180_000))]);
  const wallS = (Date.now() - t0) / 1000;
  const turn = engine.turns("T")[0];
  if (turn?.error) note = scrub(`${turn.error.code}: ${turn.error.message}`).slice(0, 200);
  const calls = sessions[0]?.stats().calls ?? 0;
  const usd = (turn?.tokensIn ?? 0) * model.inUsd + (turn?.tokensOut ?? 0) * model.outUsd;
  spent += usd;
  return { provider, model: model.id, task: task.id, mode, calls, tokensIn: turn?.tokensIn ?? 0, tokensOut: turn?.tokensOut ?? 0, wallS, biggestBatch: Math.max(0, ...batches), batches, ok: turn?.state === "completed", note, usd };
}

const only = process.env["LIVE_ONLY"];
const out: Result[] = [];
for (const provider of ["opencode_go", "openrouter"] as const) {
  if (only !== undefined && !provider.startsWith(only)) continue;
  if (!KEYS[provider]) { console.log(`${provider}: no key in the environment, skipped`); continue; }
  const model = await pickModel(provider);
  for (const task of TASKS_RUN) for (const parallel of [false, true]) {
    if (spent > BUDGET) { console.log(`stopping: estimated spend $${spent.toFixed(3)} passed the $${BUDGET} cap`); break; }
    try {
      const r = await runOne(provider, model, task, parallel);
      out.push(r);
      console.log(`${r.provider.padEnd(11)} ${r.model.slice(0, 28).padEnd(28)} ${r.task.padEnd(18)} ${r.mode.padEnd(10)} calls ${String(r.calls).padStart(2)}  in ${String(r.tokensIn).padStart(7)}  out ${String(r.tokensOut).padStart(5)}  wall ${r.wallS.toFixed(1).padStart(5)} s  biggest step ${r.biggestBatch} call(s)  steps ${JSON.stringify(r.batches)}  ${r.ok ? "completed" : "NOT completed"} ${r.note}  ~$${r.usd.toFixed(4)}`);
    } catch (e) { console.log(`${provider} ${task.id} ${parallel ? "parallel" : "sequential"}: failed: ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 240)}`); }
  }
}
console.log(`\nestimated spend on metered models: $${spent.toFixed(4)} (OpenCode Go is a flat plan, not metered)`);
process.exit(0);
