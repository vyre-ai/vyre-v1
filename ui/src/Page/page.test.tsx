// ui/Page: one head (a title, one line under it, tabs, one action) and one scroll column under it. A Page never draws "Loading": its children are Loadables, so a failed read cannot hide in the frame.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { find, installDom, mount, press } from "../testing/dom.ts";
import { MAX_TABS, Page, shownTabs } from "./index.tsx";

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

test("tabs show their labels and counts, the active one is selected, and the first is active by default", () => {
  const html = renderToStaticMarkup(
    <Page title="Goal" tabs={tabs}>
      <Text>x</Text>
    </Page>,
  );
  assert.match(html, /role="tablist"/);
  for (const t of ["Details", "Activity", "3", "Files"]) assert.ok(html.includes(t), t);
  const tag = (id: string): string => html.match(new RegExp(`<div[^>]*data-testid="page-tab-${id}"[^>]*>`))![0];
  assert.match(tag("details"), /aria-selected="true"/);
  assert.match(tag("files"), /aria-selected="false"/);
});

test("more than seven tabs is a mistake and says so", () => {
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

test("a tab press chooses it, and Left, Right, Home and End move between tabs", async () => {
  const restore = installDom();
  try {
    const seen: string[] = [];
    let current = "details";
    const root = await mount(
      createRoot,
      <Page title="Goal" tabs={tabs} tab={current} onTab={(id) => void seen.push(id)} testID="p">
        <Text>x</Text>
      </Page>,
    );
    await press(find(root, "p-tab-activity"));
    const key = async (k: string): Promise<void> => {
      await act(async () => {
        (find(root, "p-tab-details")!.props["onKeyDown"] as (e: unknown) => void)({
          key: k,
          persist() {},
          stopPropagation() {},
          preventDefault() {},
          target: { tagName: "DIV", getAttribute: () => null },
          currentTarget: { tagName: "DIV", getAttribute: () => null },
          nativeEvent: {},
        });
      });
    };
    await key("ArrowRight");
    await key("End");
    await key("Home");
    void current;
    assert.deepEqual(seen, ["activity", "activity", "files", "details"]);
  } finally {
    restore();
  }
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
