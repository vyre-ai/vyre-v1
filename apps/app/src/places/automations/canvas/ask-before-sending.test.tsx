// Ask before sending: On is stored on the step, Off is the absence of it, and only steps that send carry it. A Space rule is named in the note.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import { registry } from "../../../../../../generated/registry.ts";
import { AskBeforeSending, OUTWARD_STEPS, approvalChoices, approvalNote, sendsOutward } from "./AskBeforeSending.tsx";
import { updateStep } from "./model.ts";

const def = { triggers: [{ key: "manual" }], nodes: [{ id: "mail", key: "send_email", input: {} }] } as never;

test("only steps that reach people or other systems carry the setting", () => {
  for (const k of ["send_email", "send_sms", "post_message", "connector_request", "google.gmail.send_message"]) assert.equal(sendsOutward(k), true, k);
  for (const k of ["records.update", "wait", "if", "records.find", "approval"]) assert.equal(sendsOutward(k), false, k);
});

test("the list of outward steps is the registry's: a new outward step fails here until it is added", () => {
  assert.deepEqual([...OUTWARD_STEPS].sort(), registry.steps.filter((s) => s.effects === "outward").map((s) => s.key).sort());
});

test("choosing On stores it on the step and choosing Off removes it", () => {
  const on = updateStep(def, "mail", { askBeforeSending: true });
  assert.equal(on.nodes[0]!.askBeforeSending, true);
  const off = updateStep(on, "mail", { askBeforeSending: false });
  assert.equal("askBeforeSending" in off.nodes[0]!, false);
  const picks: boolean[] = [];
  const menu = approvalChoices(true, (n) => picks.push(n)) as MenuItem[];
  assert.deepEqual(menu.map((e) => [e.label, e.checked]), [["Off", false], ["On", true]]);
  for (const e of menu) e.onSelect?.();
  assert.deepEqual(picks, [false, true]);
});

test("the note says what happens, and names a Space rule that still holds the send", () => {
  assert.equal(approvalNote(false, false), "The send goes out as soon as the step runs.");
  assert.equal(approvalNote(true, false), "The send waits until someone approves it.");
  assert.match(approvalNote(false, true), /Your Space requires approval for sends\. This step waits even though this is Off\./);
  const html = renderToStaticMarkup(<AskBeforeSending on={false} adminRule onSet={() => undefined} />);
  assert.ok(html.includes("Ask before sending") && html.includes("Your Space requires approval for sends"));
});
