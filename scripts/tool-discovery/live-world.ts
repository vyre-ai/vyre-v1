// The same three tasks against a real Vyre server: a daemon booted in this process (the box's test world), its real calendar, mail, tasks and goals handlers, a claimed Space with its Assistant,
// and a real model on the real network. The model session is the real API driver given the engine's own tool context (the real tool list, map, place and learned preloads, and the real runner,
// through daemon option engineApiTools); the tools run through the real invoke pipeline as the agent acting for the owner. Sequential: no "call together" line, no parallel_tool_calls, the engine
// runs calls one at a time. Parallel: the line, the switch, the engine's parallel reads. Runs alternate so what the agent learns is shared fairly.
//
//   OPENROUTER_KEY comes from SATVIEW_OPENROUTER_API_KEY in the environment only; it is never printed or written, and error text is scrubbed of it.
//   LIVE_RUNS=3  LIVE_MODEL=openai/gpt-4.1-nano  LIVE_BUDGET_USD=0.30
import { ADAPTERS, createApiDriver } from "../../agent/src/drivers/api/index.ts";
import { claimedSpace, call, stop } from "../../test/support/eco-live.ts";
import { scriptedModel } from "../../test/support/live.ts";
import type { EngineSession, OpenSession, SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";
import type { ProviderAdapter, WireRequest } from "../../agent/src/drivers/api/types.ts";

const KEY = process.env["SATVIEW_OPENROUTER_API_KEY"] ?? "";
if (KEY.length < 8) { console.log("no OpenRouter key in the environment"); process.exit(1); }
const scrub = (s: string): string => s.split(KEY).join("[key]");
const MODEL = process.env["LIVE_MODEL"] ?? "openai/gpt-4.1-nano";
const RUNS = Number(process.env["LIVE_RUNS"] ?? "3");
const BUDGET = Number(process.env["LIVE_BUDGET_USD"] ?? "0.30");
const PRICE_IN = 0.1e-6, PRICE_OUT = 0.4e-6;   // gpt-4.1-nano on OpenRouter, dollars per token
const PARALLEL_LINE = "When steps do not depend on each other, call their tools together in one step; call one after another only when a later call needs an earlier result.";
const TASKS = [
  { id: "morning round", prompt: "Morning round: what is on my calendar today, how many unread emails do I have, what tasks need me, how are my goals, and are any helpers running?" },
  { id: "calendar tomorrow", prompt: "What is on my calendar tomorrow?" },
  { id: "goals check", prompt: "How are the goals going?" },
];

interface Metrics { calls: number; tokensIn: number; tokensOut: number; batches: number[]; first: number }
let current: { parallel: boolean; m: Metrics } | null = null;
let tools: { context: (spec: unknown, input: unknown) => Promise<unknown> } | null = null;

const sequentialAdapter = (base: ProviderAdapter): ProviderAdapter => ({ ...base, request(r): WireRequest { const w = base.request(r); const b = { ...(w.body as Record<string, unknown>) }; delete b["parallel_tool_calls"]; return { ...w, body: b }; } });

const oneShot = scriptedModel(async function* () { /* memory's learning pass answers itself */ });
const open: OpenSession = async (spec: SessionSpec) => {
  if (String(spec.threadId).startsWith("oneshot_") || spec.agent.id === "memory-upkeep") return oneShot(spec);
  const run = current;
  const parallel = run?.parallel ?? true;
  const adapter = parallel ? ADAPTERS.openrouter : sequentialAdapter(ADAPTERS.openrouter);
  const driver = createApiDriver(adapter, {
    authorize: async () => ({ authorization: `Bearer ${KEY}` }),
    // the engine's own context for this turn; the sequential run does not tell the model it may call tools together
    context: async (s, input) => { const c = (await tools!.context(s, input)) as { system: { text: string; stable: boolean }[] }; return parallel ? c : { ...c, system: c.system.map((b) => ({ ...b, text: b.text.split(PARALLEL_LINE).join("") })) } as never; },
    maxSteps: 14,
  });
  const s = await driver.open({ ...spec, agent: { ...spec.agent, model: `openrouter/${MODEL}` } });
  if (!parallel) Object.assign(s, { parallelTools: false });
  const send = s.send.bind(s);
  (s as { send: unknown }).send = (input: TurnInput) => (async function* () {
    let n = 0;
    for await (const e of send(input)) {
      if (e.type === "tool_call") n++;
      if (e.type === "tool_wait" && run) { run.m.batches.push(n); n = 0; }
      if (e.type === "usage" && run) { run.m.tokensIn += e.inputTokens; run.m.tokensOut += e.outputTokens; run.m.calls++; }
      yield e;
    }
  })();
  return s as unknown as EngineSession;
};

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

const { d, api, assistant } = await claimedSpace(open, "Measure Co", { engineApiTools: (t: never) => { tools = t; } });
let spent = 0;
try {
  // a little real data for the real handlers to read (a failure here only means the reads come back empty)
  const day = 24 * 3600 * 1000, t0 = Date.now();
  for (const [i, title] of ["Standup", "Client call", "Review contracts"].entries()) await api("calendar.create_event", { idempotencyKey: `seed-ev-${i}`, title, startsAt: t0 + day + i * 3600_000, endsAt: t0 + day + (i + 1) * 3600_000 }).catch((e: unknown) => console.log(`seed event ${i}: ${scrub(String(e)).slice(0, 120)}`));
  await api("goals.create", { idempotencyKey: "seed-goal", outcome: "Sign five new clients this quarter", title: "Five new clients" }).catch((e: unknown) => console.log(`seed goal: ${scrub(String(e)).slice(0, 160)}`));
  const rows: Record<string, { mode: string; calls: number[]; tokensIn: number[]; wall: number[]; first: number[]; batch: number[]; done: number }> = {};
  for (let r = 0; r < RUNS; r++) for (const task of TASKS) for (const parallel of r % 2 === 0 ? [false, true] : [true, false]) {
    if (spent > BUDGET) { console.log(`stopping: estimated spend $${spent.toFixed(3)} passed the $${BUDGET} cap`); break; }
    const mode = parallel ? "parallel" : "sequential";
    current = { parallel, m: { calls: 0, tokensIn: 0, tokensOut: 0, batches: [], first: 0 } };
    const thread = (await api("chat.start", { kind: "chat", agentIds: [assistant], idempotencyKey: `m-${r}-${task.id}-${mode}-start` })).thread.threadId as string;
    const before = ((await call(d, "chat.messages.list", { threadId: thread })).data.messages as unknown[] | undefined)?.length ?? 0;
    const t1 = Date.now();
    await api("chat.post", { threadId: thread, body: task.prompt, mentions: [{ kind: "agent", id: assistant }], idempotencyKey: `m-${r}-${task.id}-${mode}-post` });
    let reply = "";
    while (Date.now() - t1 < 180_000) {
      await d.hooks?.pump?.();
      const ms = ((await call(d, "chat.messages.list", { threadId: thread })).data.messages as { author?: { kind?: string }; body?: string; threadSeq?: number }[] | undefined) ?? [];
      const m = ms.filter((x) => x.author?.kind === "agent" && (x.body ?? "") !== "" && (x.threadSeq ?? 0) > before).at(-1);
      if (m) { reply = m.body ?? ""; break; }
      await new Promise((r2) => setTimeout(r2, 300));
    }
    const wall = (Date.now() - t1) / 1000;
    const m = current.m;
    spent += m.tokensIn * PRICE_IN + m.tokensOut * PRICE_OUT;
    const k = `${task.id}|${mode}`;
    const row = (rows[k] ??= { mode, calls: [], tokensIn: [], wall: [], first: [], batch: [], done: 0 });
    row.calls.push(m.calls); row.tokensIn.push(m.tokensIn); row.wall.push(wall); row.batch.push(Math.max(0, ...m.batches)); if (reply !== "") row.done++;
    console.log(`run ${r + 1} ${task.id.padEnd(18)} ${mode.padEnd(10)} calls ${m.calls}  in ${m.tokensIn}  out ${m.tokensOut}  wall ${wall.toFixed(1)} s  steps ${JSON.stringify(m.batches)}  ${reply !== "" ? "answered" : "NO ANSWER"}  ~$${spent.toFixed(4)} so far`);
  }
  console.log(`\nmedians over ${RUNS} runs on ${MODEL} (real server, real handlers):`);
  for (const task of TASKS) for (const mode of ["sequential", "parallel"]) {
    const x = rows[`${task.id}|${mode}`];
    if (x) console.log(`  ${task.id.padEnd(18)} ${mode.padEnd(10)} calls ${median(x.calls)}  tokens in ${Math.round(median(x.tokensIn))}  wall ${median(x.wall).toFixed(1)} s  biggest step ${median(x.batch)} call(s)  answered ${x.done}/${x.calls.length}`);
  }
  console.log(`\nestimated spend $${spent.toFixed(4)}`);
} catch (e) { console.log(`failed: ${scrub(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)).slice(0, 1200)}`); }
finally { await stop(d).catch(() => undefined); }
process.exit(0);
