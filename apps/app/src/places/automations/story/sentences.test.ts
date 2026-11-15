import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../../../../generated/registry.ts";
import { durationWords, fallbackSentenceKinds, fallbackTriggerKinds, parseTemplate } from "./sentences.ts";

test("every step kind and trigger kind the server lists has a sentence, or is named as falling back", () => {
  assert.deepEqual(
    fallbackSentenceKinds(registry.steps.map((s) => s.key)),
    [],
    "step kinds with no sentence",
  );
  assert.deepEqual(
    fallbackTriggerKinds(registry.triggers.map((t) => t.key)),
    [],
    "trigger kinds with no sentence",
  );
});

test("durations are words and a template parses into literals, slots and optional groups", () => {
  assert.equal(durationWords("2d"), "2 days");
  assert.equal(durationWords("1h"), "1 hour");
  assert.equal(durationWords("90m"), "90 minutes");
  assert.equal(durationWords("until Friday"), "until Friday");
  const p = parseTemplate("Email to {to}(, “{subject|body}”)");
  assert.equal(p[0]!.lit, "Email to ");
  assert.deepEqual(p[1]!.slot!.names, ["to"]);
  assert.equal(p[2]!.group!.length, 3);
});
