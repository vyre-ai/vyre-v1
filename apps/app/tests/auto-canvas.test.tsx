// Screen test for the Automations sidebar and canvas (spec 3.7, 2.12).
// Builds a three-path automation and checks validation errors inline,
// the lane a run lights, History via ui/HistoryTab, and both Space skins.

import test from "node:test";
import assert from "node:assert/strict";
import {
  addNode,
  addPaths,
  addTrigger,
  createEditor,
  renderAutomationsPlace,
  renderCanvas,
  setPathWhen,
  validateDefinition,
  withCanvasTab,
  withRun,
} from "../src/places/automations/canvas/index.ts";
import type { Editor, PathBuild } from "../src/places/automations/canvas/index.ts";
import {
  createGroup,
  emptySidebar,
  renderSidebar,
  sampleSidebar,
  withGroup,
  withTab,
} from "../src/places/automations/sidebar/index.ts";
import { nativeTokens, skinById } from "../../../ui/src/tokens/skins.ts";

const PATHS: readonly PathBuild[] = [
  { name: "Won", when: "trigger.op == 'updated'", to: { id: "step_won", key: "stop", title: "Stop won", input: { outcome: "succeeded" } } },
  { name: "Lost", when: "", to: { id: "step_lost", key: "stop", title: "Stop lost", input: { outcome: "failed" } } },
  { name: "Open", when: "trigger.op == 'created'", to: { id: "step_open", key: "wait", title: "Wait", input: {} } },
];

function threePath(): Editor {
  let editor = createEditor({ name: "Stage change", automationId: "aut_stage" });
  editor = addTrigger(editor, "record_change");
  editor = addPaths(editor, PATHS);
  return editor;
}

function branchInner(html: string, name: string): string {
  const token = `data-branch="${name}"`;
  const start = html.indexOf(token);
  assert.ok(start >= 0, name);
  const open = html.lastIndexOf("<div", start);
  const next = html.indexOf('<div data-branch="', start + token.length);
  return html.slice(open, next === -1 ? html.length : next);
}

test("build a three-path automation and show validation errors inline", () => {
  const draft = threePath();
  const checked = validateDefinition(draft.definition, "personal");
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.issues.map((issue) => issue.message), ["Path Lost needs a condition"]);
  const html = renderCanvas(draft, { width: 1280 });
  assert.equal(html.includes('data-screen-id="automations.canvas"'), true);
  assert.equal(html.includes('data-ok="false"'), true);
  assert.equal(html.includes('data-branches="3"'), true);
  assert.equal(html.includes('data-add="paths"'), true);
  assert.equal(html.includes('data-add="parallel"'), true);
  assert.equal(html.includes('data-add="wait"'), true);
  assert.equal(html.includes('data-add="loop"'), true);
  assert.equal(html.includes('data-add="approval"'), true);
  assert.equal(html.includes('data-add="stop"'), true);
  assert.equal(html.includes('data-trigger="record_change"'), true);
  assert.equal(html.includes('data-timeout="30d"'), true);
  const lost = branchInner(html, "Lost");
  assert.equal(lost.includes('data-issue="Path Lost needs a condition"'), true);
  assert.equal(lost.includes('role="alert"'), true);
  assert.equal(lost.includes('data-node="step_lost"'), true);
  assert.equal(lost.includes('data-node="step_won"'), false);
  assert.equal(branchInner(html, "Won").includes("data-issue="), false);
  assert.equal(branchInner(html, "Open").includes("data-issue="), false);

  const fixed = setPathWhen(draft, "paths_1", "Lost", "trigger.op == 'deleted'");
  const again = validateDefinition(fixed.definition, "personal");
  assert.equal(again.ok, true);
  assert.deepEqual(again.issues, []);
  const clean = renderCanvas(fixed, { width: 1280 });
  assert.equal(clean.includes('data-ok="true"'), true);
  assert.equal(clean.includes("Path Lost needs a condition"), false);
  assert.equal(clean.includes("data-when=\"trigger.op == 'deleted'\""), true);
});

test("a run lights the lane taken and dims the other paths", () => {
  const fixed = setPathWhen(threePath(), "paths_1", "Lost", "trigger.op == 'deleted'");
  const running = withRun(fixed, {
    runId: "run_1",
    steps: [
      { stepId: "paths_1", state: "succeeded", taken: "Won" },
      { stepId: "step_won", state: "succeeded" },
    ],
  });
  const html = renderCanvas(running, { width: 1280 });
  assert.match(html, /data-node="paths_1"[^>]*data-lane="lit"/);
  assert.match(html, /data-node="step_won"[^>]*data-lane="lit"/);
  assert.match(html, /data-node="step_lost"[^>]*data-lane="dim"/);
  assert.match(html, /data-node="step_open"[^>]*data-lane="dim"/);
  assert.match(html, /data-branch="Won"[^>]*data-branch-lane="lit"/);
  assert.match(html, /data-branch="Lost"[^>]*data-branch-lane="dim"/);
  assert.match(html, /data-branch="Open"[^>]*data-branch-lane="dim"/);
  assert.match(html, /data-run-state="succeeded"/);
});

test("History tab uses ui/HistoryTab for the automation", () => {
  const wide = renderCanvas(withCanvasTab(threePath(), "history"), { width: 1280 });
  assert.match(wide, /data-tab="history" aria-selected="true"/);
  assert.match(wide, /HistoryTab regular: automation, 2 versions/);
  assert.equal(wide.includes('data-branch="Won"'), false);
  const narrow = renderCanvas(withCanvasTab(threePath(), "history"), { width: 390 });
  assert.match(narrow, /HistoryTab compact: automation, 2 versions/);
  assert.equal(narrow.includes('data-density="compact"'), true);
});

test("personal webhook, parallel, loop, approval and a bad cycle fail inline", () => {
  const hook = addTrigger(createEditor(), "webhook");
  const hookCheck = validateDefinition(hook.definition, "personal");
  assert.equal(hookCheck.ok, false);
  assert.equal(hookCheck.issues.some((issue) => issue.message === "Webhook needs a Team Space"), true);
  const hookHtml = renderCanvas(hook, { width: 1280 });
  assert.match(hookHtml, /data-trigger="webhook"[^>]*data-issue="Webhook needs a Team Space"/);
  const space = validateDefinition(hook.definition, "space");
  assert.equal(space.issues.some((issue) => issue.message === "Webhook needs a Team Space"), false);

  let parallel = addTrigger(createEditor(), "manual");
  parallel = addNode(parallel, {
    id: "par_1",
    key: "parallel",
    title: "Parallel",
    input: { branches: ["only"] },
    branches: [{ label: "Only", to: "missing" }],
  });
  const parallelHtml = renderCanvas(parallel, { width: 1280 });
  const nodeAt = parallelHtml.indexOf('data-node="par_1"');
  const messageAt = parallelHtml.indexOf("Parallel needs two branches");
  assert.ok(nodeAt >= 0 && messageAt > nodeAt);

  let loop = addTrigger(createEditor(), "manual");
  loop = addNode(loop, { id: "loop_1", key: "loop", title: "Loop", input: {} });
  assert.equal(validateDefinition(loop.definition, "personal").issues.some((issue) => issue.message === "Loop needs a list"), true);

  let approval = addTrigger(createEditor(), "manual");
  approval = addNode(approval, { id: "apr_1", key: "approval", title: "Approval", input: {} });
  const approvalMessages = validateDefinition(approval.definition, "personal").issues.map((issue) => issue.message);
  assert.equal(approvalMessages.includes("Approval needs a title"), true);
  assert.equal(approvalMessages.includes("Approval needs an approver"), true);

  let cycle = addTrigger(createEditor(), "manual");
  cycle = addNode(cycle, { id: "a", key: "stop", title: "Stop", input: { outcome: "succeeded" }, next: ["a"] });
  assert.equal(validateDefinition(cycle.definition, "personal").issues.some((issue) => issue.message === "This path loops. Use a Loop step."), true);

  let allowed = addTrigger(createEditor(), "manual");
  allowed = addNode(allowed, { id: "walk", key: "loop", title: "Loop", input: { items: "trigger.rows" }, next: ["walk"] });
  assert.equal(validateDefinition(allowed.definition, "personal").ok, true);
});

test("sidebar shows Groups and the Automations and Journeys tabs", () => {
  const empty = renderSidebar(emptySidebar());
  assert.equal(empty.includes('data-screen-id="automations.sidebar"'), true);
  assert.equal(empty.includes("No automations yet"), true);
  assert.equal(empty.includes("New automation"), true);
  assert.equal(empty.includes('data-tab="automations" aria-selected="true"'), true);
  assert.equal(empty.includes('data-tab="journeys"'), true);

  const sample = renderSidebar(sampleSidebar());
  assert.equal(sample.includes('data-placeholder="ListSections"'), true);
  assert.equal(sample.includes('data-type="automations"'), true);
  assert.equal(sample.includes('data-section="Personal"'), true);
  assert.equal(sample.includes('data-section="Shared with me"'), true);
  assert.equal(sample.includes('data-section="Space"'), true);
  assert.equal(sample.includes("Stage change"), true);
  assert.equal(sample.includes('data-id="agr_intake"'), true);
  assert.equal(sample.includes("Groups"), true);

  const billing = renderSidebar(withGroup(sampleSidebar(), "agr_billing"));
  assert.equal(billing.includes("Nightly billing"), true);
  assert.equal(billing.includes("Stage change"), false);
  assert.equal(billing.includes('data-section="Personal"'), true);

  const journeys = renderSidebar(withTab(sampleSidebar(), "journeys"));
  assert.equal(journeys.includes('data-tab="journeys" aria-selected="true"'), true);
  assert.equal(journeys.includes("Client onboarding"), true);
  assert.equal(journeys.includes('data-placeholder="ListSections"'), false);

  const created = renderSidebar(createGroup(emptySidebar(), "Care"));
  assert.equal(created.includes('data-id="agr_1"'), true);
  assert.equal(created.includes("Care"), true);
  assert.match(created, /data-selected="true"[^>]*data-id="agr_1"/);
});

test("canvas frames use Northwind Paper and Harbor Studio Linen at 1280 and 390", () => {
  const editor = setPathWhen(threePath(), "paths_1", "Lost", "trigger.op == 'deleted'");
  const sidebar = sampleSidebar();
  const frames = [
    { space: "Northwind", width: 1280, skinId: "paper", density: "regular" },
    { space: "Northwind", width: 390, skinId: "paper", density: "compact" },
    { space: "Harbor Studio", width: 1280, skinId: "linen", density: "regular" },
    { space: "Harbor Studio", width: 390, skinId: "linen", density: "compact" },
  ] as const;
  for (const frame of frames) {
    const html = renderAutomationsPlace({ space: frame.space, width: frame.width, editor, sidebar });
    const skin = skinById(frame.skinId);
    assert.ok(skin);
    assert.equal(html.includes(`data-space="${frame.space}"`), true);
    assert.equal(html.includes(`data-skin="${frame.skinId}"`), true);
    assert.equal(html.includes(`data-width="${frame.width}"`), true);
    assert.equal(html.includes(`data-density="${frame.density}"`), true);
    assert.equal(html.includes('data-layout-shift="0"'), true);
    assert.equal(html.includes('data-screen-id="automations.sidebar"'), true);
    assert.equal(html.includes('data-screen-id="automations.canvas"'), true);
    assert.equal(html.includes(nativeTokens(skin)["--accent"]), true);
    assert.equal(html.includes('data-branch="Won"'), true);
    assert.equal(html.includes('data-branch="Lost"'), true);
    assert.equal(html.includes('data-branch="Open"'), true);
  }
  const north = renderAutomationsPlace({ space: "Northwind", width: 1280, editor, sidebar });
  const harbor = renderAutomationsPlace({ space: "Harbor Studio", width: 1280, editor, sidebar });
  const paper = skinById("paper");
  const linen = skinById("linen");
  assert.ok(paper && linen);
  assert.equal(north.includes(nativeTokens(paper)["--accent"]), true);
  assert.equal(north.includes(`--accent:${nativeTokens(linen)["--accent"]}`), false);
  assert.equal(harbor.includes(nativeTokens(linen)["--accent"]), true);
});
