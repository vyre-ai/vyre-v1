// A tool the model finds with tool_search is callable in the very next step of the same turn (owner's and Andrey's 7 minute, 1.5 million token turn: the set was read once per send, so a found tool
// came only a turn later and the model searched nineteen times). The new tools go at the end of the list, so the ones already sent keep their place.
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, createApiDriver } from "../src/drivers/api/index.ts";
import { MODELS, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent, ToolResult } from "../src/turn-engine/types.ts";

const SEARCH_STEP = fixture("anthropic-tool").replaceAll("records_list", "tool_search");
const FOUND = { name: "inbox_list_by_thread", description: "Inbox thread view.", inputSchema: { type: "object", properties: {} } };

async function run(reload: (() => Promise<readonly typeof FOUND[]>) | undefined) {
  const f = fakeFetch((_r, n) => ({ chunks: chunked(n === 0 ? SEARCH_STEP : fixture("anthropic-tool-answer"), 23) }));
  const base = ctx();
  const driver = createApiDriver(ADAPTERS.anthropic, { authorize, context: () => ({ ...base, ...(reload ? { reload: async () => [...base.tools, ...(await reload())] } : {}) }), fetch: f.fetch, clock: fakeClock() });
  const session = await driver.open(spec(MODELS.anthropic));
  const it = session.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator]();
  const out: DriverEvent[] = [];
  for (;;) {
    const r = await it.next();
    if (r.done) break;
    out.push(r.value);
    if (r.value.type === "tool_call") session.sendToolResult(r.value.id, { ok: true, content: { data: { tools: [FOUND] } } } as ToolResult);
  }
  return { f, out };
}

test("after a step that ran tool_search the next request lists the tool it found", async () => {
  const { f, out } = await run(async () => [FOUND]);
  assert.equal(f.requests.length, 2, "search, then answer: two model calls");
  const names = (i: number): string[] => ((f.requests[i]?.body as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
  assert.deepEqual(names(0), ["chat_post", "records_list"]);
  assert.deepEqual(names(1), ["chat_post", "inbox_list_by_thread", "records_list"], "the found tool is callable in step 2");
  assert.equal(out.at(-1)?.type, "done");
});

test("a driver whose context cannot reload keeps the set it started with", async () => {
  const { f } = await run(undefined);
  const names = ((f.requests[1]?.body as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
  assert.deepEqual(names, ["chat_post", "records_list"]);
});

test("a tool that is already listed is not added twice", async () => {
  const { f } = await run(async () => [{ ...FOUND, name: "chat_post" }]);
  const names = ((f.requests[1]?.body as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
  assert.deepEqual(names, ["chat_post", "records_list"]);
});

// The whole path with the real catalog: the search loads the tool in the thread, the context reads the set again, the next step can call it, and the answer is the third model call.
import { createApiTools } from "../src/drivers/open/api-tools.ts";
import { ctx as toolCtx, makeSession } from "../src/tools/harness.ts";

test("search, then call, then answer is three model calls: the found tool is in step 2's tools and its call is not refused", async () => {
  const { session } = makeSession();
  const c = toolCtx();
  const api = createApiTools({ session, space: "spc_1", system: () => [{ text: "You are Intake.", stable: true }] });
  const target = "inbox_follow_set";
  assert.ok(!session.toolsFor(c).listed.some((t) => t.name === target) && session.toolsFor(c).searchable.some((t) => t.name === target), "the tool is found only by searching");
  const steps = [fixture("anthropic-tool").replaceAll("records_list", "tool_search"), fixture("anthropic-tool").replaceAll("records_list", target), fixture("anthropic-tool-answer")];
  const f = fakeFetch((_r, n) => ({ chunks: chunked(steps[n] ?? steps[2]!, 23) }));
  const driver = createApiDriver(ADAPTERS.anthropic, { authorize, context: (sp, input) => api.context(sp, input), fetch: f.fetch, clock: fakeClock() });
  const opened = await driver.open(spec(MODELS.anthropic));
  const it = opened.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator]();
  const results: Array<{ name: string; ok: boolean }> = [];
  for (;;) {
    const r = await it.next();
    if (r.done) break;
    if (r.value.type === "tool_call") {
      const input = r.value.name === "tool_search" ? { query: "follow" } : {};
      const out = await session.call(c, r.value.name, input);
      results.push({ name: r.value.name, ok: out.result.ok });
      opened.sendToolResult(r.value.id, out.result);
    }
  }
  const names = (i: number): string[] => ((f.requests[i]?.body as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
  assert.equal(f.requests.length, 3, "search, call, answer");
  assert.ok(!names(0).includes(target));
  assert.ok(names(1).includes(target), "listed to the model for step 2");
  assert.deepEqual(results.map((x) => x.name), ["tool_search", target]);
  assert.equal(results[1]!.ok, true, "and the call is not answered with 'find this tool first'");
});

test("the same search twice in a turn gets a plain hint, not another search", async () => {
  const { session } = makeSession();
  const c = { ...toolCtx(), turnId: "trn_1" };
  const first = await session.call(c, "tool_search", { query: "follow" });
  assert.ok(((first.result.content as { data: { tools: unknown[] } }).data.tools).length > 0);
  const again = await session.call(c, "tool_search", { query: "  Follow " });
  const data = (again.result.content as { data: { tools: unknown[]; hint?: string } }).data;
  assert.deepEqual(data.tools, []);
  assert.match(data.hint ?? "", /already searched/);
  const other = await session.call(c, "tool_search", { query: "calendar" });
  assert.ok(((other.result.content as { data: { tools: unknown[] } }).data.tools).length > 0, "other words search again");
  const nextTurn = await session.call({ ...c, turnId: "trn_2" }, "tool_search", { query: "follow" });
  assert.ok(((nextTurn.result.content as { data: { tools: unknown[] } }).data.tools).length > 0, "a new turn may search again");
});

// A replay of the shape of Andrey's turn: a question about the Inbox, a model that calls inbox_list_by_thread when it can see it and searches for it when it cannot. Counted in model calls.
async function replay(o: { reloads: boolean; preloaded: boolean }): Promise<number> {
  const { session } = makeSession();
  const c = toolCtx();
  const target = "inbox_list_by_thread";
  if (o.preloaded) session.preload(c.thread.threadId, [target]);
  const api = createApiTools({ session, space: "spc_1", system: () => [{ text: "You are the Assistant.", stable: true }] });
  const search = fixture("anthropic-tool").replaceAll("records_list", "tool_search");
  const callIt = fixture("anthropic-tool").replaceAll("records_list", target);
  const answer = fixture("anthropic-tool-answer");
  const f = fakeFetch((r) => {
    const body = r.body as { tools: Array<{ name: string }>; messages: Array<{ role: string; content: unknown }> };
    const sawResult = JSON.stringify(body.messages).includes(`"type":"tool_use","id":"toolu_01A","name":"${target}"`);
    if (sawResult) return { chunks: chunked(answer, 23) };
    return { chunks: chunked(body.tools.some((t) => t.name === target) ? callIt : search, 23) };
  });
  const context = async (sp: Parameters<typeof api.context>[0], input: Parameters<typeof api.context>[1]) => {
    const got = await api.context(sp, input);
    return o.reloads ? got : { system: got.system, tools: got.tools };   // without reload: the set is read once per send, as it was
  };
  const driver = createApiDriver(ADAPTERS.anthropic, { authorize, context, fetch: f.fetch, clock: fakeClock(), maxSteps: 19 });
  const opened = await driver.open(spec(MODELS.anthropic));
  const it = opened.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator]();
  for (;;) {
    const r = await it.next();
    if (r.done) break;
    if (r.value.type === "tool_call") {
      const out = await session.call({ ...c, turnId: "trn_replay" }, r.value.name, r.value.name === "tool_search" ? { query: "inbox list by thread" } : {});
      opened.sendToolResult(r.value.id, out.result);
    }
  }
  return f.requests.length;
}

test("replay of the Inbox question: model calls before the fix, after it, and with the read listed up front", async () => {
  const before = await replay({ reloads: false, preloaded: false });
  const after = await replay({ reloads: true, preloaded: false });
  const listed = await replay({ reloads: true, preloaded: true });
  console.log(`tool_search replay, model calls: before ${before}, after ${after}, listed up front ${listed}`);
  assert.equal(before, 19, "the found tool is never callable in the turn: the model searches until the step limit");
  assert.equal(after, 3, "search, call, answer");
  assert.equal(listed, 2, "call, answer");
});

test("a room's reads are listed from the first request, so a tagged agent never searches before it speaks", async () => {
  const { session } = makeSession();
  const c = toolCtx();
  session.preload(c.thread.threadId, ["chat_messages_list", "chat_message_get", "chat_catch_up", "chat_search", "tasks_get"]);
  const api = createApiTools({ session, space: "spc_1", system: () => [{ text: "You are Intake.", stable: true }] });
  const first = await api.context({ ...spec(MODELS.anthropic) }, turnInput(MODELS.anthropic));
  const names = first.tools.map((t) => t.name);
  for (const n of ["chat_messages_list", "chat_catch_up", "tasks_get", "chat_post", "chat_thread", "tasks_create", "read_link"]) assert.ok(names.includes(n), `${n} is listed`);
  const f = fakeFetch(() => ({ chunks: chunked(fixture("anthropic-tool-answer"), 23) }));
  const driver = createApiDriver(ADAPTERS.anthropic, { authorize, context: () => first, fetch: f.fetch, clock: fakeClock() });
  const opened = await driver.open(spec(MODELS.anthropic));
  const kinds: string[] = [];
  for await (const e of opened.send(turnInput(MODELS.anthropic))) kinds.push(e.type);
  assert.notEqual(kinds.indexOf("text"), -1);
  assert.ok(!kinds.slice(0, kinds.indexOf("text")).includes("tool_call"), "no tool call before the first text");
});
