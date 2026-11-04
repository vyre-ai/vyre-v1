// Placeholder arguments (lib/probe.ts): what is refused as a probe, and what real calls pass.
import test from "node:test";
import assert from "node:assert/strict";
import { probeIn } from "./probe.ts";

test("placeholders are found: example hosts, a bare test, foo and bar, probe ids, lorem ipsum, in any depth", () => {
  for (const v of [{ url: "https://example.com" }, { to: ["client@example.org"] }, { site: "www.example.net/page" }, { title: "test" }, { title: " Testing " }, { a: { b: [{ c: "foo" }] } }, { id: "rec_none" },
    { fileId: "__probe_none__" }, { recordId: "rec___probe_x" }, { body: "Lorem ipsum dolor sit amet" }, { prompt: "bar" }, { name: "placeholder" }, { id: "thr_nonexistent" }, { x: "asdf" }]) {
    assert.notEqual(probeIn(v), null, JSON.stringify(v));
  }
});

test("real calls pass: ordinary words, ids, a search for the word test, an empty field (the schema's to refuse), idempotency keys", () => {
  for (const v of [{ url: "https://baileyandgalyen.com/free-consultation" }, { to: ["maya@northwind.com"], subject: "Retainer", body: "Dear Lee, the retainer is attached." }, { q: "test" }, { query: "foo" },
    { recordId: "rec_01a1a392662d48efb1762dffc795f3a3" }, { title: "Test results for the Rivera matter" }, { body: "" }, { idempotencyKey: "test" }, { n: 3, ok: true, list: [1, 2] }, null, "Draft the October note"]) {
    assert.equal(probeIn(v), null, JSON.stringify(v));
  }
});

import { peopleWords } from "./probe.ts";

test("internal words become people's words in what a model reads", () => {
  assert.equal(peopleWords("This call was held at the Gate and waits for a person."), "This call was waiting for approval and waits for a person.");
  assert.equal(peopleWords("The Gate needs a yes. Gate hold released."), "The approval needs a yes. approval released.");
  assert.equal(peopleWords("Two holds are open and this hold expired."), "Two approvals are open and this approval expired.");
  assert.equal(peopleWords("Hold the line while it runs"), "Hold the line while it runs", "ordinary words are left alone");
});

test("a word the tool's own schema lists as a choice is not a placeholder, but the same word where the schema asks for free text still is", () => {
  const schema = { properties: { list: { properties: { cursor: { properties: { kind: { enum: ["none", "page", "cursor"] } } } } }, title: { type: "string" } } };
  assert.equal(probeIn({ list: { cursor: { kind: "none" } } }, "", "", schema), null);
  assert.equal(probeIn({ list: { cursor: { kind: "none" } } }), "none", "without the schema the word is still caught");
  assert.equal(probeIn({ title: "none" }, "", "", schema), "none");
  assert.equal(probeIn({ rows: [{ kind: "none" }] }, "", "", { properties: { rows: { items: { properties: { kind: { enum: ["none"] } } } } } }), null);
});
