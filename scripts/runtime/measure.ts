// Agent runtime, measured (lane r42-runtime, DESIGN-r42-runtime.md section 9). One script, kept in the branch, run before and after every slice.
// It replays three jobs through a SCRIPTED model (no spend, the same numbers every run) and prices them with the real catalog (modules/engine/prices.json, costOf):
//   five   a parent starts five helpers; each reads three shared files and two of its own, and returns a result; the parent merges the five results
//   sleep  a parent waits 40 minutes for a build: today it polls, with a slice it sleeps and wakes once
//   log    a command prints 200 KB; today the model gets it whole, with a slice it gets a tail and a grep
// A call's input is prefix + conversation so far (the same rule the provider bills). Latency is modelled the way scripts/tool-discovery/measure.ts models it (2.5 s a call + 25 ms per 1k input tokens,
// a tool 400 ms; five helpers in parallel cost the slowest). Cache: a call's repeated prefix inside ONE session reads from cache (cacheRead rate). Whether two helper sessions share a prefix today is
// an ASSUMPTION (they do not: each helper opens its own session with its own identity block), switched by FEATURES=prefix.
//   node scripts/runtime/measure.ts                       the baseline: what the engine does today
//   FEATURES=prefix,readcache,compact,sleep,tail,tier node scripts/runtime/measure.ts      with the slices that exist switched on
//   JSON=1 ...                                             one JSON line per job, for diffing runs
import { estimateTokens } from "../../lib/reply-format.ts";
import { readFileSync } from "node:fs";

const F = new Set(
  (process.env["FEATURES"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const prices = JSON.parse(readFileSync(new URL("../../modules/engine/prices.json", import.meta.url), "utf8")).providers
  .anthropic as Record<string, { in: number; out: number; cacheRead?: number }>;

/** What every session carries before the first word: identity, rules, the person, skills (SYSTEM) and the listed tools (TOOLS). Same constants as tool-discovery/measure.ts. */
const SYSTEM = 8000;
const TOOLS = 6000;
const HELPER_BRIEF = 400;
const MODEL_CALL_MS = 2500;
const MS_PER_1K = 25;
const TOOL_MS = 400;

interface Tally {
  calls: number;
  tokensIn: number;
  cachedIn: number;
  tokensOut: number;
  usd: number;
  ms: number;
  toolCalls: number;
}
const tally = (): Tally => ({ calls: 0, tokensIn: 0, cachedIn: 0, tokensOut: 0, usd: 0, ms: 0, toolCalls: 0 });

/** One model call: `prefix` tokens repeat from an earlier call of this session (cache read), `fresh` are new input. */
function call(t: Tally, model: string, prefix: number, cachedPrefix: number, fresh: number, out: number): void {
  const p = prices[model]!;
  const cacheRate = p.cacheRead ?? p.in;
  t.calls++;
  t.tokensIn += prefix + fresh;
  t.cachedIn += cachedPrefix;
  t.tokensOut += out;
  t.usd += ((prefix - cachedPrefix + fresh) * p.in + cachedPrefix * cacheRate + out * p.out) / 1e6;
  t.ms += MODEL_CALL_MS + ((prefix + fresh) / 1000) * MS_PER_1K;
}
const add = (a: Tally, b: Tally): void => {
  for (const k of Object.keys(a) as (keyof Tally)[]) a[k] += b[k];
};

/** A session of `n` model calls, each followed by tool results of `results[i]` tokens; the conversation grows. `warm`: the first call already finds its prefix in the cache. */
function session(model: string, lead: number, results: number[], out: number, warm: boolean): Tally {
  const t = tally();
  let convo = lead;
  for (let i = 0; i <= results.length; i++) {
    const prefix = SYSTEM + TOOLS + convo;
    const cached = i === 0 ? (warm ? SYSTEM + TOOLS : 0) : prefix - (results[i - 1] ?? 0) - out; // a later call reads everything up to the last result from cache
    call(t, model, prefix - (i === 0 ? 0 : 0), Math.max(0, cached), i === 0 ? 0 : 0, out);
    if (i < results.length) {
      t.toolCalls++;
      t.ms += TOOL_MS;
      convo += out + results[i]!;
    }
  }
  return t;
}

const SHARED = [6000, 4000, 2000]; // price sheet, policy, template: read by every helper
const OWN = [3000, 3000]; // each helper's own two pages
const RESULT_FULL = 2500; // a helper's whole answer (what comes back to the parent today)
const RESULT_COMPACT = 350; // summary + structured fields

function five(): { t: Tally; note: string } {
  const total = tally();
  const parentModel = "claude-sonnet-5-5";
  const kidModel = F.has("tier") ? "claude-haiku-5-5" : parentModel;
  // helpers run in parallel: tokens and cost add up, latency is the slowest
  let slowest = 0;
  const reads = F.has("readcache") ? [...SHARED.map((x, i) => (i === 0 ? x : x)), ...OWN] : [...SHARED, ...OWN];
  for (let h = 0; h < 5; h++) {
    // with a run-level read cache the first helper reads the shared files; the other four are served a reference line (about 60 tokens)
    const results = F.has("readcache") && h > 0 ? [...SHARED.map(() => 60), ...OWN] : reads;
    const t = session(kidModel, HELPER_BRIEF, results, 300, F.has("prefix") && h > 0);
    // the helper's final answer is one more output
    t.tokensOut += F.has("compact") ? 120 : RESULT_FULL - 300;
    t.usd += ((F.has("compact") ? 120 : RESULT_FULL - 300) * prices[kidModel]!.out) / 1e6;
    slowest = Math.max(slowest, t.ms);
    const ms = t.ms;
    add(total, t);
    t.ms = ms;
  }
  total.ms = slowest;
  // the parent: its own turn to start five helpers (one call each, in one step), then merges the five results (in its context)
  const back = F.has("compact") ? RESULT_COMPACT : RESULT_FULL;
  const parent = session(parentModel, 1500, [200, 200, 200, 200, 200, back * 5], 400, false);
  const pms = parent.ms;
  add(total, parent);
  total.ms = slowest + pms;
  return { t: total, note: "parent + 5 helpers, 3 shared reads + 2 own each" };
}

function sleepJob(): { t: Tally; note: string } {
  const t = tally();
  const model = "claude-sonnet-5-5";
  // the person's turn, then 40 minutes of waiting
  const startConvo = 3000;
  if (F.has("sleep")) {
    call(t, model, SYSTEM + TOOLS + startConvo, SYSTEM + TOOLS, 0, 200); // starts the job and sleeps: zero tokens while asleep
    // wake: a new turn in the same chat (the park is the existing wait_for; an exit or a log line is an event it waits on)
    call(t, model, SYSTEM + TOOLS + startConvo + 400, SYSTEM + TOOLS, 0, 200); // the wake turn reads the chat as it stood, not less
  } else {
    // today: the agent polls every 30 s with a status call and a log read; the conversation grows by the poll each time
    let convo = startConvo;
    const polls = (40 * 60) / 30;
    for (let i = 0; i < polls; i++) {
      call(t, model, SYSTEM + TOOLS + convo, SYSTEM + TOOLS + convo - 400, 0, 60);
      convo += 60 + 340; // call + "still running, 12 lines"
      t.toolCalls++;
    }
    call(t, model, SYSTEM + TOOLS + convo, SYSTEM + TOOLS + convo - 400, 0, 200);
  }
  return { t, note: "a 40 minute wait for a build" };
}

function logJob(): { t: Tally; note: string } {
  const t = tally();
  const model = "claude-sonnet-5-5";
  const log = Math.round(estimateTokens("x".repeat(200_000)));
  const seen = F.has("tail") ? 900 : log; // tail 40 lines + grep of errors
  call(t, model, SYSTEM + TOOLS + 2000, SYSTEM + TOOLS, 0, 100);
  t.toolCalls++;
  call(t, model, SYSTEM + TOOLS + 2000 + 100 + seen, SYSTEM + TOOLS + 2000, 0, 300);
  return { t, note: `a command prints 200 KB (${log} tokens)` };
}

const rows = [
  ["five", five()],
  ["sleep", sleepJob()],
  ["log", logJob()],
] as const;
const json = process.env["JSON"] === "1";
if (!json) console.log(`features: ${[...F].join(",") || "(none: today)"}\n`);
for (const [name, { t, note }] of rows) {
  const row = {
    job: name,
    modelCalls: t.calls,
    tokensIn: t.tokensIn,
    cachedIn: t.cachedIn,
    tokensOut: t.tokensOut,
    usd: Number(t.usd.toFixed(4)),
    seconds: Number((t.ms / 1000).toFixed(1)),
  };
  if (json) console.log(JSON.stringify({ ...row, features: [...F] }));
  else
    console.log(
      `${name.padEnd(6)} calls ${String(row.modelCalls).padStart(4)}  in ${String(row.tokensIn).padStart(8)} (cached ${String(row.cachedIn).padStart(8)})  out ${String(row.tokensOut).padStart(6)}  $${row.usd.toFixed(4)}  ${row.seconds}s   ${note}`,
    );
}
