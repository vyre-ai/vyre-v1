// The Studio views draw what the server returned and nothing else. A static render has no clicks, so the controls are proved by the menu entries they build
// and the calls they make. Menus are quiet header menus: a check beside each chosen value and its count in the right column. No pill rows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import { AnalyticsReport, Bars, busyMenu, RANGES } from "./AnalyticsView.tsx";
import { TemplateList, startFromTemplate, templateMenu } from "./TemplateGallery.tsx";
import { choiceMenu, filterLabel, filterMenu } from "./menus.ts";
import {
  analyticsOf,
  countBy,
  durationWords,
  rateWords,
  templatesOf,
} from "./read.ts";
import { runLines, shownRuns } from "./StudioViews.tsx";
import { CohortView } from "../versions/CohortMigration.tsx";

const items = (m: readonly MenuEntry[]): MenuItem[] => m.filter((e): e is MenuItem => "label" in e);
const pick = (m: readonly MenuEntry[], label: string): MenuItem =>
  items(m).find((e) => e.label === label) ?? assert.fail(`no menu item ${label}`);
const text = (html: string): string => html.replaceAll("<!-- -->", "");

// ---- the shapes the server returns ----

const day = (n: number): string => `2026-10-${String(n).padStart(2, "0")}`;
const report = analyticsOf({
  windowDays: 3,
  totals: { runs: 4, succeeded: 3, failed: 1, stopped: 0, active: 0, costMicros: 0, successRate: 0.75, medianMs: 4200 },
  daily: [
    { day: day(1), succeeded: 1, failed: 0, other: 0 },
    { day: day(2), succeeded: 2, failed: 1, other: 0 },
    { day: day(3), succeeded: 0, failed: 0, other: 0 },
  ],
  automations: [
    { automationId: "aut_a1", name: "Welcome", runs: 3, succeeded: 2, failed: 1, lastRunAt: 5 },
    { automationId: "aut_b2", name: "Digest", runs: 1, succeeded: 1, failed: 0, lastRunAt: 4 },
  ],
  failures: [{ automationId: "aut_a1", step: "note", code: "provider.network", count: 1 }],
})!;

test("analytics: a reply that is not a report is rejected, and numbers read plainly", () => {
  assert.equal(analyticsOf(null), null);
  assert.equal(analyticsOf({ totals: {} }), null);
  assert.equal(rateWords(0.75), "75%");
  assert.equal(rateWords(null), "None yet");
  assert.deepEqual(
    [durationWords(850), durationWords(4200), durationWords(125_000), durationWords(null)],
    ["850 ms", "4.2 s", "2 min", "None yet"],
  );
});

test("analytics: the Space report shows the totals, the days, the busiest automations and where failures stop", () => {
  const html = text(
    renderToStaticMarkup(
      <AnalyticsReport
        report={report}
        scope="space"
        onOpen={() => undefined}
        onFailed={() => undefined}
        onAsk={() => undefined}
      />,
    ),
  );
  for (const [label, value] of [
    ["Runs", "4"],
    ["Succeeded", "3"],
    ["Failed", "1"],
    ["Success rate", "75%"],
    ["Typical time", "4.2 s"],
  ] as const) {
    assert.ok(html.includes(`aria-label="${label}: ${value}"`), `${label} shows ${value}`);
  }
  assert.ok(
    html.includes("Busiest automations") &&
      html.includes("Welcome") &&
      html.includes("3 runs") &&
      html.includes("1 failed"),
  );
  // owner, 13 Nov 2026: a person reads what went wrong, never the code
  assert.ok(html.includes("Step note in Welcome") && html.includes("We could not reach the service."));
  assert.equal(html.includes("provider.network"), false, "the code is not shown");
  assert.equal([...html.matchAll(/data-testid="bar-2026-10-0\d"/g)].length, 3, "one bar per day");
  assert.ok(!html.includes("Northwind"));
});

test("analytics: one automation's report leaves out the busiest list, and a quiet period says nothing failed", () => {
  const quiet = analyticsOf({
    ...JSON.parse(JSON.stringify(report)),
    failures: [],
    totals: { ...report.totals, failed: 0 },
  })!;
  const html = text(
    renderToStaticMarkup(
      <AnalyticsReport
        report={quiet}
        scope="automation"
        onOpen={() => undefined}
        onFailed={() => undefined}
        onAsk={() => undefined}
      />,
    ),
  );
  assert.ok(!html.includes("Busiest automations"));
  assert.ok(html.includes("No run failed in this period."));
  assert.ok(renderToStaticMarkup(<Bars daily={report.daily} />).includes('role="img"'));
});

test("analytics: the range menu checks the chosen range and a row menu acts on that automation", () => {
  const picked: number[] = [];
  const range = choiceMenu(RANGES, 30, (n) => picked.push(n));
  assert.deepEqual(
    items(range).map((e) => [e.label, e.checked === true]),
    [
      ["Last 7 days", false],
      ["Last 30 days", true],
      ["Last 90 days", false],
    ],
  );
  pick(range, "Last 90 days").onSelect?.();
  assert.deepEqual(picked, [90]);
  const calls: string[] = [];
  const menu = busyMenu("aut_a1", "Welcome", 1, {
    onOpen: (id) => calls.push(`open ${id}`),
    onFailed: () => calls.push("failed"),
    onAsk: (id, m) => calls.push(`ask ${id} ${m}`),
  });
  for (const e of items(menu)) e.onSelect?.();
  assert.deepEqual(calls, ["open aut_a1", "failed", "ask aut_a1 Why do runs of Welcome fail?"]);
  assert.deepEqual(
    items(
      busyMenu("aut_b2", "Digest", 0, { onOpen: () => undefined, onFailed: () => undefined, onAsk: () => undefined }),
    ).map((e) => e.label),
    ["Open", "Ask Vyre about this"],
  );
});

// ---- dependencies ----


// ---- events ----


// ---- all runs ----

test("all runs: the search and the status filter combine", () => {
  const rows = runLines({
    runs: [
      { id: "run_1", status: "failed", name: "Welcome", startedAt: 1, subject: { type: "automation", id: "aut_a1" } },
      { id: "run_2", status: "succeeded", name: "Digest", startedAt: 2 },
      { id: "run_3", status: "failed", name: "Digest", startedAt: 3 },
    ],
  })!;
  assert.deepEqual(
    shownRuns(rows, "digest", new Set()).map((r) => r.id),
    ["run_2", "run_3"],
  );
  assert.deepEqual(
    shownRuns(rows, "digest", new Set(["failed"])).map((r) => r.id),
    ["run_3"],
  );
  assert.deepEqual(
    shownRuns(rows, "", new Set(["failed"])).map((r) => r.id),
    ["run_1", "run_3"],
  );
  assert.equal(runLines({ runs: "no" }), null);
});

// ---- templates ----

const templates = templatesOf({
  templates: [
    {
      key: "weekly_digest",
      title: "Weekly digest",
      summary: "Count what came in.",
      starts: "Every Monday at 9:00",
      setUp: ["Choose the mailbox"],
      steps: [
        { id: "recent", key: "records.find", title: "Find recent records" },
        { id: "send", key: "send_email", title: "Send the digest" },
      ],
    },
  ],
})!;

test("templates: a row says what starts it, lists its steps when opened and what to set up first", () => {
  assert.equal(templatesOf({ templates: 1 }), null);
  const closed = text(
    renderToStaticMarkup(
      <TemplateList
        templates={templates}
        open={null}
        busy={false}
        onToggle={() => undefined}
        onUse={() => undefined}
      />,
    ),
  );
  assert.ok(
    closed.includes("Weekly digest") &&
      closed.includes("Every Monday at 9:00") &&
      closed.includes("Count what came in.") &&
      closed.includes("Use template"),
    "every row carries a visible Use template",
  );
  const open = text(
    renderToStaticMarkup(
      <TemplateList
        templates={templates}
        open="weekly_digest"
        busy={false}
        onToggle={() => undefined}
        onUse={() => undefined}
      />,
    ),
  );
  assert.ok(
    open.includes("1. Find recent records") &&
      open.includes("2. Send the digest") &&
      open.includes("Choose the mailbox") &&
      open.includes("Use template"),
  );
  const log: string[] = [];
  const menu = templateMenu(true, { toggle: () => log.push("toggle"), use: () => log.push("use") });
  assert.deepEqual(
    items(menu).map((e) => e.label),
    ["Use template", "Hide the steps"],
  );
  for (const e of items(menu)) e.onSelect?.();
  assert.deepEqual(log, ["use", "toggle"]);
});

test("templates: Use template makes the draft and opens it", async () => {
  const log: string[] = [];
  const data = {
    call: async (cap: string, input: unknown) => {
      log.push(`${cap} ${JSON.stringify(input)}`);
      return { automation: { id: "aut_new1" } };
    },
    nav: { openAutomation: (id: string) => log.push(`open ${id}`) },
  };
  assert.equal(await startFromTemplate(data as never, "weekly_digest"), "aut_new1");
  assert.deepEqual(log, ['automations.templates.use {"templateKey":"weekly_digest"}', "open aut_new1"]);
});

// ---- packages ----


// ---- the rules for every Studio screen ----

test("no Studio view draws a row of chips for a filter, and none says a feature is not available yet", () => {
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /SubTabs|borderRadius: 999|pill/i, `${f} must not draw pill filters`);
    assert.doesNotMatch(src, /not available yet|coming soon/i, `${f} must not hide a feature`);
  }
});
