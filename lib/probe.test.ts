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
