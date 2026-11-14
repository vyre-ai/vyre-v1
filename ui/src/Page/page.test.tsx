// ui/Page: one head (a title, one line under it, tabs, one action) and one scroll column under it. A Page never draws "Loading": its children are Loadables, so a failed read cannot hide in the frame.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { find, installDom, mount, press } from "../testing/dom.ts";
import { MAX_TABS, Page, fitTabs, shownTabs } from "./index.tsx";

const tabs = [
  { id: "details", label: "Details" },
  { id: "activity", label: "Activity", count: 3 },
  { id: "files", label: "Files" },
];

test("a page has one h1, a one-line subtitle, an action and its children", () => {
  const html = renderToStaticMarkup(
    <Page title="Spend" subtitle="What each agent cost this month" action={<Text>Export</Text>}>
      <Text>the content</Text>
    </Page>,
  );
  assert.equal(html.match(/<h1/g)?.length, 1);
  for (const t of ["Spend", "What each agent cost this month", "Export", "the content"]) assert.ok(html.includes(t), t);
  assert.ok(html.indexOf("Spend") < html.indexOf("the content"));
});

test("bare draws no head: the children alone", () => {
  const html = renderToStaticMarkup(
    <Page title="Hidden title" bare>
      <Text>only this</Text>
    </Page>,
  );
  assert.ok(html.includes("only this"));
  assert.ok(!html.includes("<h1") && !html.includes("Hidden title"));
});

test("tabs are the one TabStrip: labels and counts, the open one selected and the only one in the tab order", () => {
  const html = renderToStaticMarkup(
    <Page title="Goal" tabs={tabs}>
      <Text>x</Text>
    </Page>,
  );
  assert.match(html, /role="tablist"/);
  for (const t of ["Details", "Activity 3", "Files"]) assert.ok(html.includes(t), t);
  const tag = (id: string, on: boolean): string =>
    html.match(new RegExp(`<div[^>]*data-testid="tab-${id}${on ? "-selected" : ""}"[^>]*>`))![0];
  assert.match(tag("details", true), /aria-selected="true"/);
  assert.match(tag("details", true), /tabindex="0"/);
  assert.match(
    tag("files", false),
    /tabindex="-1"/,
    "a roving tab index: the tabs that are not open are not in the tab order",
  );
});

test("more than seven tabs is a mistake and says so while developing", () => {
  const many = Array.from({ length: MAX_TABS + 1 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
  assert.throws(
    () =>
      renderToStaticMarkup(
        <Page title="P" tabs={many}>
          <Text>x</Text>
        </Page>,
      ),
    /at most seven tabs/,
  );
});

test("a side pane opens on Details: its first tab is details", () => {
  assert.throws(
    () =>
      renderToStaticMarkup(
        <Page
          title="P"
          kind="side"
          tabs={[
            { id: "activity", label: "Activity" },
            { id: "details", label: "Details" },
          ]}
        >
          <Text>x</Text>
        </Page>,
      ),
    /Details/,
  );
  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      <Page title="P" kind="side" tabs={tabs}>
        <Text>x</Text>
      </Page>,
    ),
  );
});

test("on a phone three tabs show, the active one always among them, and the rest go under More", () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
  assert.deepEqual(
    shownTabs(seven, "t0", true).shown.map((t) => t.id),
    ["t0", "t1", "t2"],
  );
  assert.deepEqual(
    shownTabs(seven, "t5", true).shown.map((t) => t.id),
    ["t0", "t1", "t5"],
    "the active tab is never hidden",
  );
  assert.equal(shownTabs(seven, "t0", true).more.length, 4);
  assert.equal(shownTabs(seven, "t0", false).more.length, 0);
});

test("the status line sits under the head and a failed child still has its head", () => {
  const html = renderToStaticMarkup(
    <Page title="Settings" status={{ tone: "warn", text: "Offline, showing your saved copy" }}>
      <Text>Could not load settings</Text>
    </Page>,
  );
  assert.ok(html.indexOf("Settings") < html.indexOf("Offline, showing your saved copy"));
  assert.ok(html.indexOf("Offline, showing your saved copy") < html.indexOf("Could not load settings"));
  assert.ok(!html.includes("Loading"), "a Page never draws Loading");
});

// 14 Nov 2026 review: throwing in production gave a person "Couldn't draw this page" with a Retry that threw again. In the product the mistake is logged once and the page still draws.
test("in the product eight tabs show seven and put the rest under More, and a side pane puts Details first; nothing throws", () => {
  const g = globalThis as { process?: { env?: { NODE_ENV?: string } } };
  const was = g.process!.env!.NODE_ENV;
  const logged: string[] = [];
  const error = console.error;
  console.error = (m: string) => void logged.push(m);
  g.process!.env!.NODE_ENV = "production";
  try {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
    const r = fitTabs(many, "page", "Data");
    assert.equal(r.shown.length, 7);
    assert.deepEqual(
      r.overflow.map((t) => t.id),
      ["t7"],
    );
    assert.doesNotThrow(() =>
      renderToStaticMarkup(
        <Page title="Data" tabs={many}>
          <Text>x</Text>
        </Page>,
      ),
    );
    const side = fitTabs(
      [
        { id: "activity", label: "Activity" },
        { id: "details", label: "Details" },
      ],
      "side",
      "Goal",
    );
    assert.equal(side.shown[0]?.id, "details");
    assert.ok(logged.length >= 2, "reported to the log");
    const before = logged.length;
    fitTabs(many, "page", "Data");
    assert.equal(logged.length, before, "each mistake is logged once");
  } finally {
    g.process!.env!.NODE_ENV = was;
    console.error = error;
  }
});

test("the tabs past the seventh go under More", () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
  const over = [{ id: "x", label: "X" }];
  assert.deepEqual(
    shownTabs(seven, "t0", false, over).more.map((t) => t.id),
    ["x"],
  );
});
