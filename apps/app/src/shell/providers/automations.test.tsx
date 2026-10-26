import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleAutomations } from "../../places/automations/sidebar/sample.ts";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import AutomationsPlace, { automationsData } from "./automations.tsx";

test("the Automations place draws the sidebar through the shell runtime", () => {
  const s = createSampleAutomations();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const out = renderToStaticMarkup(<ShellRuntimeProvider value={rt}><AutomationsPlace place="automations" /></ShellRuntimeProvider>);
  assert.ok(out.includes("automations-place"));
  assert.ok(out.includes("Journeys"));
  assert.ok(out.includes("Pick an Automation"));
});

test("without a runtime Automations draws its loading frame", () => {
  assert.ok(renderToStaticMarkup(<AutomationsPlace place="automations" />).includes("automations-loading"));
});

test("Automations opens a run through the shell's door", () => {
  const s = createSampleAutomations();
  const opened: string[] = [];
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call, opened });
  const d = automationsData(rt, { openAutomation: () => undefined, openJourney: () => undefined, openFailedRuns: () => rt.open({ screen: "runs.failed" }), openRun: () => undefined, ask: () => undefined, connect: () => undefined });
  d.nav.openFailedRuns();
  assert.deepEqual(opened, ["runs.failed"]);
  assert.equal(d.name("usr_irfad"), "Irfad Imtiaz");
});
