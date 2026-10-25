// The pointer block (spec 2.15, ARCH 6.10): a local lookup with no model call, up to about five lines, 300 to 400 tokens, nothing repeated in a thread,
// none for a short acknowledgement or a step in the middle of a tool loop, and fast on a big memory.
import test from "node:test";
import assert from "node:assert/strict";
import { pointer } from "../handlers/facts.ts";
import { contractErrors, DAY, harness, NOW, seedFact, seedNote } from "../fixtures/harness.ts";

const base = { agentId: "agt_intake" };

test("a matching fact comes back as a line with its title, the fact, true since, and the path", async () => {
  const h = harness();
  const noteId = seedNote(h, { fileId: "fil_c", title: "Client rules", body: "How we treat clients", layer: "agent", agentId: "agt_intake", path: "Agents/Intake/memory/notes/clients.md" });
  seedFact(h, { id: "fct_1", layer: "agent", agentId: "agt_intake", kind: "policy", noteId, validFrom: NOW - 9 * DAY, text: "Refunds above 500 dollars need a second approver" });
  const out = await pointer(h.ctx, { ...base, threadId: "thr_a", text: "Do refunds above 500 dollars need a second approver?" });
  assert.equal(out.lines.length, 1);
  assert.deepEqual(out.lines[0], { title: "Policy", fact: "Refunds above 500 dollars need a second approver", trueSince: NOW - 9 * DAY, path: "Agents/Intake/memory/notes/clients.md" });
  assert.ok(out.tokens > 0 && out.tokens <= 350);
  assert.equal(out.skipped, undefined);
  assert.deepEqual(contractErrors("memory.pointer", "out", out), []);
  assert.deepEqual(h.rows("SELECT ref FROM memory_pointer_log").map((r) => r["ref"]), ["fact:fct_1"]);
});

test("a short acknowledgement gets no pointer, and neither does a message memory knows nothing about", async () => {
  const h = harness();
  seedFact(h, { id: "fct_1", layer: "agent", agentId: "agt_intake", text: "Refunds above 500 dollars need a second approver" });
  for (const text of ["ok", "Thanks, sounds good", "yes please", "got it"]) {
    const out = await pointer(h.ctx, { ...base, threadId: "thr_a", text });
    assert.equal(out.skipped, "short_ack", text);
    assert.deepEqual(out.lines, []);
  }
  const none = await pointer(h.ctx, { ...base, threadId: "thr_a", text: "What is the capital of Portugal?" });
  assert.equal(none.skipped, "no_match");
  assert.equal(none.tokens, 0);
});

test("nothing is repeated in a thread, and a new thread starts fresh", async () => {
  const h = harness();
  seedFact(h, { id: "fct_1", layer: "agent", agentId: "agt_intake", text: "Refunds above 500 dollars need a second approver" });
  const ask = { ...base, text: "Do refunds need a second approver?" };
  assert.equal((await pointer(h.ctx, { ...ask, threadId: "thr_a" })).lines.length, 1);
  const again = await pointer(h.ctx, { ...ask, threadId: "thr_a" });
  assert.equal(again.skipped, "duplicate");
  assert.deepEqual(again.lines, []);
  assert.equal((await pointer(h.ctx, { ...ask, threadId: "thr_b" })).lines.length, 1);
});

test("the same message index again is a step in a tool loop and gets nothing", async () => {
  const h = harness();
  seedFact(h, { id: "fct_1", layer: "agent", agentId: "agt_intake", text: "Refunds above 500 dollars need a second approver" });
  const ask = { ...base, threadId: "thr_a", text: "Do refunds need a second approver?" };
  assert.equal((await pointer(h.ctx, { ...ask, sinceIdx: 3 })).lines.length, 1);
  assert.equal((await pointer(h.ctx, { ...ask, sinceIdx: 3 })).skipped, "mid_tool_loop");
  assert.equal((await pointer(h.ctx, { ...ask, threadId: "thr_a", sinceIdx: 4 })).skipped, "duplicate");
});

test("at most five lines and about 350 tokens, with long facts cut", async () => {
  const h = harness();
  for (let i = 0; i < 200; i++) seedFact(h, { id: `fct_n${i}`, layer: "agent", agentId: "agt_intake", text: `Account ${i} is owned by region ${i % 40} and renews in month ${i % 12}` });
  for (let i = 0; i < 12; i++) seedFact(h, { id: `fct_w${i}`, layer: "agent", agentId: "agt_intake", text: `Widget rule ${i}: ${"the widget must be checked twice before it ships ".repeat(8)}` });
  const out = await pointer(h.ctx, { ...base, threadId: "thr_a", text: "What are the widget rules?" });
  assert.ok(out.lines.length >= 1 && out.lines.length <= 5, `got ${out.lines.length} lines`);
  assert.ok(out.tokens <= 350, `got ${out.tokens} tokens`);
  for (const l of out.lines) assert.ok((l.fact ?? "").length <= 160);
});

test("closed, removed, proposed and expired facts are never offered", async () => {
  const h = harness();
  seedFact(h, { id: "fct_c", layer: "agent", agentId: "agt_intake", status: "closed", validTo: NOW - DAY, text: "Zebra protocol starts at nine" });
  seedFact(h, { id: "fct_r", layer: "agent", agentId: "agt_intake", status: "removed", text: "Zebra protocol starts at eight" });
  seedFact(h, { id: "fct_p", layer: "agent", agentId: "agt_intake", status: "proposed", text: "Zebra protocol starts at seven" });
  seedFact(h, { id: "fct_e", layer: "agent", agentId: "agt_intake", status: "current", validTo: NOW - 1, text: "Zebra protocol starts at six" });
  seedFact(h, { id: "fct_ok", layer: "agent", agentId: "agt_intake", text: "Zebra protocol starts at ten" });
  const out = await pointer(h.ctx, { ...base, threadId: "thr_a", text: "When does the zebra protocol start?" });
  assert.deepEqual(out.lines.map((l) => l.fact), ["Zebra protocol starts at ten"]);
});

test("another agent's layer and another person's layer stay out of the block", async () => {
  const h = harness();
  seedFact(h, { id: "fct_o", layer: "agent", agentId: "agt_billing", text: "Quokka invoices go out on Friday" });
  seedFact(h, { id: "fct_q", layer: "person", owner: "usr_omar", agentId: "agt_intake", text: "Quokka is Omar's secret nickname" });
  seedFact(h, { id: "fct_s", layer: "space", text: "Quokka is the Studio mascot" });
  const out = await pointer(h.ctx, { ...base, threadId: "thr_a", text: "Tell me about the quokka" });
  assert.deepEqual(out.lines.map((l) => l.fact), ["Quokka is the Studio mascot"]);
});

test("the lookup is fast on a big memory", async () => {
  const h = harness();
  for (let i = 0; i < 1500; i++) seedFact(h, { id: `fct_big${i}`, layer: "agent", agentId: "agt_intake", text: `Account ${i} is owned by region ${i % 40} and renews in month ${i % 12}` });
  seedFact(h, { id: "fct_target", layer: "agent", agentId: "agt_intake", text: "Quasar contract renews in November under Fiona" });
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const out = await pointer(h.ctx, { ...base, threadId: `thr_${i}`, text: "When does the quasar contract renew?" });
    times.push(performance.now() - t0);
    assert.equal(out.lines[0]?.fact, "Quasar contract renews in November under Fiona");
  }
  assert.ok(Math.max(...times) < 200, `slowest ${Math.max(...times)} ms`);
  assert.ok([...times].sort((a, b) => a - b)[2]! < 50, `median ${[...times].sort((a, b) => a - b)[2]} ms`);
});
