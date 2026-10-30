import test from "node:test";
import assert from "node:assert/strict";
import { stepsOf } from "./flow.ts";
import { greeting, scriptFor } from "./script.ts";

test("every step of every flow has scripted words, a preview and a skip hint", () => {
  for (const flow of ["personal", "team", "member"] as const) for (const s of stepsOf(flow)) {
    const w = scriptFor(s.card, flow);
    assert.ok(w.lines.length > 0 && (w.preview !== "" || s.card === "chrome" || s.card === "import_sessions") && w.skipHint !== "", `${flow}/${s.key}`);
    assert.ok(!w.lines.some((l) => l.includes("no words yet")), `${flow}/${s.key} has words`);
  }
});

test("the words use no em dash, no section sign, no industry term", () => {
  const all: string[] = [];
  for (const flow of ["personal", "team", "member"] as const) { all.push(greeting(flow, "Acme")); for (const s of stepsOf(flow)) { const w = scriptFor(s.card, flow); all.push(...w.lines, w.preview, w.skipHint); } }
  for (const t of all) { assert.ok(!t.includes("—") && !t.includes("§"), t); assert.ok(!/\b(law|legal|client|attorney|firm)\b/i.test(t), t); }
});

test("a member sees member words for the cards only they have", () => {
  assert.match(scriptFor("own_data", "member").lines[0]!, /only you/);
  assert.match(greeting("team", "Acme"), /You own it/);
});
