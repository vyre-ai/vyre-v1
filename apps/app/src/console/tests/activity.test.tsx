// Console > Agents > Activity: runs.list under All, Active, Waiting and Failed and stopped, a status on each run, a run that opens to its steps with Stop or Retry, and people's own agents as one counted line.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { ActivityPage, inTab, ownAgentsLine, statusWords } from "../pages/Activity.tsx";
import { dataWith } from "./sheet-helper.tsx";

const run = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, kind: "routine", name: `Job ${id}`, owner: "usr_maya", startedBy: "usr_maya", status, costMicros: 0, startedAt: Date.now() - 3_600_000, traceId: `trc_${id}`, ...extra });
const RUNS = [run("run_1", "running"), run("run_2", "waiting", { waitReason: "approval" }), run("run_3", "failed"), run("run_4", "succeeded"), run("run_5", "stopped")];
const rows: Record<string, unknown> = {
  "runs.list": { runs: RUNS, total: 5 },
  "runs.people_counts": { people: [{ person: "usr_a", runs: 6 }, { person: "usr_b", runs: 4 }, { person: "usr_c", runs: 2 }, { person: "usr_d", runs: 1 }] },
  "runs.get": { run: RUNS[2] },
  "runs.steps": { steps: [{ step: "Fetch the form", attempt: 1, state: "succeeded" }, { step: "Create the lead", attempt: 1, state: "failed", error: { code: "x", message: "The CRM said no" } }], total: 2 },
};
async function page() {
  const calls: { cap: string; input: any }[] = [];
  const call = async (cap: string, input: unknown) => { calls.push({ cap, input }); return {}; };
  const restore = installDom();
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith(rows, { call: call as never })}><ActivityPage /></ConsoleDataProvider>);
  return { root, calls, restore };
}

test("a run counts under the tab its status says", () => {
  const by = (s: string) => RUNS.find((r) => r.status === s) as never;
  assert.ok(inTab(by("running"), "active") && inTab(by("waiting"), "active") && !inTab(by("failed"), "active"));
  assert.ok(inTab(by("waiting"), "waiting") && !inTab(by("running"), "waiting"));
  assert.ok(inTab(by("failed"), "failed") && inTab(by("stopped"), "failed") && !inTab(by("succeeded"), "failed"));
  assert.ok(RUNS.every((r) => inTab(r as never, "all")));
  assert.equal(statusWords({ status: "waiting", waitReason: "approval" }), "Waiting for approval");
  assert.equal(statusWords({ status: "failed" }), "Failed");
});

test("people's own agents are one counted line and nothing is named", () => {
  assert.equal(ownAgentsLine(13, 4), "13 runs today by 4 people's own agents");
  assert.equal(ownAgentsLine(1, 1), "1 run today by 1 person's own agents");
});

test("the page lists every run with a status, the tab counts and the counted line for people's own agents", async () => {
  const { root, calls, restore } = await page();
  try {
    const text = textOf(root);
    for (const id of ["run_1", "run_2", "run_3", "run_4", "run_5"]) assert.ok(find(root, `row-run-${id}`), id);
    assert.match(text, /All 5/); assert.match(text, /Active 2/); assert.match(text, /Waiting 1/); assert.match(text, /Failed and stopped 2/);
    assert.match(text, /Waiting for approval/);
    assert.match(text, /13 runs today by 4 people's own agents/);
    assert.match(text, /Admins see the count, never the work\./);
    assert.deepEqual(calls.map((c) => c.cap), [], "reading calls nothing else");
  } finally { restore(); }
});

test("each tab filters the list", async () => {
  const { root, restore } = await page();
  try {
    await press(find(root, "seg-failed"));
    assert.ok(find(root, "row-run-run_3") && find(root, "row-run-run_5") && !find(root, "row-run-run_1") && !find(root, "row-run-run_4"));
    await press(find(root, "seg-waiting"));
    assert.ok(find(root, "row-run-run_2") && !find(root, "row-run-run_3"));
    await press(find(root, "seg-active"));
    assert.ok(find(root, "row-run-run_1") && find(root, "row-run-run_2") && !find(root, "row-run-run_4"));
  } finally { restore(); }
});

test("opening a run reads its steps, and a failed run offers Retry which calls runs.retry", async () => {
  const { root, calls, restore } = await page();
  try {
    await press(find(root, "seg-failed"));
    await press(find(root, "row-run-run_3"));
    assert.ok(find(root, "run-detail-run_3"));
    assert.match(textOf(root), /Create the lead/);
    assert.match(textOf(root), /The CRM said no/);
    await press(find(root, "run-retry-run_3"));
    assert.deepEqual(calls.map((c) => c.cap), ["runs.retry"]);
    assert.deepEqual(calls[0]!.input, { runId: "run_3" });
  } finally { restore(); }
});

test("a run still going offers Stop which calls runs.stop", async () => {
  const { root, calls, restore } = await page();
  try {
    await press(find(root, "row-run-run_1"));
    assert.ok(!find(root, "run-retry-run_1"));
    await press(find(root, "run-stop-run_1"));
    assert.deepEqual(calls.map((c) => c.cap), ["runs.stop"]);
    assert.deepEqual(calls[0]!.input, { runId: "run_1" });
  } finally { restore(); }
});
