// A run as a page of rows read from the step log (AUTOMATIONS-BUILD-RC29 round two, item 3).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { RunPage } from "./RunPage.tsx";

test("a failed run is rows numbered as the builder, one plain sentence, one button that opens the step and one that runs it again", async () => {
  installDom();
  const s = createSampleAutomations(northwind);
  const base = s.data;
  const data = {
    ...base,
    call: async (cap: string, input: Record<string, unknown>) => {
      if (cap === "runs.get") return { run: { subject: { type: "automation", id: "aut_lead" } } };
      if (cap === "runs.steps")
        return { steps: [{ step: "find", state: "succeeded" }, { step: "text", state: "failed", error: { message: "The Twilio key is missing" } }] };
      if (cap === "runs.step_io") return { output: { Name: "Sam Reyes", recordId: "rec_1" } };
      return base.call(cap as never, input as never);
    },
  };
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={data as never}>
      <RunPage runId="run_1" />
    </AutomationsDataProvider>,
  );
  await flush();
  const text = textOf(root);
  assert.match(text, /Stopped at step \d/);
  assert.match(text, /The Twilio key is missing\./);
  assert.ok(find(root, "rv-fix"), "one button opens the step");
  assert.equal(/rec_1/.test(text), false, "no id reaches the page");
  await press(find(root, "run-again"));
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "automations.retry").length, 1);
});
