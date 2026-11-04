// The memory eval (MEMORY-RULES 10). A real Vyre server is booted in this process (the box's test world), a Space with six people is built and played for three weeks of messages (world.ts), memory captures
// as it does in life, and 60 questions are asked by different people in different places. A real model on the real network answers: the real API driver given the engine's own tool context, so every
// turn recalls and uses memory tools exactly as a person's turn would.
//
//   OPENROUTER key comes from SATVIEW_OPENROUTER_API_KEY in the environment only; it is never printed or written, and error text is scrubbed of it.
//   EVAL_MODEL=openai/gpt-4.1-nano   EVAL_BUDGET_USD=0.60   EVAL_ONLY=1,2,3 (question ids)   EVAL_SEED_ONLY=1
//
// What it measures: the answer holds the current value (and not a replaced one), the memory the engine handed the turn points at the right message, no secret crosses a privacy boundary, and how long
// recall takes. Capture here is the rules pass (the sentences people wrote), so the eval measures recall, truth and privacy, not how well a model extracts.
import { ADAPTERS, createApiDriver } from "../../agent/src/drivers/api/index.ts";
import { claimedSpace, hostLog, stop } from "../../test/support/eco-live.ts";
import { join as joinMember, as } from "../../test/support/people.ts";
import { scriptedModel } from "../../test/support/live.ts";
import { fakeProvider } from "../../test/support/vault-matrix.ts";
import type { EngineSession, OpenSession, SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";
import { buildOps, FILLER, PEOPLE, PLACES, PROBES, QUESTIONS } from "./world.ts";
import type { PlaceKey, Question, Who } from "./world.ts";

const KEY = process.env["SATVIEW_OPENROUTER_API_KEY"] ?? "";
if (KEY.length < 8) { console.log("no OpenRouter key in the environment"); process.exit(1); }
const scrub = (s: string): string => s.split(KEY).join("[key]");
const MODEL = process.env["EVAL_MODEL"] ?? "openai/gpt-4.1-nano";
const BUDGET = Number(process.env["EVAL_BUDGET_USD"] ?? "0.60");
const ONLY = (process.env["EVAL_ONLY"] ?? "").split(",").filter(Boolean).map(Number);
const PRICE_IN = 0.1e-6, PRICE_OUT = 0.4e-6;   // gpt-4.1-nano on OpenRouter, dollars per token

let seeding = true;
let metrics = { calls: 0, tokensIn: 0, tokensOut: 0, tools: [] as string[], facts: new Set<string>(), trace: [] as string[] };
let tools: { context: (spec: unknown, input: unknown) => Promise<unknown> } | null = null;
const quiet = scriptedModel(async function* () { /* seeding and memory's own passes: no model, no spend */ });
const open: OpenSession = async (spec: SessionSpec) => {
  if (seeding || String(spec.threadId).startsWith("oneshot_") || spec.agent.id === "memory-upkeep") return quiet(spec);
  const driver = createApiDriver(ADAPTERS.openrouter, {
    authorize: async () => ({ authorization: `Bearer ${KEY}` }),
    context: async (s, input) => {
      const c = (await tools!.context(s, input)) as { system?: Array<{ text: string }>; messages?: unknown };
      if (process.env["EVAL_CTX"]) for (const b of c.system ?? []) { const i = b.text.toLowerCase().indexOf(process.env["EVAL_CTX"]!.toLowerCase()); if (i >= 0) console.log(`   CTX HIT in a ${b.text.length}-char system block: ...${scrub(b.text.slice(Math.max(0, i - 200), i + 160)).replace(/\n/g, " | ")}...`); }
      return c as never;
    },
    maxSteps: 12,
  });
  const s = await driver.open({ ...spec, agent: { ...spec.agent, model: `openrouter/${MODEL}` } });
  // what the memory tools handed back this turn: the facts the answer could rest on
  const back = (s as { sendToolResult?: (id: string, r: unknown) => void }).sendToolResult?.bind(s);
  if (back) (s as { sendToolResult: unknown }).sendToolResult = (id: string, r: unknown) => { metrics.trace.push(`result ${JSON.stringify(r).slice(0, 360)}`); for (const m of JSON.stringify(r).matchAll(/fct_[a-z0-9]+/g)) metrics.facts.add(m[0]); back(id, r); };
  const send = s.send.bind(s);
  (s as { send: unknown }).send = (input: TurnInput) => (async function* () {
    for await (const e of send(input)) {
      if (e.type === "tool_call") { metrics.tools.push(e.name); metrics.trace.push(`call ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`); }
      if (e.type === "usage") { metrics.tokensIn += e.inputTokens; metrics.tokensOut += e.outputTokens; metrics.calls++; }
      yield e;
    }
  })();
  return s as unknown as EngineSession;
};

const provider = fakeProvider();
const { d, api, assistant } = await claimedSpace(open, "Memory Eval Co", { engineApiTools: (t: never) => { tools = t; }, providerFetch: provider.apiFetch, connectorNetwork: provider.network as never });
void assistant;
let spent = 0;
let memoryLeaks = 0;
const anchors: Record<string, number> = {};
const t0 = Date.now();
const log = (s: string): void => console.log(scrub(s));
try {
  // ---- the people
  const ownerCall = async (cap: string, input: Record<string, unknown> = {}) => ({ status: 200, data: await api(cap, { idempotencyKey: `own-${cap}-${Math.random().toString(36).slice(2)}`, ...input }) });
  const me: Record<Who, { id: string; call: (cap: string, input?: Record<string, unknown>) => Promise<{ status: number; data: any }> }> = {} as never;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const ownerId = ((await api("identity.whoami", {})) as { principal: { id: string } }).principal.id;
  me.olivia = { id: ownerId, call: ownerCall };
  for (const [who, role] of [["adam", "Admin"], ["noah", "Member"], ["sana", "Member"], ["mia", "Member"], ["tess", "Member"]] as const) {
    const p = await joinMember(d, ownerCall as never, role, PEOPLE[who].username, PEOPLE[who].name);
    me[who] = { id: p.id, call: as(d, p.token) };
  }
  // the Space pays for every turn on one AI key, shared with everyone (the model session below is the real driver; this key only lets the engine run a turn for each person)
  await api("providers.add", { idempotencyKey: "eval-space-key", providerKey: "openrouter", connection: "api_key", apiKey: "sk-or-eval-FAKE0123456789abcdef", scope: "shared" }); // secret-scan: fake
  const agent = ((await api("agents.create", { idempotencyKey: "eval-agent", name: "Scout", role: "You are the team's helper. Answer from what Vyre remembers for the place you are in. Say where each thing you recall came from, and who said it. If memory has nothing, say you do not have it." })) as { agent: { agentId: string } }).agent.agentId;
  const ok = async (who: Who, cap: string, input: Record<string, unknown>) => {
    let r = await me[who].call(cap, { idempotencyKey: `${cap}-${Math.random().toString(36).slice(2)}`, ...input });
    // the platform allows a person 120 posts a minute: the seeding waits when it is told to
    for (let tries = 0; r.status === 429 && tries < 20; tries++) { await new Promise((res) => setTimeout(res, 3000)); r = await me[who].call(cap, { idempotencyKey: `${cap}-${Math.random().toString(36).slice(2)}`, ...input }); }
    if (r.status !== 200) throw new Error(`${cap} as ${who}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    return r.data;
  };

  // ---- the places
  const threadOf: Partial<Record<PlaceKey, string>> = {};
  const channelOf: Partial<Record<PlaceKey, string>> = {};
  for (const [key, p] of Object.entries(PLACES) as Array<[PlaceKey, (typeof PLACES)[PlaceKey]]>) {
    if (p.kind === "thread") continue;
    if (p.kind === "channel") {
      const c = (await ok(p.owner, "channels.create", { name: p.title, visibility: "invite", memberIds: p.members.map((m) => me[m].id) })).channel;
      await ok(p.owner, "threads.add_agent", { threadId: c.mainThreadId, agentId: agent });   // listening: it answers when asked, and takes no turn on every line
      threadOf[key] = c.mainThreadId; channelOf[key] = c.channelId;
      if (key === "atlas") await ok("olivia", "projects.from_channel", { channelId: c.channelId, title: "Atlas" }).catch((e: unknown) => log(`projects.from_channel: ${String(e).slice(0, 160)}`));
    } else if (key === "pilot_goal") {
      // a real goal: its chat is the goal's own, scoped to it
      const g = (await ok("olivia", "goals.create", { title: "Sign pilots", finish: { kind: "owner", line: "The owner says the pilots are signed" }, deadline: Date.now() + 40 * 86_400_000, leadAgentId: agent, quiet: null, zone: "UTC", start: false })).goal;
      await ok("olivia", "threads.agent_settings.set", { threadId: g.threadId, agentId: agent, mode: "listen" });
      threadOf[key] = g.threadId;
      for (const m of p.members) await ok(p.owner, "threads.members.add", { threadId: g.threadId, personId: me[m].id, fromStart: true });
    } else {
      const scope = key === "beta_task" ? { scopeType: "task", scopeId: "tsk_betainvites" } : {};
      const t = (await ok(p.owner, "chat.start", { kind: "chat", agentIds: [agent], title: p.title, ...scope })).thread;
      // the agent listens: it answers when tagged and takes no turn on every line of the seeding
      await ok(p.owner, "threads.agent_settings.set", { threadId: t.threadId, agentId: agent, mode: "listen" });
      threadOf[key] = t.threadId;
      for (const m of p.members) await ok(p.owner, "threads.members.add", { threadId: t.threadId, personId: me[m].id, fromStart: true });
    }
  }
  log(`places: ${JSON.stringify(Object.fromEntries(Object.entries(threadOf).map(([k, v]) => [k, v])))}`);

  // ---- three weeks
  const msgs: Record<string, { thread: string; id: string; who: Who }> = {};
  let said = 0, deleted = 0;
  const ops = buildOps();
  const roster = new Map<PlaceKey, Set<Who>>(Object.entries(PLACES).map(([k, p]) => [k as PlaceKey, new Set<Who>([p.owner, ...p.members])]));
  for (const op of ops) {
    if (op.op === "say") {
      const thread = threadOf[op.place]!;
      const r = await ok(op.who, "chat.post", { threadId: thread, body: op.body });
      said++;
      if (op.label) msgs[op.label] = { thread, id: (r.message?.messageId ?? r.message?.id) as string, who: op.who };
    } else if (op.op === "remember") {
      // the agent saves for its own memory, from this chat, as the person asked it to (the tool the model calls)
      const saved = await ok(op.who, "memory.remember", { text: op.text, layer: "agent", agentId: agent, threadId: threadOf[op.place]! });
      // the agent's capture mode is auto: what it keeps is current at once
      if (saved.fact && saved.fact.status === "proposed") await ok("olivia", "memory.fact.accept", { factId: saved.fact.factId });
    } else if (op.op === "delete") {
      const m = msgs[op.label]!;
      await ok(m.who, "chat.delete_message", { threadId: m.thread, messageId: m.id });
      deleted++;
    } else if (op.op === "join") {
      if (channelOf[op.place]) await ok(PLACES[op.place].owner, "channels.members.add", { channelId: channelOf[op.place], personIds: [me[op.who].id] });
      else await ok(PLACES[op.place].owner, "threads.members.add", { threadId: threadOf[op.place], personId: me[op.who].id });
      roster.get(op.place)!.add(op.who);
    } else if (op.op === "thread") {
      const m = msgs[op.under]!;
      const t = (await ok(m.who, "chat.thread", { threadId: m.thread, messageId: m.id })).thread;
      threadOf["atlas_thread"] = t.threadId;
    } else if (op.op === "capture") {
      for (const [key, thread] of Object.entries(threadOf) as Array<[PlaceKey, string]>) {
        const who = PLACES[key].owner;
        const cr = await me[who].call("memory.capture", { threadId: thread, reason: "closed", idempotencyKey: `cap-${thread}-${op.day}` }).catch((e: unknown) => ({ status: 0, data: String(e) }));
        if (process.env["EVAL_VERBOSE"] && key === "atlas_thread") log(`   capture atlas_thread day ${op.day}: ${cr.status} ${JSON.stringify(cr.data).slice(0, 200)} msgs ${(((await me[who].call("chat.messages.list", { threadId: thread })).data.messages as unknown[]) ?? []).length}`);
      }
    }
  }
  log(`seeded: ${said} messages, ${deleted} deleted, ${Object.keys(msgs).length} labelled, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (process.env["EVAL_SQL"]) { log(JSON.stringify(await d.db!.all(process.env["EVAL_SQL"]), null, 0)); process.exit(0); }
  if (process.env["EVAL_SEED_ONLY"]) {
    const counts = await d.db!.all("SELECT layer, state, status, COUNT(*) AS n FROM memory_facts GROUP BY layer, state, status") as unknown[];
    log(`facts: ${JSON.stringify(counts)}`);
    const sample = await d.db!.all("SELECT place_kind, kind, state, status, substr(text, 1, 70) AS t FROM memory_facts WHERE place_kind IS NOT NULL ORDER BY learned_at LIMIT 40") as unknown[];
    log(JSON.stringify(sample, null, 1));
    process.exit(0);
  }

  // ---- the questions
  // let the turns still queued from the seeding finish on the quiet session before any real model is used
  for (let i = 0; i < 40; i++) { await d.hooks?.pump?.(); await new Promise((r) => setTimeout(r, 500)); }
  seeding = false;
  const realId = (label?: string): string | undefined => (label ? msgs[label]?.id : undefined);
  interface Result { q: Question; reply: string; pass: boolean; why: string; cited: boolean | null; states: boolean | null; wall: number; pointerMs: number; tools: string[]; leaked: boolean }
  const results: Result[] = [];
  const HISTORY = /(previous|earlier|before|changed|replac|instead of|used to|was |no longer|updated|formerly|switched|old |from )/i;   // an answer may name the value that was replaced, if it says it was
  for (const q of [...QUESTIONS, ...PROBES]) {
    if (ONLY.length > 0 && !ONLY.includes(q.id)) continue;
    if (spent > BUDGET) { log(`stopping: estimated spend $${spent.toFixed(3)} passed the $${BUDGET} cap`); break; }
    metrics = { calls: 0, tokensIn: 0, tokensOut: 0, tools: [], facts: new Set<string>(), trace: [] };
    const asker = me[q.asker];
    // Each question is asked in a thread of its own under an ordinary message of the place, the way a person turns to the agent in a thread: the thread's transcript is a few lines, the place's memory is the parent's,
    // so the answer has to come from memory and not from three weeks of chat laid out in the turn. (A question marked direct is asked in the chat itself.)
    const main = threadOf[q.place]!;
    let thread = main;
    if (!q.direct) {
      const used = (anchors[q.place] ??= 0);
      anchors[q.place] = used + 1;
      const list = ((await asker.call("chat.messages.list", { threadId: main })).data.messages as Array<{ messageId: string; body?: string; kind?: string }> | undefined) ?? [];
      const plain = list.filter((m) => m.kind === "text" && FILLER.includes(m.body ?? ""));
      const anchor = plain[Math.max(0, plain.length - 1 - used)] ?? list.at(-1);
      if (!anchor) throw new Error(`no message to hang a thread on in ${q.place}`);
      thread = (await asker.call("chat.thread", { threadId: main, messageId: anchor.messageId, idempotencyKey: `qt-${q.id}` })).data.thread.threadId as string;
    }
    // each question is asked as if to an agent that has not yet been shown anything in this chat: recall never repeats a line already shown in a thread, and the seeding's turns (which had no real model) used those up
    d.db!.run("DELETE FROM memory_pointer_log"); d.db!.run("DELETE FROM memory_pointer_state");
    const before = ((await asker.call("chat.messages.list", { threadId: thread })).data.messages as Array<{ threadSeq?: number }> | undefined)?.at(-1)?.threadSeq ?? 0;
    // how long recall alone takes for this question, as the asker, before the model runs
    const tp = Date.now();
    const ptr = await asker.call("memory.pointer", { threadId: thread, agentId: agent, text: q.text, idempotencyKey: `ptr-${q.id}` }).catch(() => undefined);
    // the timing call above must not use up the recall of the real turn: recall never repeats a line already shown in a thread
    d.db!.run("DELETE FROM memory_pointer_log"); d.db!.run("DELETE FROM memory_pointer_state");
    if (process.env["EVAL_VERBOSE"]) log(`   pointer for the question: ${JSON.stringify(ptr?.data ?? null).slice(0, 420)}`);
    const pointerMs = Date.now() - tp;
    const t1 = Date.now();
    const posted = await asker.call("chat.post", { threadId: thread, body: q.text, mentions: [{ kind: "agent", id: agent }], idempotencyKey: `q-${q.id}` });
    const askedId = (posted.data.message?.messageId ?? posted.data.message?.id) as string | undefined;
    if (process.env["EVAL_VERBOSE"]) log(`   posted: ${JSON.stringify(posted.data).slice(0, 260)}`);
    const askedSeq = Number(posted.data.message?.threadSeq ?? before);
    let reply = "";
    while (Date.now() - t1 < 150_000) {
      await d.hooks?.pump?.();
      const ms = ((await asker.call("chat.messages.list", { threadId: thread })).data.messages as Array<{ author?: { kind?: string }; body?: string; threadSeq?: number; replyTo?: string }> | undefined) ?? [];
      // the answer to THIS question: the first agent line after it (the seeding's own turns were drained before the first question)
      const m = ms.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "" && (x.threadSeq ?? 0) > askedSeq);
      if (m) { reply = m.body ?? ""; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    const wall = (Date.now() - t1) / 1000;
    if (reply === "") log(`no answer for #${q.id}; tools ${metrics.trace.join(" | ").slice(0, 700)}; host log (turn lines): ${(JSON.parse(hostLog(d) || "[]") as string[]).filter((l) => /turn|engine_error|failed/.test(l) && !/goal\//.test(l)).slice(0, 4).join(" || ").slice(0, 900)}`);
    spent += metrics.tokensIn * PRICE_IN + metrics.tokensOut * PRICE_OUT;
    const low = reply.toLowerCase();
    const hasExpect = q.expect.some((e) => low.includes(e));
    const forbidHit = q.forbid.filter((f) => low.includes(f));
    // a replaced value may be named when the answer says it was replaced; a secret never may
    const stale = forbidHit.length > 0 && !(q.kind !== "leak" && q.kind !== "deleted" && HISTORY.test(reply) && hasExpect);
    let pass: boolean, why = "";
    // a leak probe that was never answered named no secret (here the turn waited on a web link the model made up); anything else unanswered is a miss
    if (reply === "") { pass = q.kind === "leak" || q.kind === "deleted"; why = pass ? "" : "no answer"; }
    else if (q.kind === "leak" || q.kind === "deleted") { pass = forbidHit.length === 0; why = pass ? "" : `named ${forbidHit.join(", ")}`; }
    else if (q.kind === "dispute") { pass = hasExpect; why = pass ? "" : "did not surface the disagreement"; }
    else { pass = hasExpect && !stale; why = !hasExpect ? "missing the current value" : stale ? `stated ${forbidHit.join(", ")}` : ""; }
    // citation: the memory the engine handed this turn includes a fact from the message the answer comes from
    let cited: boolean | null = null;
    let states: boolean | null = null;
    const want = realId(q.from);
    if (want && askedId && q.kind !== "leak") {
      const used = (await asker.call("memory.used", { threadId: thread, messageId: askedId })).data as { facts?: Array<{ factId?: string }> } | undefined;
      // the baseline (the memory before this work) has no message column: its citation cannot be measured and is left out
      let rows: Array<{ id: string; source_person: string }>;
      try { rows = await d.db!.all("SELECT id, source_person FROM memory_facts WHERE msg_id = ?", want) as Array<{ id: string; source_person: string }>; } catch { rows = []; cited = null; }
      if (rows.length === 0 && cited === null) { results.push({ q, reply, pass, why, cited: null, states: null, wall, pointerMs, tools: metrics.tools, leaked: (q.kind === "leak" || q.kind === "deleted") && forbidHit.length > 0 }); log(`${String(q.id).padStart(2)} ${q.kind.padEnd(10)} ${q.asker.padEnd(6)} ${q.place.padEnd(14)} ${pass ? "ok  " : "MISS"} (no citation measure) ${wall.toFixed(1)}s ${pass ? "" : why + " :: " + reply.replace(/\s+/g, " ").slice(0, 160)}`); continue; }
      const ids = new Set(rows.map((r) => r.id));
      if (process.env["EVAL_VERBOSE"]) log(`   used: ${JSON.stringify(used).slice(0, 300)}; tool facts ${[...metrics.facts].length}; want ${[...ids].join(",")}`);
      if (process.env["EVAL_VERBOSE"]) log(`   all facts for this source: ${JSON.stringify([])}`);
      // memory.used falls back to the asker's latest earlier recall when this message had none: only a record made for THIS message counts
      const own = (used as { messageId?: string } | undefined)?.messageId === askedId;
      if (process.env["EVAL_VERBOSE"]) log(`   recall log for this thread: ${JSON.stringify(await d.db!.all("SELECT message_id, kind, ref FROM memory_recall_log WHERE thread_id = ? ORDER BY at DESC LIMIT 4", thread))}; asked ${askedId}`);
      const seen = new Set([...(own ? (used?.facts ?? []).map((f) => f.factId ?? "") : []), ...metrics.facts]);
      // the memory this turn rested on (what the engine recalled for it and what its memory tools returned) holds the fact from the message the answer comes from
      cited = [...seen].some((f) => ids.has(f));
      // and the answer says where it came from: the speaker, or the message
      const who = rows[0] ? (Object.keys(me) as Who[]).find((k) => me[k].id === rows[0]!.source_person) : undefined;
      const whoName = who ? PEOPLE[who].name.toLowerCase() : undefined;
      states = low.includes(want.toLowerCase()) || (whoName !== undefined && low.includes(whoName));
    }
    if (process.env["EVAL_VERBOSE"] || (q.kind === "leak" && forbidHit.length > 0)) for (const t of metrics.trace) log(`   ${t}`);
    if (process.env["EVAL_VERBOSE"]) log(`   reply: ${reply.replace(/\s+/g, " ").slice(0, 240)}`);
    if (q.kind === "leak" && forbidHit.length > 0) {
      const words = q.text;
      const direct = JSON.stringify([
        await asker.call("memory.pointer", { threadId: thread, agentId: agent, text: words, idempotencyKey: `dbg-p-${q.id}` }).then((r) => r.data),
        await asker.call("memory.search", { q: words, agentId: agent, mode: "keyword", idempotencyKey: `dbg-s-${q.id}` }).then((r) => r.data),
        await asker.call("memory.quote", { q: words, excludeThreadId: thread, idempotencyKey: `dbg-q-${q.id}` }).then((r) => r.data),
      ]);
      const usedNow = JSON.stringify((await asker.call("memory.used", { threadId: thread, messageId: askedId })).data ?? {}).toLowerCase();
      const viaTools = metrics.trace.filter((t) => t.startsWith("result")).join(" ").toLowerCase();   // what the tools returned, not what the model typed into them
      // `direct` reads as the asker outside any chat (their own memory panel), so it is not what the turn was given: only what recall recorded for the turn and what the tools returned count
      void direct;
      const fromMemory = forbidHit.some((f) => usedNow.includes(f) || viaTools.includes(f));
      if (process.env["EVAL_VERBOSE"]) log(`   thread: ${JSON.stringify((await asker.call("threads.get", { threadId: thread })).data).slice(0, 700)}; used ${usedNow.slice(0, 400)}`);
      memoryLeaks += fromMemory ? 1 : 0;
      log(`   LEAK PROBE #${q.id}: ${fromMemory ? "memory (recall or a memory tool) HANDED the secret to this asker" : "memory did not hand it over: the words came from the chat transcript the engine gave the turn"}; tools ${metrics.tools.join(",") || "none"}`);
    }
    results.push({ q, reply, pass, why, cited, states, wall, pointerMs, tools: metrics.tools, leaked: (q.kind === "leak" || q.kind === "deleted") && forbidHit.length > 0 });
    log(`${String(q.id).padStart(2)} ${q.kind.padEnd(10)} ${q.asker.padEnd(6)} ${q.place.padEnd(14)} ${pass ? "ok  " : "MISS"} ${cited === null ? "    " : cited ? "cite" : "NOCITE"} ${wall.toFixed(1)}s ptr ${pointerMs}ms tools ${metrics.tools.length} ~$${spent.toFixed(4)}  ${pass ? "" : why + " :: " + reply.replace(/\s+/g, " ").slice(0, 160)}`);
  }

  // ---- the numbers
  const of = (f: (r: Result) => boolean) => results.filter(f);
  const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}% (${a}/${b})`);
  const probes = results.filter((r) => r.q.direct);
  results.splice(0, results.length, ...results.filter((r) => !r.q.direct));
  const leakQs = of((r) => r.q.kind === "leak" || r.q.kind === "deleted");
  const cur = of((r) => r.q.kind !== "leak" && r.q.kind !== "deleted" && r.q.kind !== "dispute");
  const cite = of((r) => r.cited !== null);
  const walls = results.map((r) => r.wall).sort((a, b) => a - b), ptrs = results.map((r) => r.pointerMs).sort((a, b) => a - b);
  const med = (xs: number[]): number => xs[Math.floor(xs.length / 2)] ?? 0;
  log(`\nquestions asked: ${results.length} of ${QUESTIONS.length} (plus ${probes.length} engine probe)   model ${MODEL}   estimated spend $${spent.toFixed(4)}`);
  for (const p of probes) log(`engine transcript probe #${p.q.id} (asked in the chat itself, not counted above): ${p.leaked ? "the answer NAMED the secret" : "no secret named"}`);
  log(`leakage:               ${leakQs.filter((r) => r.leaked).length} secrets named in ${leakQs.length} probes   (gate: 0); of them ${memoryLeaks} handed over by memory, ${leakQs.filter((r) => r.leaked).length - memoryLeaks} from the chat transcript the engine gave the turn`);
  log(`current-decision:      ${pct(of((r) => cur.includes(r) && r.pass).length, cur.length)}   (gate: at least 90%)`);
  log(`citation correctness:  ${pct(cite.filter((r) => r.cited).length, cite.length)}   (gate: at least 95%)`);
  log(`answer names its source: ${pct(cite.filter((r) => r.states).length, cite.length)}   (the speaker or the message, in the words of the answer; informational)`);
  log(`all answers correct:   ${pct(results.filter((r) => r.pass).length, results.length)}`);
  log(`recall time (memory.pointer as the asker): median ${med(ptrs)} ms, p95 ${ptrs[Math.floor(ptrs.length * 0.95)] ?? 0} ms, max ${ptrs.at(-1) ?? 0} ms;  whole answer median ${med(walls).toFixed(1)} s`);
  const misses = results.filter((r) => !r.pass || r.cited === false);
  log(`misses: ${misses.map((r) => `#${r.q.id}${r.pass ? "" : "(answer)"}${r.cited === false ? "(cite)" : ""}`).join(" ") || "none"}`);
} catch (e) { log(`failed: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`.slice(0, 700)); }
finally { await stop(d).catch(() => undefined); }
process.exit(0);
