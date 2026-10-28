// Packet section 17. Screens render with react-dom/server over react-native-web (ruling 28).
// Each control is drawn inside light Paper, dark Graphite, desktop 1280, and compact 390.
// A static render does not press buttons and does not open a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text, View } from "react-native";
import { tokensOf } from "../../../../../ui/src/tokens/skins.ts";
import { asFixture } from "./builder/fields.ts";
import { DataShelf, MappingFix, advancedInputEdit, basicFieldEdit } from "./builder/marks.tsx";
import { StepTest } from "./builder/StepTest.tsx";
import { AutomationCanvas } from "./canvas/AutomationCanvas.tsx";
import { StepCard } from "./canvas/Cards.tsx";
import type { CardHandlers } from "./canvas/Cards.tsx";
import { AutomationsDataProvider } from "./canvas/data.tsx";
import { frameFor } from "./canvas/frame.ts";
import type { StudioLayout } from "./canvas/frame.ts";
import { Inspector } from "./canvas/Inspector.tsx";
import { check, layout, liveBlockerStep, neighbour } from "./canvas/model.ts";
import type { CardNode, Definition } from "./canvas/model.ts";
import { RunLineage } from "./runs/RunLineage.tsx";
import { RunLines } from "./runs/RunLines.tsx";
import type { Run, RunLine } from "./runs/model.ts";
import { lineageLines } from "./runs/lineage.ts";
import { createSampleAutomations, northwind, LEAD_FOLLOW_UP } from "./sidebar/sample.ts";
import { CohortGroups } from "./versions/CohortMigration.tsx";
import { cohortGroupLabel, previewGroups } from "./versions/cohorts.ts";

const nodeRequire = createRequire(import.meta.url);
const htmlOf = (node: ReactNode): string => renderToStaticMarkup(node).replaceAll("<!-- -->", "");
/** The atomic class react-native-web emits for this style, plus the rule that class inserts. */
function atomicCss(style: Record<string, number>): { className: string; css: string } {
  const preprocess = nodeRequire("react-native-web/dist/cjs/exports/StyleSheet/preprocess.js") as { preprocess(style: unknown): unknown };
  const compiler = nodeRequire("react-native-web/dist/cjs/exports/StyleSheet/compiler/index.js") as {
    atomic(style: unknown): [{ [key: string]: string }, [string[], number][]];
  };
  const [compiled, rules] = compiler.atomic(preprocess.preprocess(style));
  const className = compiled["minHeight"];
  if (!className) throw new Error("minHeight class missing");
  return { className, css: rules.map((rule) => rule[0].join("")).join("") };
}
const compactRow = atomicCss({ minHeight: 26 });
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
/** react-native-web prints a hex token as rgba. Either form counts. */
const cssColor = (hex: string): RegExp => {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return new RegExp(`(?:${hex}|rgba\\(${r},\\s*${g},\\s*${b},\\s*1(?:\\.0+)?\\))`, "i");
};

const shared = { limit: 12, flag: true, note: "", gone: null };
const phone = { kind: "ref" as const, nodeId: "missing", path: "phone", valueType: "string" as const };
const stepInput = { type: "contact", ...shared, phone };
const def = {
  triggers: [{ key: "manual" }],
  nodes: [
    { id: "lookup", key: "transform", title: "Look up", input: {} },
    { id: "map", key: "records.find", title: "Find", input: stepInput },
  ],
} as unknown as Definition;
const mapNode = def.nodes[1]!;
const samples = {
  trigger: asFixture(4, "manual", { email: "ada@example.com" }),
  lookup: asFixture(4, "transform", { id: "rec_1" }),
};
const focusCard: CardNode = {
  id: "focus-step", type: "step", x: 0, y: 0, w: 260, h: 52, title: "Find the person", sub: "type contact", issues: [],
};
const quietCard: CardNode = { ...focusCard, id: "quiet-step", title: "Quiet step" };
const handlers: CardHandlers = {
  onSelect: () => undefined,
  onOpen: () => undefined,
  onMenu: () => undefined,
  onAdd: () => undefined,
  onKey: () => undefined,
};
const run = { id: "run_row", kind: "automation", owner: "usr_a", startedBy: "usr_a", status: "succeeded", costMicros: 0, startedAt: 1_700_000_000_000, traceId: "tr_row" } as Run;
const row: RunLine = { kind: "row", id: "found", text: "Found the person", icon: "search", tone: "ok", offset: 2 };
const lineActions = { retryStep: () => undefined, skipStep: () => undefined, editStep: () => undefined, stopRun: () => undefined, copyTrace: () => undefined, replayMenu: () => undefined, decide: () => undefined };
const groups = [
  { disposition: "safe" as const, definitionVersion: 12, runIds: ["run_safe"], reason: "The steps still match" },
  { disposition: "ambiguous" as const, definitionVersion: 12, runIds: ["run_amb"], reason: "Two steps could match" },
];

test("Basic and Advanced write one typed value, and the other section 17 models stay narrow", () => {
  const fromBasic = basicFieldEdit(shared, "limit", "13");
  assert.equal(fromBasic.limit, 13);
  assert.equal(typeof fromBasic.limit, "number");
  assert.equal(fromBasic.flag, true);
  assert.equal(fromBasic.note, "");
  assert.equal(fromBasic.gone, null);
  assert.equal(basicFieldEdit(fromBasic, "flag", "false").flag, false);
  assert.equal(basicFieldEdit(fromBasic, "note", "").note, "");
  assert.equal(basicFieldEdit(fromBasic, "gone", "").gone, null);
  const fromAdvanced = advancedInputEdit(JSON.stringify({ ...shared, limit: 13 }));
  assert.equal(fromAdvanced.ok, true);
  if (fromAdvanced.ok) assert.deepEqual(fromBasic, fromAdvanced.input);
  assert.deepEqual(advancedInputEdit("[]"), { ok: false, message: "That is not valid JSON." });

  const laid = layout({
    triggers: [{ key: "manual" }],
    start: ["a"],
    nodes: [
      { id: "a", key: "transform", title: "A", input: {}, next: ["b"] },
      { id: "b", key: "transform", title: "B", input: {} },
    ],
  } as unknown as Definition);
  assert.deepEqual(laid.order, ["trigger", "a", "b"]);
  assert.equal(neighbour(laid, "trigger", "down"), "a");
  assert.equal(neighbour(laid, "a", "down"), "b");
  assert.equal(neighbour(laid, "b", "up"), "a");
  assert.equal(neighbour(laid, "b", "down"), null);

  assert.equal(liveBlockerStep(check(LEAD_FOLLOW_UP, "space")), "text");
  assert.equal(liveBlockerStep(check({ triggers: [], nodes: [] } as unknown as Definition)), "trigger");
  assert.equal(liveBlockerStep([]), null);

  const parsed = previewGroups({
    cohorts: [
      ...groups,
      { disposition: "inactive", definitionVersion: 13, runIds: ["run_done"], reason: "" },
      { disposition: "other", definitionVersion: 1, runIds: ["nope"] },
    ],
  });
  assert.deepEqual(parsed.map((group) => group.disposition), ["safe", "ambiguous", "inactive"]);
  assert.equal(cohortGroupLabel(13, parsed[0]!), "Safe group, version 12, pinned");
  assert.equal(cohortGroupLabel(13, parsed[1]!), "Ambiguous group, version 12, pinned");
  assert.equal(cohortGroupLabel(13, parsed[2]!), "Finished group, version 13, current definition");

  assert.equal(lineageLines(undefined, [{ attempt: 2 }], []), null);
  const lines = lineageLines("run_parent", [{ attempt: 1 }], [{ runId: "run_child", attempt: 2 }]);
  assert.deepEqual(lines, {
    parent: "Parent run_parent",
    attempt: "Attempt 2",
    children: [{ id: "run_child", text: "Child run_child, attempt 2" }],
  });
  assert.equal(JSON.stringify(lineageLines(undefined, [], []) ?? {}).includes("No parent"), false);
  assert.equal(JSON.stringify(lineageLines(undefined, [], []) ?? {}).includes("No child"), false);

  assert.equal(frameFor("desktop").width, 1280);
  assert.equal(frameFor("compact").width, 390);
  assert.equal(frameFor("compact").inspectorWidth, "100%");
  assert.equal(frameFor("desktop").inspectorWidth, 300);
  const paper = tokensOf("paper", "light");
  const graphite = tokensOf("graphite", "dark");
  assert.ok(paper && graphite);
  assert.notEqual(paper["--win"], graphite["--win"]);
  assert.equal(paper["--win"], "#FFFFFF");
  assert.equal(graphite["--win"], "#161617");
});

test("section 17 controls render in light, dark, desktop, and compact", () => {
  const sample = createSampleAutomations(northwind);
  const themes = [
    { theme: "light", skin: "paper", mode: "light" as const },
    { theme: "dark", skin: "graphite", mode: "dark" as const },
  ];
  const layouts: StudioLayout[] = ["desktop", "compact"];
  const executed: string[] = [];
  for (const theme of themes) {
    for (const layout of layouts) {
      const tokens = tokensOf(theme.skin, theme.mode);
      assert.ok(tokens, theme.skin);
      const frame = frameFor(layout);
      const out = htmlOf(
        <AutomationsDataProvider value={sample.data}>
          <View testID={`frame-${theme.theme}-${layout}`} dataSet={{ theme: theme.theme, layout, skin: theme.skin }} style={{ width: frame.width, backgroundColor: tokens["--win"] }}>
            <Text testID="skin-ink" style={{ color: tokens["--ink"] }}>{`${theme.skin} ${layout}`}</Text>
            <Inspector def={def} node={mapNode} trigger={null} triggerIndex={null} issues={[]} keys={[]} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} testID="inspector-basic" layout={layout} samples={samples} version={9} />
            <Inspector def={def} node={mapNode} trigger={null} triggerIndex={null} issues={[]} keys={[]} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} testID="inspector-advanced" layout={layout} initialAdvanced samples={samples} version={9} />
            <Inspector def={def} node={mapNode} trigger={null} triggerIndex={null} issues={[]} keys={[]} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} testID="inspector-data" layout={layout} section="data" samples={samples} version={9} />
            <MappingFix nodeIds={new Set(["map"])} value={phone} />
            <StepTest stepKey="records.find" nodeId="map" input={stepInput} version={9} readyOutput={{ id: "rec_1" }} onUseOutput={() => undefined} />
            <AutomationCanvas automationId="aut_lead" />
            <RunLineage parentRun="run_parent" steps={[{ attempt: 2 }]} children={[{ runId: "run_child", attempt: 2 }]} testID="lineage-filled" />
            <RunLineage testID="lineage-empty" />
            <CohortGroups currentVersion={13} groups={groups} />
            <StepCard card={focusCard} selected={false} hovered={false} focused handlers={handlers} onHover={() => undefined} />
            <StepCard card={quietCard} selected={false} hovered={false} handlers={handlers} onHover={() => undefined} />
            <RunLines run={run} lines={[row]} name={() => "Ada"} me="me" actions={lineActions} canRetry={false} />
          </View>
        </AutomationsDataProvider>,
      );
      executed.push(`${theme.theme}+${layout}`);
      const frameTag = tag(out, `frame-${theme.theme}-${layout}`);
      assert.match(frameTag, new RegExp(`data-theme="${theme.theme}"`));
      assert.match(frameTag, new RegExp(`data-layout="${layout}"`));
      assert.match(frameTag, new RegExp(`data-skin="${theme.skin}"`));
      assert.match(frameTag, new RegExp(`width:${frame.width}px`));
      assert.match(frameTag, cssColor(tokens["--win"]));
      assert.match(tag(out, "skin-ink"), cssColor(tokens["--ink"]));
      assert.ok(has(out, "var(--ink)"), "controls keep the skin token");

      const basicAt = out.indexOf('data-testid="inspector-basic"');
      const advancedAt = out.indexOf('data-testid="inspector-advanced"');
      const dataAt = out.indexOf('data-testid="inspector-data"');
      assert.ok(basicAt >= 0 && advancedAt > basicAt && dataAt > advancedAt);
      const basic = out.slice(basicAt, advancedAt);
      const advanced = out.slice(advancedAt, dataAt);
      assert.match(basic, />Advanced</);
      assert.match(advanced, />Basic</);
      assert.match(tag(out, "field-limit"), /value="12"/);
      assert.match(tag(out, "field-flag"), /value="true"/);
      const json = tag(out, "field-input-json");
      assert.match(json, /limit&quot;: 12|limit": 12/);
      assert.match(json, /flag&quot;: true|flag": true/);
      assert.doesNotMatch(json, /limit&quot;: &quot;12&quot;|limit": "12"/);
      assert.doesNotMatch(json, /flag&quot;: &quot;true&quot;|flag": "true"/);
      const pane = tag(out, "inspector-basic");
      if (layout === "desktop") assert.match(pane, /width:300px/);
      else assert.match(pane, /width:100%/);

      assert.ok(has(out, "Trigger version 4"));
      assert.ok(has(out, "Look up, version 4"));
      assert.doesNotMatch(out, /stale/i);
      assert.ok(has(out, "Fix this mapping. node missing is not in this Automation."));
      assert.ok(has(out, "Use output from test"));
      assert.match(tag(out, "problem-go"), /aria-label="Go to text\. This step blocks going live\."/);
      assert.ok(has(out, "Parent run_parent"));
      assert.ok(has(out, "Child run_child, attempt 2"));
      assert.ok(has(out, "Attempt 2"));
      assert.equal(has(out, 'data-testid="lineage-empty"'), false);
      assert.ok(has(out, "Safe group, version 12, pinned"));
      assert.ok(has(out, "Ambiguous group, version 12, pinned"));
      assert.ok(has(out, "run_safe") && has(out, "run_amb"));
      assert.match(tag(out, "card-focus-step"), /tabindex="0"/);
      assert.match(tag(out, "card-focus-step"), /data-card="focus-step"/);
      assert.ok(has(out, 'data-testid="more-focus-step"'));
      assert.equal(has(out, 'data-testid="more-quiet-step"'), false);
      assert.match(compactRow.css, /\.r-minHeight-[^{]+\{min-height:26px;\}/);
      assert.match(tag(out, "line-found"), new RegExp(compactRow.className));
      assert.ok(has(out, "Found the person"));
      assert.ok(has(out, "Preview"), "AI stays Preview");
      assert.equal(has(out, String.fromCharCode(0x2014)), false);
    }
  }
  assert.deepEqual(executed, ["light+desktop", "light+compact", "dark+desktop", "dark+compact"]);
});

test("the data shelf names the fixture version and does not invent a stale warning", () => {
  const shelf = htmlOf(
    <DataShelf
      triggerSample={asFixture(4, "manual", { email: "ada@example.com" })}
      steps={[{ id: "lookup", title: "Look up", output: asFixture(4, "transform", { id: "rec_1" }) }]}
    />,
  );
  assert.match(shelf, /Trigger version 4/);
  assert.match(shelf, /Look up, version 4/);
  assert.doesNotMatch(shelf, /stale/i);
  assert.match(shelf, /data-testid="data-shelf"/);
});
