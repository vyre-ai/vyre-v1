// A run's steps are named for a person: the author's title, else what the step does, else its place; never the stored id. Every step kind the registry has gets a name.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { durationWords, idLike, plainKindTitle, stepWords } from "./steps.ts";
import { leaksCode } from "./audit.ts";

const registry = JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { steps: { key: string; title?: string }[] };

test("the author's title wins; an id-like title does not count", () => {
  assert.equal(stepWords({ id: "step_1", key: "send_email", title: "Email the client" }), "Email the client");
  assert.equal(stepWords({ id: "step_1", key: "send_email", title: "step_1" }), "Send an email");
  assert.equal(stepWords({ id: "n_7f3a", title: "n_7f3a" }, undefined, 3), "Step 3");
});

test("a step with no title says what its kind does, and a wait says how long", () => {
  assert.equal(stepWords({ id: "a", key: "send_email" }), "Send an email");
  assert.equal(stepWords({ id: "a", key: "records.update" }, "Update a record"), "Update a record");
  assert.equal(stepWords({ id: "a", key: "google.calendar.create_event" }, "Google · Create a calendar event"), "Create a calendar event in Google");
  assert.equal(stepWords({ id: "a", key: "files.move" }, "Files · Move a file"), "Move a file");
  assert.equal(stepWords({ id: "a", key: "wait", input: { forDuration: "2d" } }), "Wait 2 days");
  assert.equal(stepWords({ id: "a", key: "wait", input: { timeout: "90m" } }), "Wait 90 minutes");
  assert.equal(stepWords({ id: "a", key: "wait", input: { forDuration: "1w" } }), "Wait a week");
  assert.equal(stepWords({ id: "a", key: "wait", input: { event: { event: "x" } } }), "Wait for something to happen");
  assert.equal(stepWords({ id: "a", key: "http_request" }), "Call a web address");
  assert.equal(durationWords("6h"), "6 hours");
  assert.equal(durationWords("soon"), null);
  assert.ok(idLike("step_12") && idLike("n_7f3a") && !idLike("Email the client"));
});

test("every step kind the registry has is named in plain words, never as a code", () => {
  const bad: string[] = [];
  for (const s of registry.steps) {
    const t = stepWords({ id: "step_1", key: s.key }, s.title, 1);
    const why = leaksCode(t);
    if (why || t.length < 3 || /^Step \d/.test(t)) bad.push(`${s.key}: ${t} (${why ?? "no name"})`);
  }
  assert.deepEqual(bad, []);
  assert.equal(plainKindTitle("nonexistent.kind_here"), "Kind here");
});
