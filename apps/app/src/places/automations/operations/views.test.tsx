// The Studio views draw what the server returned and nothing else. A static render has no clicks, so the controls are proved by the menu entries they build
// and the calls they make. Menus are quiet header menus: a check beside each chosen value and its count in the right column. No pill rows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import { AnalyticsReport, Bars, busyMenu, RANGES } from "./AnalyticsView.tsx";
import { DependencyList, depMenu, shownItems } from "./DependenciesView.tsx";
import { EventList, eventMenu, payloadText, shownEvents } from "./EventsView.tsx";
import { PackageDetail, exportPackageNow, importInput, importPackageNow, needsLines } from "./PackagesView.tsx";
import { TemplateList, startFromTemplate, templateMenu } from "./TemplateGallery.tsx";
import { choiceMenu, filterLabel, filterMenu } from "./menus.ts";
import { analyticsOf, countBy, depsOf, durationWords, eventItems, packageItems, rateWords, templatesOf } from "./read.ts";
import { runLines, shownRuns } from "./StudioViews.tsx";
import { CohortView } from "../versions/CohortMigration.tsx";

const items = (m: readonly MenuEntry[]): MenuItem[] => m.filter((e): e is MenuItem => "label" in e);
const pick = (m: readonly MenuEntry[], label: string): MenuItem => items(m).find((e) => e.label === label) ?? assert.fail(`no menu item ${label}`);
const text = (html: string): string => html.replaceAll("<!-- -->", "");

// ---- the shapes the server returns ----

const day = (n: number): string => `2026-10-${String(n).padStart(2, "0")}`;
const report = analyticsOf({
  windowDays: 3,
  totals: { runs: 4, succeeded: 3, failed: 1, stopped: 0, active: 0, costMicros: 0, successRate: 0.75, medianMs: 4200 },
  daily: [{ day: day(1), succeeded: 1, failed: 0, other: 0 }, { day: day(2), succeeded: 2, failed: 1, other: 0 }, { day: day(3), succeeded: 0, failed: 0, other: 0 }],
  automations: [{ automationId: "aut_a1", name: "Welcome", runs: 3, succeeded: 2, failed: 1, lastRunAt: 5 }, { automationId: "aut_b2", name: "Digest", runs: 1, succeeded: 1, failed: 0, lastRunAt: 4 }],
  failures: [{ automationId: "aut_a1", step: "note", code: "provider.network", count: 1 }],
})!;

test("analytics: a reply that is not a report is rejected, and numbers read plainly", () => {
  assert.equal(analyticsOf(null), null);
  assert.equal(analyticsOf({ totals: {} }), null);
  assert.equal(rateWords(0.75), "75%");
  assert.equal(rateWords(null), "None yet");
  assert.deepEqual([durationWords(850), durationWords(4200), durationWords(125_000), durationWords(null)], ["850 ms", "4.2 s", "2 min", "None yet"]);
});

test("analytics: the Space report shows the totals, the days, the busiest automations and where failures stop", () => {
  const html = text(renderToStaticMarkup(<AnalyticsReport report={report} scope="space" onOpen={() => undefined} onFailed={() => undefined} onAsk={() => undefined} />));
  for (const [label, value] of [["Runs", "4"], ["Succeeded", "3"], ["Failed", "1"], ["Success rate", "75%"], ["Typical time", "4.2 s"]] as const) {
    assert.ok(html.includes(`aria-label="${label}: ${value}"`), `${label} shows ${value}`);
  }
  assert.ok(html.includes("Busiest automations") && html.includes("Welcome") && html.includes("3 runs") && html.includes("1 failed"));
  assert.ok(html.includes("Step note in Welcome") && html.includes("provider.network"));
  assert.equal([...html.matchAll(/data-testid="bar-2026-10-0\d"/g)].length, 3, "one bar per day");
  assert.ok(!html.includes("Northwind"));
});

test("analytics: one automation's report leaves out the busiest list, and a quiet period says nothing failed", () => {
  const quiet = analyticsOf({ ...JSON.parse(JSON.stringify(report)), failures: [], totals: { ...report.totals, failed: 0 } })!;
  const html = text(renderToStaticMarkup(<AnalyticsReport report={quiet} scope="automation" onOpen={() => undefined} onFailed={() => undefined} onAsk={() => undefined} />));
  assert.ok(!html.includes("Busiest automations"));
  assert.ok(html.includes("No run failed in this period."));
  assert.ok(renderToStaticMarkup(<Bars daily={report.daily} />).includes('role="img"'));
});

test("analytics: the range menu checks the chosen range and a row menu acts on that automation", () => {
  const picked: number[] = [];
  const range = choiceMenu(RANGES, 30, (n) => picked.push(n));
  assert.deepEqual(items(range).map((e) => [e.label, e.checked === true]), [["Last 7 days", false], ["Last 30 days", true], ["Last 90 days", false]]);
  pick(range, "Last 90 days").onSelect?.();
  assert.deepEqual(picked, [90]);
  const calls: string[] = [];
  const menu = busyMenu("aut_a1", "Welcome", 1, { onOpen: (id) => calls.push(`open ${id}`), onFailed: () => calls.push("failed"), onAsk: (id, m) => calls.push(`ask ${id} ${m}`) });
  for (const e of items(menu)) e.onSelect?.();
  assert.deepEqual(calls, ["open aut_a1", "failed", "ask aut_a1 Why do runs of Welcome fail?"]);
  assert.deepEqual(items(busyMenu("aut_b2", "Digest", 0, { onOpen: () => undefined, onFailed: () => undefined, onAsk: () => undefined })).map((e) => e.label), ["Open", "Ask Vyre about this"]);
});

// ---- dependencies ----

const deps = depsOf({
  automations: 3,
  items: [
    { kind: "automation", ref: "aut_old1", problem: "off", usedBy: [{ automationId: "aut_a1", name: "Welcome", status: "on", stepIds: ["sub"] }] },
    { kind: "connection", ref: "con_gone1", problem: "missing", usedBy: [{ automationId: "aut_a1", name: "Welcome", status: "on", stepIds: ["req"] }, { automationId: "aut_b2", name: "Digest", status: "draft", stepIds: [] }] },
    { kind: "mailbox", ref: "mbx_main1", problem: null, usedBy: [{ automationId: "aut_b2", name: "Digest", status: "draft", stepIds: ["mail"] }] },
  ],
})!;

test("dependencies: the filters narrow the list and the menus show counts and checks", () => {
  assert.equal(depsOf({ items: "no" }), null);
  assert.deepEqual(countBy(deps.items, (i) => i.kind), [{ value: "automation", count: 1 }, { value: "connection", count: 1 }, { value: "mailbox", count: 1 }]);
  assert.deepEqual(shownItems(deps.items, new Set(["connection"]), false).map((i) => i.ref), ["con_gone1"]);
  assert.deepEqual(shownItems(deps.items, new Set(), true).map((i) => i.ref), ["aut_old1", "con_gone1"]);
  const chosen = new Set(["mailbox"]);
  const menu = filterMenu("All kinds", countBy(deps.items, (i) => i.kind), chosen, (v) => (chosen.has(v) ? chosen.delete(v) : chosen.add(v)), () => chosen.clear());
  assert.deepEqual(items(menu).map((e) => [e.label, e.checked === true, e.count]), [["All kinds", false, 3], ["automation", false, 1], ["connection", false, 1], ["mailbox", true, 1]]);
  pick(menu, "All kinds").onSelect?.();
  assert.equal(chosen.size, 0);
  assert.equal(filterLabel("Kind", new Set()), "Kind");
  assert.equal(filterLabel("Kind", new Set(["mailbox"])), "Kind: mailbox");
  assert.equal(filterLabel("Kind", new Set(["a", "b"])), "Kind: 2 chosen");
});

test("dependencies: the list shows the ids, the number of uses and what is missing or off", () => {
  const html = text(renderToStaticMarkup(<DependencyList items={deps.items} onOpen={() => undefined} copy={() => undefined} />));
  assert.ok(html.includes("aut_old1") && html.includes("con_gone1") && html.includes("mbx_main1"));
  assert.ok(html.includes("Missing") && html.includes("Off") && html.includes("2 uses") && html.includes("1 use"));
  assert.ok(html.includes("Kind") && html.includes("Everything"));
});

test("dependencies: a row menu opens the automations that use it, copies the id and narrows to its kind", () => {
  const log: string[] = [];
  const menu = depMenu(deps.items[1]!, { show: (r) => log.push(`show ${r}`), open: (id) => log.push(`open ${id}`), copy: (t) => log.push(`copy ${t}`), onlyKind: (k) => log.push(`kind ${k}`) });
  assert.deepEqual(items(menu).map((e) => e.label), ["Show who uses this", "Open Welcome", "Open Digest", "Copy the id", "Only connections"]);
  for (const e of items(menu)) e.onSelect?.();
  assert.deepEqual(log, ["show con_gone1", "open aut_a1", "open aut_b2", "copy con_gone1", "kind connection"]);
  assert.ok(items(depMenu(deps.items[0]!, { show: () => undefined, open: () => undefined, copy: () => undefined, onlyKind: () => undefined })).some((e) => e.label === "Open this automation"), "an automation that exists can be opened");
  assert.ok(!items(depMenu({ ...deps.items[0]!, problem: "missing" }, { show: () => undefined, open: () => undefined, copy: () => undefined, onlyKind: () => undefined })).some((e) => e.label === "Open this automation"), "a missing one cannot");
});

// ---- events ----

const events = eventItems({
  events: [
    { id: "evt_1", type: "record.updated", at: Date.UTC(2026, 9, 30, 9, 0, 5), actor: "usr_a1", runId: "run_1", subject: { type: "automation", id: "aut_a1" }, payload: { status: "warm" } },
    { id: "evt_2", type: "record.updated", at: Date.UTC(2026, 9, 30, 9, 0, 6), actor: "usr_a1", payload: { status: "cold" } },
    { id: "evt_3", type: "dm.sent", at: Date.UTC(2026, 9, 30, 9, 0, 7), actor: "usr_b2", payload: { sealed: true, body: "hidden" } },
  ],
})!;

test("events: the type filter lists each type once with its count, and a sealed event shows no payload", () => {
  assert.equal(eventItems({ events: "no" }), null);
  assert.deepEqual(countBy(events, (e) => e.type), [{ value: "dm.sent", count: 1 }, { value: "record.updated", count: 2 }]);
  assert.deepEqual(shownEvents(events, new Set(["record.updated"])).map((e) => e.id), ["evt_1", "evt_2"]);
  assert.equal(shownEvents(events, new Set()).length, 3);
  assert.match(payloadText(events[2]!), /Sealed/);
  assert.doesNotMatch(payloadText(events[2]!), /hidden/);
  assert.match(payloadText(events[0]!), /"status": "warm"/);
});

test("events: each row shows its type, time and what it touched; the menu opens the run and the automation", () => {
  const html = text(renderToStaticMarkup(<EventList rows={events} onOpenRun={() => undefined} onOpenAutomation={() => undefined} copy={() => undefined} />));
  assert.ok(html.includes("record.updated") && html.includes("09:00:05") && html.includes("automation aut_a1") && html.includes("run run_1") && html.includes("Sealed"));
  assert.ok(html.includes("Event type"));
  const log: string[] = [];
  const menu = eventMenu(events[0]!, { isOpen: false, toggle: () => log.push("toggle"), onlyType: (t) => log.push(`only ${t}`), openRun: (r) => log.push(`run ${r}`), openAutomation: (a) => log.push(`auto ${a}`), copy: (t) => log.push(`copy ${t.slice(0, 2)}`) });
  assert.deepEqual(items(menu).map((e) => e.label), ["Show details", "Only record.updated", "Open the run", "Open the automation", "Copy the event id", "Copy the payload"]);
  for (const e of items(menu)) e.onSelect?.();
  assert.deepEqual(log, ["toggle", "only record.updated", "run run_1", "auto aut_a1", "copy ev", "copy {\n"]);
  assert.ok(!items(eventMenu(events[2]!, { isOpen: true, toggle: () => undefined, onlyType: () => undefined, openRun: () => undefined, openAutomation: () => undefined, copy: () => undefined })).some((e) => e.label === "Copy the payload"), "a sealed payload cannot be copied");
});

// ---- all runs ----

test("all runs: the search and the status filter combine", () => {
  const rows = runLines({ runs: [
    { id: "run_1", status: "failed", name: "Welcome", startedAt: 1, subject: { type: "automation", id: "aut_a1" } },
    { id: "run_2", status: "succeeded", name: "Digest", startedAt: 2 },
    { id: "run_3", status: "failed", name: "Digest", startedAt: 3 },
  ] })!;
  assert.deepEqual(shownRuns(rows, "digest", new Set()).map((r) => r.id), ["run_2", "run_3"]);
  assert.deepEqual(shownRuns(rows, "digest", new Set(["failed"])).map((r) => r.id), ["run_3"]);
  assert.deepEqual(shownRuns(rows, "", new Set(["failed"])).map((r) => r.id), ["run_1", "run_3"]);
  assert.equal(runLines({ runs: "no" }), null);
});

// ---- templates ----

const templates = templatesOf({
  templates: [{ key: "weekly_digest", title: "Weekly digest", summary: "Count what came in.", starts: "Every Monday at 9:00", setUp: ["Choose the mailbox"], steps: [{ id: "recent", key: "records.find", title: "Find recent records" }, { id: "send", key: "send_email", title: "Send the digest" }] }],
})!;

test("templates: a row says what starts it, lists its steps when opened and what to set up first", () => {
  assert.equal(templatesOf({ templates: 1 }), null);
  const closed = text(renderToStaticMarkup(<TemplateList templates={templates} open={null} busy={false} onToggle={() => undefined} onUse={() => undefined} />));
  assert.ok(closed.includes("Weekly digest") && closed.includes("Every Monday at 9:00") && closed.includes("Count what came in.") && !closed.includes("Use template"));
  const open = text(renderToStaticMarkup(<TemplateList templates={templates} open="weekly_digest" busy={false} onToggle={() => undefined} onUse={() => undefined} />));
  assert.ok(open.includes("1. Find recent records") && open.includes("2. Send the digest") && open.includes("Choose the mailbox") && open.includes("Use template"));
  const log: string[] = [];
  const menu = templateMenu(true, { toggle: () => log.push("toggle"), use: () => log.push("use") });
  assert.deepEqual(items(menu).map((e) => e.label), ["Use template", "Hide the steps"]);
  for (const e of items(menu)) e.onSelect?.();
  assert.deepEqual(log, ["use", "toggle"]);
});

test("templates: Use template makes the draft and opens it", async () => {
  const log: string[] = [];
  const data = {
    call: async (cap: string, input: unknown) => { log.push(`${cap} ${JSON.stringify(input)}`); return { automation: { id: "aut_new1" } }; },
    nav: { openAutomation: (id: string) => log.push(`open ${id}`) },
  };
  assert.equal(await startFromTemplate(data as never, "weekly_digest"), "aut_new1");
  assert.deepEqual(log, ['automations.templates.use {"templateKey":"weekly_digest"}', "open aut_new1"]);
});

// ---- packages ----

const pkg = packageItems({
  packages: [{
    id: "pkg_1", name: "Welcome pack", sourceAutomationId: "aut_a1", createdAt: Date.UTC(2026, 9, 30),
    requires: { connections: [{ slot: "con_slot1", label: "Connection 1", stepIds: ["ask"] }], vault: ["#Stripe.account"], keys: ["think"] },
  }],
})![0]!;

test("packages: the detail lists the slots, the Vault names and the keys, and the import sends only the chosen slots", () => {
  assert.equal(packageItems({ packages: null }), null);
  const html = text(renderToStaticMarkup(<PackageDetail pkg={pkg} own={[{ connectionId: "con_mine1", title: "Main Stripe", connector: "stripe" }]} picks={{}} onPick={() => undefined} onImport={() => undefined} busy={false} />));
  assert.ok(html.includes("Connection 1, used by step ask") && html.includes("Choose a connection") && html.includes("#Stripe.account") && html.includes("Import as a draft"));
  const done = text(renderToStaticMarkup(<PackageDetail pkg={pkg} own={[{ connectionId: "con_mine1", title: "Main Stripe", connector: "stripe" }]} picks={{ con_slot1: "con_mine1" }} onPick={() => undefined} onImport={() => undefined} busy={false} />));
  assert.ok(done.includes("Main Stripe"));
  assert.deepEqual(importInput(pkg, {}), { packageId: "pkg_1" });
  assert.deepEqual(importInput(pkg, { con_slot1: "con_mine1", con_slot9: "con_x" }), { packageId: "pkg_1", connections: { con_slot1: "con_mine1" } });
  assert.deepEqual(needsLines({ connections: [{ label: "Connection 2" }], vault: ["#A"], keys: ["think"] }), ["Connection 2: choose one of your connections", "Vault item #A: add it to your Vault", "Step think: choose your own AI key"]);
});

test("packages: export and import make the calls and report what is left", async () => {
  const log: string[] = [];
  const data = {
    call: async (cap: string, input: unknown) => {
      log.push(`${cap} ${JSON.stringify(input)}`);
      return cap.endsWith("import") ? { automation: { id: "aut_copy1", name: "Welcome pack" }, needs: { connections: [{ label: "Connection 1" }], vault: [], keys: [] } } : {};
    },
  };
  assert.match(await exportPackageNow(data as never, { id: "aut_a1", name: "Welcome" }), /no secrets/);
  const note = await importPackageNow(data as never, pkg, {});
  assert.equal(note.open, "aut_copy1");
  assert.deepEqual(note.left, ["Connection 1: choose one of your connections"]);
  assert.deepEqual(log, ['automations.packages.export {"automationId":"aut_a1"}', 'automations.packages.import {"packageId":"pkg_1"}']);
});

// ---- moving runs onto a new version ----

test("versions: Apply is off with no safe group, asks once before it moves, and names what stays put", () => {
  const groups = [
    { disposition: "safe" as const, definitionVersion: 2, runIds: ["run_a1", "run_a2"], reason: "The same step still exists." },
    { disposition: "ambiguous" as const, definitionVersion: 1, runIds: ["run_b1"], reason: "The current step is gone." },
  ];
  const draw = (over: Partial<Parameters<typeof CohortView>[0]>): string => text(renderToStaticMarkup(
    <CohortView currentVersion={3} phase="ready" cohorts={[]} groups={groups} safeCount={2} confirming={false} busy={false} onApply={() => undefined} onCancel={() => undefined} {...over} />));
  const first = draw({});
  assert.ok(first.includes("Safe group, version 2, pinned") && first.includes("Ambiguous group, version 1, pinned") && first.includes("Apply safe groups") && !first.includes("migration-confirm"));
  const asking = draw({ confirming: true });
  assert.ok(asking.includes("Move 2 runs to version 3.") && asking.includes("a step that is running is never moved") && asking.includes("Cancel") && asking.includes(">Apply<"));
  const none = draw({ safeCount: 0, groups: [groups[1]!] });
  assert.ok(none.includes('aria-disabled="true"') && none.includes("No safe group to move"));
  assert.ok(draw({ applyError: "1 run was held back because a step started. Try again when it finishes." }).includes("held back"));
});

// ---- the rules for every Studio screen ----

test("no Studio view draws a row of chips for a filter, and none says a feature is not available yet", () => {
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /SubTabs|borderRadius: 999|pill/i, `${f} must not draw pill filters`);
    assert.doesNotMatch(src, /not available yet|coming soon/i, `${f} must not hide a feature`);
  }
});
