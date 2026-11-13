// A step that is missing an input says what to do in plain words (owner, 13 Nov 2026: "Send for signature needs fileId"). For every step kind and each input it cannot run without, left out one at a time,
// the message has no field key, no camelCase word and no bare "error", and the chip the card shows is one to three words.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { chipForIssue, knownInput, missingInput, missingMessage } from "../../../lib/words/step-missing.ts";
import { validateDefinition } from "../handlers/defs.ts";
import type { Definition } from "../projections.ts";

const POLICY = {
  maxChainDepth: 8,
  defaultAlert: { when: "every", where: "needs_you" },
  runOnImport: false,
  personalSpace: false,
} as const;
const requiredOf = (schema: unknown): string[] => {
  const r = (schema as { required?: unknown } | null)?.required;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
};
const CAMEL = /[a-z][A-Z]/;

const CASES = registry.steps.flatMap((s) => requiredOf(s.input).map((field) => ({ step: s, field })));

test("there is a table row case for every required input of every step kind", () => {
  assert.ok(CASES.length >= 90, `only ${CASES.length} required inputs found`);
});

for (const { step, field } of CASES) {
  test(`${step.key} without ${field} says what to do in words`, () => {
    const def: Definition = {
      triggers: [{ key: "manual" }],
      nodes: [{ id: "n1", key: step.key, input: {} }],
      start: ["n1"],
    };
    const mine = validateDefinition(def, POLICY as never).filter(
      (i) => i.nodeId === "n1" && i.severity === "error" && i.message.startsWith(`${step.title}: `),
    );
    assert.equal(
      knownInput(step.key, field),
      true,
      `${step.key}.${field} has no row in lib/words/step-missing.ts: add one`,
    );
    const words = missingInput(step.key, field);
    assert.ok(
      mine.some((i) => i.message === missingMessage(step.title, step.key, field)),
      `${step.key}.${field}: no message from the table in ${JSON.stringify(mine.map((i) => i.message))}`,
    );
    const all = [
      missingMessage(step.title, step.key, field),
      words.chip,
      chipForIssue(missingMessage(step.title, step.key, field)),
    ];
    for (const text of all) {
      // a key that is only an English word (stage, title, to) may be said as that word; a technical key (fileId, spreadsheetId, subjectRecordId, rowId) never
      if (/[A-Z_]/.test(field)) assert.equal(text.includes(field), false, `${field} is in "${text}"`);
      assert.equal(CAMEL.test(text.replace(step.title, "")), false, `a camelCase word in "${text}"`);
      assert.equal(/\berror\b/i.test(text), false, `a bare error in "${text}"`);
      assert.equal(/_/.test(text.replace(step.title, "")), false, `a snake_case word in "${text}"`);
    }
    assert.ok(
      words.chip.split(/\s+/).length <= 3 && words.chip.length > 0,
      `the chip is one to three words: "${words.chip}"`,
    );
    assert.equal(
      chipForIssue(missingMessage(step.title, step.key, field)),
      words.chip,
      "the chip is the one the table gives",
    );
  });
}

test("the owner's own example reads as he would say it", () => {
  assert.equal(
    missingMessage("Send for signature", "sign", "fileId"),
    "Send for signature: choose the file to send for signature.",
  );
  assert.equal(chipForIssue("Send for signature: choose the file to send for signature."), "Needs a file");
});

test("a field the table does not know still reads as words, never as its key", () => {
  const w = missingInput("some_new_step", "legalEntityId");
  assert.equal(CAMEL.test(w.do), false, w.do);
  assert.equal(w.do.includes("legalEntityId"), false);
  assert.equal(w.chip, "Needs a detail");
  assert.equal(chipForIssue(`Some step: ${w.do}.`), "Needs a detail", "the card says what the table says");
  assert.equal(knownInput("some_new_step", "legalEntityId"), false);
});

test("a chip for a message with no table row says what kind of thing it is, never error", () => {
  assert.equal(chipForIssue("Send an email needs a mailbox."), "Needs a mailbox");
  assert.equal(chipForIssue("A loop cannot contain another loop."), "Needs a fix");
});
