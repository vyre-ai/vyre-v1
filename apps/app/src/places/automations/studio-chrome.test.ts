// Prototype chrome, proved from the modules the screens import. Node 24 cannot load .tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterShelf, shelfRows } from "./builder/fields.ts";
import { asFixture } from "./builder/fields.ts";
import { layoutForWidth, COMPACT_WIDTH, DESKTOP_WIDTH } from "./canvas/frame.ts";
import { groupOfKey, layout, stepStatusChip, subtitleOf } from "./canvas/model.ts";
import type { Definition } from "./canvas/model.ts";
import {
  ABSENCE,
  ALL_RUNS_SEARCH,
  BUILDER_MODES,
  DATA_SHELF_NAME,
  DRAFT_HAS_EDITS,
  INSPECTOR_TABS,
  LOOP_CHILD,
  PARALLEL_JOIN,
  VAL_LABEL,
  accountFixedLine,
  definitionCrumb,
  enrollmentsPinned,
  needsBadge,
  parallelLaneMark,
} from "./chrome.ts";
import { attemptLine, childRunLine, containerForChildren, lineageLines } from "./runs/lineage.ts";
import { definitionLabel } from "./versions/cohorts.ts";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

test("the list is one list: its head returns to the first page and carries the count of what needs him; no studio menu under it", () => {
  const slot = source("./sidebar/AutomationsSidebarSlot.tsx");
  assert.match(slot, /Search automations/);
  assert.match(slot, /ListHead/);
  assert.doesNotMatch(slot, /STUDIO_NAV|StudioNav/);
  assert.equal(needsBadge(undefined), null);
  assert.equal(needsBadge(0), null);
  assert.equal(needsBadge(1.5), null);
  assert.equal(needsBadge(2), "2");
  assert.doesNotMatch(slot, /Folders/);
});

test("the inspector tabs are the prototype labels, and the builder page has no Basic and Advanced", () => {
  assert.deepEqual([...INSPECTOR_TABS], ["Configure", "Data", "Test"]);
  assert.equal(DATA_SHELF_NAME, "Data");
  assert.equal(VAL_LABEL, "Advanced · VAL representation");
  const page = source("./screens/BuilderPage.tsx");
  const inspector = source("./canvas/Inspector.tsx");
  const marks = source("./builder/marks.tsx");
  assert.doesNotMatch(page, /BUILDER_MODES|mode-basic|mode-advanced/);
  assert.match(inspector, /onMode/);
  assert.match(marks, /INSPECTOR_TABS/);
  assert.match(marks, /DATA_SHELF_NAME/);
  assert.doesNotMatch(page, />Publish</);
  assert.doesNotMatch(page, /3 edits/);
});

test("a parallel card marks each lane as a child Run and joins them", () => {
  assert.equal(parallelLaneMark("Lane A"), "Lane A · child Run");
  assert.equal(parallelLaneMark("  "), "Lane · child Run");
  assert.equal(PARALLEL_JOIN, "Join after child Runs complete");
  const def: Definition = {
    triggers: [{ key: "manual" }],
    start: ["p"],
    nodes: [
      {
        id: "p",
        key: "parallel",
        input: {},
        branches: [
          { label: "Lane A", to: "a" },
          { label: "Lane B", to: "b" },
        ],
      },
      { id: "a", key: "send_email", input: { to: "a@b.c" }, next: ["z"] },
      { id: "b", key: "send_sms", input: { to: "+1" }, next: ["z"] },
      { id: "z", key: "stop", input: {} },
    ],
  };
  const drawn = layout(def);
  const lanes = drawn.chips.filter((chip) => chip.kind === "lane").map((chip) => chip.text);
  assert.deepEqual(lanes, ["Lane A · child Run", "Lane B · child Run"]);
  assert.ok(drawn.chips.some((chip) => chip.kind === "join" && chip.text === PARALLEL_JOIN));
});

test("a loop says each iteration is a child Run", () => {
  const line = subtitleOf({ id: "f", key: "loop", input: { items: "people" } }, {});
  assert.match(line, /For each item in people/);
  assert.match(line, new RegExp(LOOP_CHILD));
  assert.equal(groupOfKey("loop"), "Flow");
  assert.equal(groupOfKey("send_email"), "Send");
});

test("the header omits a live version and an edit count it does not have", () => {
  assert.equal(definitionLabel({ version: 5, status: "paused" }), "v5");
  assert.equal(definitionLabel({ version: 12, status: "on" }), "Live v12");
  assert.equal(
    definitionLabel({ version: 12, status: "on", liveVersion: 12, draftVersion: 13 }),
    `Live v12 · ${DRAFT_HAS_EDITS}`,
  );
  assert.equal(definitionLabel({ version: 5, status: "paused" }, true), `v5 · ${DRAFT_HAS_EDITS}`);
  assert.equal(definitionLabel({ version: 4 }), "v4");
  assert.doesNotMatch(definitionLabel({ version: 12, status: "on" }, true), /3 edits/);
  assert.equal(definitionCrumb({ status: "draft", dirty: false, pinned: false }), "Draft");
  assert.equal(definitionCrumb({ status: "on", pinned: true }), "Live · New enrollments only");
  assert.equal(definitionCrumb({ status: "paused" }), "Current");
  assert.equal(enrollmentsPinned(undefined, false), false);
  assert.equal(enrollmentsPinned([{ status: "succeeded" }], true), false);
  assert.equal(enrollmentsPinned([{ status: "waiting" }], true), true);
});

test("the data shelf keeps real rows and names the three absence states", () => {
  assert.deepEqual([...ABSENCE], ["Missing", "Null", "Empty"]);
  const rows = shelfRows(asFixture(4, "manual", { email: "ada@example.com" }), [
    { id: "lookup", title: "Look up", output: asFixture(4, "transform", { id: "rec_1" }) },
  ]);
  assert.match(rows.map((row) => row.source).join(" "), /Trigger version 4/);
  assert.match(rows.map((row) => row.source).join(" "), /Look up, version 4/);
  assert.equal(filterShelf(rows, "email").length, 1);
  assert.equal(filterShelf(rows, "nobody-here").length, 0);
  assert.equal(shelfRows(undefined, []).length, 0);
  assert.equal(accountFixedLine("Choose an account"), null);
  assert.equal(accountFixedLine("No accounts yet"), null);
  assert.match(accountFixedLine("Inbox (active)") ?? "", /does not switch by itself/);
});

test("a run timeline shows an attempt and a child Run only from real fields", () => {
  assert.equal(
    attemptLine({ step: "send", state: "failed", attempt: 2, branch: "Lane A" }),
    "send · failed · attempt 2 · Lane A",
  );
  assert.equal(childRunLine({ runId: "run_child", attempt: 2 }), "Side run, attempt 2");
  assert.equal(childRunLine({ runId: "run_8", lane: "A" }), "Lane A");
  assert.equal(childRunLine({ runId: "run_9", item: "3" }), "Item 3");
  const lines = lineageLines("run_parent", [{ attempt: 2 }], [{ runId: "run_child", attempt: 2 }]);
  assert.equal(lines?.children[0]?.text, "Side run, attempt 2");
  assert.equal(
    containerForChildren([
      { id: "p", key: "parallel" },
      { id: "s", key: "send_email" },
    ]),
    "p",
  );
  assert.equal(
    containerForChildren([
      { id: "p", key: "parallel" },
      { id: "l", key: "loop" },
    ]),
    null,
  );
  assert.equal(stepStatusChip("a", [], undefined, new Set()), null);
  assert.equal(stepStatusChip("a", [], "waiting", new Set()), "waiting");
  assert.equal(stepStatusChip("a", [{ severity: "error" }], "waiting", new Set(["a"])), "error");
  assert.equal(stepStatusChip("a", [], "done", new Set(["a"])), "tested");
});

test("operations copy stays empty instead of demonstration rows", () => {
  assert.equal(ALL_RUNS_SEARCH, "Search runs");
  const views = source("./operations/StudioViews.tsx");
  assert.doesNotMatch(views, /Northwind/);
  assert.doesNotMatch(views, /Elena/);
  assert.doesNotMatch(views, /working days/);
  assert.equal(layoutForWidth(DESKTOP_WIDTH), "desktop");
  assert.equal(layoutForWidth(COMPACT_WIDTH), "compact");
  assert.equal(layoutForWidth(500), "compact");
  assert.equal(layoutForWidth(0), "desktop");
});
