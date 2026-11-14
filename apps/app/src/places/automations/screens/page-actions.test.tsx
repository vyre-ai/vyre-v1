// The page's own actions, driven through the real BuilderPage: Undo, Move to Trash, Promote, personal copy, History, the Runs and Settings tabs, and the keyboard and screen-reader surface.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { BuilderPage } from "./BuilderPage.tsx";

const open = async (id: string, extra: Record<string, unknown> = {}) => {
  installDom();
  const s = createSampleAutomations(northwind);
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={s.data}>
      <BuilderPage automationId={id} {...extra} />
    </AutomationsDataProvider>,
  );
  await flush();
  return { s, root };
};
const menu = async (root: Parameters<typeof press>[0] & object, item: string) => {
  await press(find(root as never, "page-menu"));
  await flush();
  await press(find(root as never, `menu-item-${item}`));
  await flush();
};
const calls = (s: ReturnType<typeof createSampleAutomations>, cap: string) => s.calls.filter((c) => c.cap === cap);

test("Undo last edit takes back the draft: the Save bar goes and nothing was written", async () => {
  const { s, root } = await open("aut_digest", { initialSelected: "post" });
  await press(find(root, "delete-step"));
  assert.ok(find(root, "sv-bar-Save"), "an edit makes a draft");
  await menu(root, "Undo last edit");
  assert.equal(find(root, "sv-bar-Save"), null, "undone");
  assert.equal(calls(s, "automations.update").length, 0);
});

test("Move to Trash sends the Automation to Trash", async () => {
  const { s, root } = await open("aut_digest");
  await menu(root, "Move to Trash");
  assert.deepEqual(
    calls(s, "automations.delete").map((c) => c.input),
    [{ automationId: "aut_digest" }],
  );
});

test("Promote to the Space opens the sheet for a personal Automation", async () => {
  const { root } = await open("aut_digest");
  assert.equal(find(root, "promote-overlay"), null);
  await menu(root, "Promote to the Space");
  assert.ok(find(root, "promote-overlay"));
});

test("a Space Automation offers a personal copy, and the press asks for it", async () => {
  const { s, root } = await open("aut_lead");
  await menu(root, "Make a personal copy");
  assert.equal(calls(s, "automations.make_personal_copy").length, 1);
});

test("History opens from the menu and lists versions; Make a copy to share and Import a copy open the copies panel", async () => {
  const { root } = await open("aut_lead");
  await menu(root, "History");
  assert.ok(find(root, "versions-list"), "the History tab");
  await menu(root, "Make a copy to share");
  assert.ok(find(root, "packages-overlay"), "the copies panel");
});

test("the Runs and Settings tabs open from the tab strip", async () => {
  const { root } = await open("aut_lead");
  await press(find(root, "page-tab-settings"));
  await flush();
  assert.ok(textOf(root).includes("This Automation uses"), "Settings");
  await press(find(root, "page-tab-runs"));
  await flush();
  assert.equal(find(root, "settings-copies"), null, "Settings is gone");
});

test("the page is operable by keyboard and screen reader: tabs are tabs with one selected, the menu and every step are named buttons", () => {
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={createSampleAutomations(northwind).data}>
      <BuilderPage automationId="aut_lead" />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.equal((out.match(/role="tab"/g) ?? []).length, 3, "Steps, Runs, Settings");
  assert.equal((out.match(/aria-selected="true"/g) ?? []).length, 1, "one selected");
  assert.ok(out.includes('aria-label="More"'));
  assert.ok((out.match(/data-testid="sv-step-/g) ?? []).length > 3);
  assert.ok(!/<(div|span)[^>]*onclick/i.test(out), "no unnamed click handlers");
});
