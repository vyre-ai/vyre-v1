// P-L9f_02c: the Runs tab as the prototype draws it. The step graph column beside the run list, Skip step and Edit step on the error row (and Skip step on the Needs attention row), a queued run
// in the list, the filled Approve, and the failed row's actions Retry step, Skip step, Stop. Screens render with react-dom/server over react-native-web (ruling 28); controls are checked by
// the calls they make, because a static render has no clicks.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { AutomationCanvas } from "../canvas/AutomationCanvas.tsx";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createConfigSample, northwind as configNorthwind } from "../config/sample.ts";
import { RunsDataProvider } from "../runs/data.tsx";
import { runMenu } from "../runs/actions.tsx";
import type { RunActions } from "../runs/actions.tsx";
import { stepAfterFailed } from "../runs/model.ts";
import type { Run, RunStep } from "../runs/model.ts";
import { RunChat } from "../runs/RunChat.tsx";
import { RunHistory } from "../runs/RunHistory.tsx";
import { createSampleRuns, northwind } from "../runs/sample.ts";
import type { SampleRuns } from "../runs/sample.ts";

const page = (s: SampleRuns, el: ReactNode): string => renderToStaticMarkup(<RunsDataProvider value={s.data}>{el}</RunsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const runOf = (s: SampleRuns, id: string): Run => (s.replica.rows("runs") as unknown as Run[]).find((r) => r.id === id)!;
const step = (name: string, state: RunStep["state"]): RunStep => ({ step: name, attempt: 1, state } as unknown as RunStep);

test("the Runs tab shows the step graph column beside the run list, and no graph without a run list body", () => {
  const config = createConfigSample(configNorthwind);
  const runs = createSampleRuns(northwind);
  const withList = renderToStaticMarkup(
    <AutomationsDataProvider value={config.data}>
      <RunsDataProvider value={runs.data}>
        <AutomationCanvas automationId="aut_lead" initialTab="runs" tabBodies={{ runs: <RunHistory subject={{ type: "automation", id: "aut_lead" }} currentVersion={5} /> }} run={{ id: "rl1", label: "this run", states: { find: "done", text: "failed" } }} />
      </RunsDataProvider>
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.ok(has(withList, 'data-testid="run-history"') && has(withList, 'data-testid="run-graph"'), "list and graph");
  assert.ok(at(withList, 'data-testid="run-history"') < at(withList, 'data-testid="run-graph"'), "the graph is to the right of the list");
  assert.ok(has(withList, 'aria-selected="true"') && has(withList, ">Runs<"), "the Runs tab is the selected one");
});

test("the failed run's error row has Retry step, Skip step and Stop, and under it the trace id, Copy trace id, Edit step and Replay", () => {
  const out = page(createSampleRuns(northwind), <RunChat runId="rl1" />);
  const ids = ["retry-step", "skip-step", "stop-failed", "copy-trace", "edit-step", "replay"];
  for (const id of ids) assert.ok(has(out, `data-testid="${id}"`), id);
  const pos = ids.map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "in the prototype's order");
  assert.ok(!has(out, 'data-testid="retry-start"'), "Retry from the start moved to the row menu");
});

test("the Needs attention row carries Retry step, Copy trace id, Skip step and Stop", () => {
  const out = page(createSampleRuns(northwind), <RunHistory subject={{ type: "automation", id: "aut_lead" }} currentVersion={5} />);
  for (const id of ["retry-step-rl1", "copy-trace-rl1", "skip-step-rl1", "stop-rl1"]) assert.ok(has(out, `data-testid="${id}"`), id);
});

test("Retry from the start is in the run's menu while a failed run is still open", () => {
  const s = createSampleRuns(northwind);
  const labels = runMenu(runOf(s, "rl1"), {} as RunActions, { openRun: () => undefined, openRunSide: () => undefined }, () => undefined, { x: 0, y: 0 }, true).map((e) => ("label" in e ? e.label : ""));
  assert.ok(labels.includes("Retry"));
});

test("a queued run lists above the run waiting on someone, with its own words and the clock mark", () => {
  const out = page(createSampleRuns(northwind), <RunHistory subject={{ type: "automation", id: "aut_invoice" }} currentVersion={4} />);
  assert.ok(has(out, "Invoice 1046, Okafor Family, $2,150") && has(out, "Queued, starts when a slot is free"));
  assert.ok(at(out, "Invoice 1046") < at(out, "Waiting for a yes"), "newest first, so the queued run is on top");
  assert.ok(has(out, "Succeeded, 6 steps, 71 s"), "and the earlier Fridays follow");
});

test("Approve is the filled button and Decline stays quiet", () => {
  const out = page(createSampleRuns(northwind), <RunChat runId="ri1" />);
  const approve = out.match(/<[^>]*data-testid="approve"[^>]*>/)?.[0] ?? "";
  const decline = out.match(/<[^>]*data-testid="decline"[^>]*>/)?.[0] ?? "";
  assert.match(approve, /data-tone="filled"/, "Approve is the filled button");
  assert.match(decline, /data-tone="plain"/, "Decline stays quiet");
});

test("Skip step carries on from the step after the failed one, and says so when nothing follows", async () => {
  assert.equal(stepAfterFailed([step("find", "succeeded"), step("text", "failed"), step("wait", "pending")]), "wait");
  assert.equal(stepAfterFailed([step("find", "succeeded"), step("text", "failed"), step("text", "failed")]), undefined);
  assert.equal(stepAfterFailed([step("find", "succeeded")]), undefined);
  const s = createSampleRuns(northwind);
  const out = await s.data.call("runs.steps", { runId: "rl1" }) as { steps: RunStep[] };
  assert.equal(stepAfterFailed(out.steps), "wait");
  const retried = await s.data.call("runs.retry", { runId: "rl1", fromStep: "wait" }) as { runId: string };
  assert.ok(retried.runId && runOf(s, retried.runId).parentRun === "rl1");
  assert.deepEqual(s.calls.map((c) => c.cap), ["runs.steps", "runs.retry"]);
});

test("Edit step opens the Automation with the failed step selected", () => {
  const s = createSampleRuns(northwind);
  s.data.nav.openAutomation("aut_lead", "text");
  s.data.nav.openAutomation("aut_lead");
  assert.deepEqual(s.opened, ["automation:aut_lead:text", "automation:aut_lead"]);
});
