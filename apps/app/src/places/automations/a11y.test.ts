// Accessibility and compact order, proved from the modules the screens import. Node 24 cannot load .tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FOCUS_TOKEN, FOCUS_VISIBLE, cardLabel, focusRingCss, insertLabel, keyNeighbour, mappingLabel, moreLabel, runStateText, tabLabel, triggerLabel,
} from "./a11y.ts";
import { shelfRows } from "./builder/fields.ts";
import { COMPACT_REGIONS, COMPACT_SECTION, canvasScale, compactRegionLabel, frameFor, regionOrder } from "./canvas/frame.ts";
import { stepStatusChip } from "./canvas/model.ts";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

test("compact order is canvas overview, selected step, data, then test", () => {
  assert.deepEqual([...COMPACT_REGIONS], ["Canvas overview", "Selected step", "Data", "Test"]);
  assert.deepEqual(regionOrder("compact"), [...COMPACT_REGIONS]);
  assert.deepEqual(regionOrder("desktop"), []);
  assert.equal(compactRegionLabel("compact"), "Canvas overview, Selected step, Data, Test");
  assert.equal(compactRegionLabel("desktop"), null);
  assert.equal(frameFor("compact").ordered, true);
  assert.equal(frameFor("compact").compact, true);
  assert.equal(frameFor("compact").inspectorWidth, "100%");
  assert.equal(frameFor("desktop").ordered, false);
  assert.equal(frameFor("desktop").compact, false);
  assert.equal(COMPACT_SECTION.configure, "Selected step");
  assert.equal(COMPACT_SECTION.data, "Data");
  assert.equal(COMPACT_SECTION.test, "Test");
  assert.equal(canvasScale(true, 0.3), 1);
  assert.equal(canvasScale(true, 0.84), 1);
  assert.equal(canvasScale(true, 1.4), 1.4);
  assert.equal(canvasScale(false, 0.84), 0.84);
  const frame = source("./canvas/frame.ts");
  let at = -1;
  for (const name of COMPACT_REGIONS) {
    const next = frame.indexOf(`"${name}"`);
    assert.ok(next > at, name);
    at = next;
  }
  const canvas = source("./canvas/AutomationCanvas.tsx");
  const overview = canvas.indexOf('testID="region-canvas"');
  const step = canvas.indexOf('testID="inspector-stack"');
  assert.ok(overview > 0 && step > overview);
  assert.match(canvas, /compactRegionLabel/);
  assert.match(canvas, /COMPACT_REGIONS/);
  assert.match(canvas, /canvasScale\(ordered, zoom\)/);
  assert.match(canvas, /frame\.compact/);
  assert.doesNotMatch(canvas, /Animated\./);
  assert.doesNotMatch(canvas, /@keyframes/);
});

test("labels name the action and the state, not the icon", () => {
  assert.equal(cardLabel({ title: "Find the person", sub: "type contact", issues: 0 }), "Find the person. type contact");
  assert.equal(cardLabel({ title: "Find the person", sub: "type contact", issues: 2 }), "Find the person. type contact. 2 to fix");
  assert.equal(cardLabel({ title: "Send", sub: "to ada", issues: 0, chip: "tested", state: "done" }), "Send. to ada. tested. done");
  assert.equal(cardLabel({ title: "Send", sub: "to ada", issues: 1, chip: "error", state: "failed" }), "Send. to ada. error. 1 to fix");
  assert.equal(runStateText("error", "failed"), null);
  assert.equal(runStateText("waiting", "waiting"), null);
  assert.equal(runStateText("tested", "tested"), null);
  assert.equal(runStateText("tested", "done"), "done");
  assert.equal(runStateText(null, "running"), "running");
  assert.equal(runStateText(null, "skipped"), "skipped");
  assert.equal(runStateText(null, "pending"), "pending");
  assert.equal(insertLabel("Send an email"), "Add a step after Send an email");
  assert.equal(insertLabel("  "), "Add the first step");
  assert.equal(insertLabel(null), "Add the first step");
  assert.equal(moreLabel("Lead nurture"), "More actions for Lead nurture");
  assert.equal(moreLabel(" "), "More actions");
  assert.equal(triggerLabel(0, false), "Trigger. Add a trigger.");
  assert.equal(triggerLabel(1, false), "Trigger. 1 trigger. Any one starts a run.");
  assert.equal(triggerLabel(2, true), "Trigger, selected. 2 triggers. Any one starts a run.");
  assert.equal(tabLabel("Data", false), "Data");
  assert.equal(tabLabel("Data", true), "Data, selected");
  assert.equal(tabLabel(COMPACT_SECTION.configure, true), "Selected step, selected");
  assert.equal(mappingLabel({ name: "email", source: "Trigger version 4", typeName: "string", presence: "value" }), "Map email from Trigger version 4, string");
  assert.equal(mappingLabel({ name: "note", source: "Look up, version 4", typeName: "string", presence: "empty" }), "Map note from Look up, version 4, string, empty");
  assert.equal(stepStatusChip("a", [], "waiting", new Set()), "waiting");
  assert.equal(stepStatusChip("a", [{ severity: "error" }], "waiting", new Set(["a"])), "error");
  assert.equal(stepStatusChip("a", [], "done", new Set(["a"])), "tested");
  const cards = source("./canvas/Cards.tsx");
  const canvas = source("./canvas/AutomationCanvas.tsx");
  const marks = source("./builder/marks.tsx");
  assert.match(cards, /cardLabel/);
  assert.match(cards, /\{card\.chip\}/);
  assert.match(cards, /runStateText/);
  assert.match(cards, /triggerLabel/);
  assert.match(cards, /moreLabel/);
  assert.match(canvas, /insertLabel/);
  assert.match(canvas, /moreLabel/);
  assert.match(marks, /mappingLabel/);
  assert.match(marks, /tabLabel/);
  assert.match(marks, /COMPACT_SECTION/);
  assert.doesNotMatch(canvas, /label="More"/);
  assert.doesNotMatch(cards, /label="More"/);
  for (const file of [cards, canvas, marks, source("./canvas/Inspector.tsx")]) {
    assert.doesNotMatch(file, /accessibilityLabel="(more|plus|x|bolt|chevD)"/);
    assert.doesNotMatch(file, /label="(more|plus|x|bolt)"/);
  }
  assert.equal(source("./a11y.ts").includes(String.fromCharCode(0x2014)), false);
});

test("arrows walk cards, tabs, insert controls, and mappings", () => {
  assert.equal(keyNeighbour(["configure", "data", "test"], "configure", "ArrowRight"), "data");
  assert.equal(keyNeighbour(["configure", "data", "test"], "data", "ArrowLeft"), "configure");
  assert.equal(keyNeighbour(["configure", "data", "test"], "test", "ArrowRight"), null);
  assert.equal(keyNeighbour(["configure", "data", "test"], "data", "Home"), "configure");
  assert.equal(keyNeighbour(["configure", "data", "test"], "configure", "End"), "test");
  assert.equal(keyNeighbour(["configure", "data", "test"], "configure", "Home"), null);
  assert.equal(keyNeighbour(["m1", "m2", "m3"], "m2", "ArrowDown"), "m3");
  assert.equal(keyNeighbour(["m1", "m2", "m3"], "m2", "ArrowUp"), "m1");
  assert.equal(keyNeighbour(["m1"], "m1", "ArrowDown"), null);
  assert.equal(keyNeighbour([], "m1", "ArrowDown"), null);
  const canvas = source("./canvas/AutomationCanvas.tsx");
  const cards = source("./canvas/Cards.tsx");
  const marks = source("./builder/marks.tsx");
  const tabs = source("./canvas/parts.tsx");
  assert.match(canvas, /neighbour\(/);
  assert.match(canvas, /keyNeighbour/);
  assert.match(cards, /onKeyDown/);
  assert.match(cards, /tabIndex: 0/);
  assert.match(marks, /keyNeighbour/);
  assert.match(marks, /tabIndex: 0/);
  assert.match(marks, /tabIndex: on \? 0 : -1/);
  assert.match(tabs, /keyNeighbour/);
  assert.equal(shelfRows(undefined, []).length, 0);
  assert.match(marks, /No sample yet/);
  assert.doesNotMatch(marks, /Elena/);
});

test("visible focus uses the existing accent line token and adds no motion", () => {
  assert.equal(FOCUS_TOKEN, "var(--accent-line)");
  assert.match(FOCUS_VISIBLE, /var\(--accent-line\)/);
  assert.match(focusRingCss(), /var\(--accent-line\)/);
  assert.doesNotMatch(focusRingCss(), /#[0-9A-Fa-f]{3,8}/);
  assert.match(source("./canvas/AutomationCanvas.tsx"), /installFocusRing/);
  assert.match(source("./canvas/Inspector.tsx"), /installFocusRing/);
  assert.match(source("./canvas/parts.tsx"), /vyreFocus/);
  assert.match(source("./canvas/Cards.tsx"), /vyreFocus/);
  for (const path of ["./canvas/AutomationCanvas.tsx", "./canvas/Inspector.tsx", "./canvas/Cards.tsx", "./builder/marks.tsx", "./config/Overlay.tsx"]) {
    const text = source(path);
    assert.doesNotMatch(text, /Animated\./);
    assert.doesNotMatch(text, /@keyframes/);
    assert.doesNotMatch(text, /transition:/);
  }
});
