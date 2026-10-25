// The 35 Chrome, Screen and Files tools of P-L2_16b against the frozen contract (ARCH 12.4): every one has a handler, every example input is valid, and each answers in the shape of its output
// schema. An agent calls them without naming its computer, which is how they are used, and each lands in the table once.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { assertEventsConform, contractErrors } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";

const mine = registry.capabilities.filter((c) => c.module === "computers" && /^computers\.(chrome|screen|files)\./.test(c.name));

const CASES: Array<[string, Record<string, unknown>]> = [
  ["computers.chrome.snapshot", { format: "tree" }],
  ["computers.chrome.act", { ref: "e2", action: "click" }],
  ["computers.chrome.click", { ref: "e2" }],
  ["computers.chrome.type", { ref: "e3", text: "hello", submit: true }],
  ["computers.chrome.fill", { fields: [{ ref: "e3", value: "hello" }] }],
  ["computers.chrome.open", { url: "https://example.com/form" }],
  ["computers.chrome.tabs", { action: "list" }],
  ["computers.chrome.wait", { until: "load" }],
  ["computers.chrome.screenshot", { fullPage: true }],
  ["computers.chrome.eval", { expression: "document.title" }],
  ["computers.chrome.console", { level: "log", limit: 10 }],
  ["computers.chrome.net", { bodies: true }],
  ["computers.chrome.inspect", { ref: "e2" }],
  ["computers.chrome.state", {}],
  ["computers.chrome.status", {}],
  ["computers.chrome.stop", { reason: "the person asked" }],
  ["computers.chrome.resume", {}],
  ["computers.chrome.send", { heldId: "held_1" }],
  ["computers.chrome.batch", { steps: [{ tool: "click", args: { ref: "e2" } }, { tool: "state", args: {} }] }],
  ["computers.chrome.plan", { goal: "Open the intake form", steps: ["Open it", "Fill it"] }],
  ["computers.chrome.api", { method: "GET", url: "https://example.com/api/items" }],
  ["computers.chrome.sources", {}],
  ["computers.screen.screenshot", {}],
  ["computers.screen.click", { x: 10, y: 20, button: "left", double: true }],
  ["computers.screen.move", { x: 10, y: 20 }],
  ["computers.screen.drag", { fromX: 1, fromY: 2, toX: 30, toY: 40 }],
  ["computers.screen.type", { text: "hello" }],
  ["computers.screen.key", { combo: "ctrl+l" }],
  ["computers.screen.scroll", { x: 5, y: 5, dy: 120 }],
  ["computers.screen.wait", { ms: 50 }],
  ["computers.files.list", { path: "work" }],
  ["computers.files.read", { path: "work/notes.md" }],
  ["computers.files.write", { path: "work/notes.md", content: "hello" }],
  ["computers.files.move", { from: "work/notes.md", to: "work/old.md" }],
  ["computers.files.delete", { path: "work/old.md" }],
];

test("the 35 tools are 22 Chrome, 8 Screen and 5 Files, each with a handler in the module's table", () => {
  assert.equal(mine.length, 35);
  assert.equal(mine.filter((c) => c.name.startsWith("computers.chrome.")).length, 22);
  assert.equal(mine.filter((c) => c.name.startsWith("computers.screen.")).length, 8);
  assert.equal(mine.filter((c) => c.name.startsWith("computers.files.")).length, 5);
  for (const c of mine) assert.equal(typeof (handlers as Record<string, unknown>)[c.name], "function", c.name);
  assert.deepEqual(CASES.map(([n]) => n).sort(), mine.map((c) => c.name).sort(), "this file has a case for every tool");
});

test("each example input of a tool is a valid input", () => {
  for (const c of mine) {
    assert.ok(c.examples.length > 0, `${c.name} has an example`);
    for (const ex of c.examples) assert.deepEqual(contractErrors(c.name, "in", ex.input), [], `${c.name}: example ${ex.name}`);
  }
});

test("each tool, called by the agent that owns the computer without naming it, answers in the shape of its output schema", async () => {
  const w = await world();
  const agent = w.agent();
  for (const [name, input] of CASES) {
    const cap = mine.find((c) => c.name === name)!;
    const full = cap.idempotency === "key" ? { ...input, idempotencyKey: "idem-1" } : input;
    assert.deepEqual(contractErrors(name, "in", full), [], `${name}: the case input is valid`);
    const out = await tool[name]!(agent.ctx, full);
    assert.deepEqual(contractErrors(name, "out", out), [], `${name}: output`);
  }
  assert.deepEqual(assertEventsConform(w.h), []);
  bindHost(null);
});

test("the same tools work for a person who names the computer, and not without it", async () => {
  const w = await world();
  for (const [name, input] of CASES) {
    const out = await tool[name]!(w.h.ctx, { ...input, computerId: w.id });
    assert.deepEqual(contractErrors(name, "out", out), [], `${name}: output`);
  }
  for (const [name, input] of CASES) {
    // The batch carries its own steps and reports a missing computer per step instead of refusing the whole call.
    if (name === "computers.chrome.batch") continue;
    await assert.rejects(() => tool[name]!(w.h.ctx, input), (e: any) => e?.error?.code === "validation.bad_input", `${name} without a computer`);
  }
  bindHost(null);
});
