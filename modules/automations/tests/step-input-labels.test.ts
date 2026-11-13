// A step card names each input by a plain word, from one table (lib/step-input-labels.ts): every input of every step in the palette has an entry, and no label is or contains the word "Id".
import test from "node:test";
import assert from "node:assert/strict";
import { STEP_INPUT_LABELS, stepInputLabel } from "../../../lib/step-input-labels.ts";
import { harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";

test("every input name of every step has a label in the table, and no label contains Id", async () => {
  const h = harness();
  // `all`: every step the server can run; without it the list holds only the apps connected for the caller
  const steps = (await h.call("automations.steps.list", { all: true }, alice)).steps as {
    key: string;
    input?: { properties?: Record<string, unknown> };
  }[];
  assert.ok(steps.length >= 60, "the whole palette");
  const names = new Set<string>();
  for (const s of steps) for (const k of Object.keys(s.input?.properties ?? {})) names.add(k);
  assert.ok(names.size >= 100, `the palette's input names (${names.size})`);
  const missing = [...names].filter((n) => STEP_INPUT_LABELS[n] === undefined).sort();
  assert.deepEqual(missing, [], "an input name with no label");
  const idish = Object.entries(STEP_INPUT_LABELS).filter(([, l]) => /\bids?\b/i.test(l));
  assert.deepEqual(idish, [], "a label says Id");
  const unused = Object.keys(STEP_INPUT_LABELS)
    .filter((n) => !names.has(n))
    .sort();
  assert.deepEqual(unused, [], "a label for an input no step has (a renamed input)");
});

test("stepInputLabel: a table entry, else the words in sentence case without a trailing id", () => {
  assert.equal(stepInputLabel("dueDate"), "Due date");
  assert.equal(stepInputLabel("due_date"), "Due date");
  assert.equal(stepInputLabel("folderId"), "Folder");
  assert.equal(stepInputLabel("id"), "Id");
});
