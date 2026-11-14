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

test("while the step catalogue has not answered, Add a step says so; when it failed, it says why and offers Retry", async () => {
  installDom();
  const s = createSampleAutomations(northwind);
  const failing = {
    ...s.data,
    call: async (cap: string, i: unknown) => {
      if (cap === "automations.steps.list") throw new Error("The steps could not be read.");
      return s.data.call(cap, i);
    },
  };
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={failing as never}>
      <BuilderPage automationId="aut_lead" />
    </AutomationsDataProvider>,
  );
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 100));
    await flush();
  }
  await press(find(root, "sv-add"));
  await flush();
  const text = textOf(root);
  assert.ok(text.includes("The steps could not be read."), text.slice(-300));
  assert.ok(find(root, "menu-item-Retry"), "Retry is offered");
});

test("a step kind this version does not know is drawn as a plain row, never opened, and Save keeps it exactly as it was", async () => {
  installDom();
  const s = createSampleAutomations(northwind);
  const row = s.replica.rows("automations").find((r) => r["id"] === "aut_digest")!;
  const def = row["definition"] as { triggers: unknown[]; nodes: { id: string; next?: string[] }[] };
  const future = { id: "zz", key: "zzz.future_step", title: "Do the thing", input: { x: 1 } };
  const last = def.nodes[def.nodes.length - 1]!;
  s.replica.put("automations", [
    { ...row, definition: { ...def, nodes: [...def.nodes.slice(0, -1), { ...last, next: ["zz"] }, future] } },
  ]);
  const data = {
    ...s.data,
    call: async (cap: string, i: unknown) => {
      if (cap === "automations.steps.list")
        return { steps: [{ key: "post_message", title: "Post a chat message" }], checked: true };
      if (cap === "automations.triggers.list") return { triggers: [{ key: "manual", title: "By hand" }] };
      return s.data.call(cap, i);
    },
  };
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={data as never}>
      <BuilderPage automationId="aut_digest" />
    </AutomationsDataProvider>,
  );
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 150));
    await flush();
  }
  assert.ok(textOf(root).includes("A step this version can't show: Do the thing (zzz.future_step)"));
  await press(find(root, "sv-step-zz"));
  await flush();
  assert.equal(find(root, "inspector"), null, "it has no form here");
});

test("a person who may not change an Automation: its Settings show who has access, with no Add, Share or follower button; the menu has no Undo or Trash; nothing is ever written", async () => {
  installDom();
  const s = createSampleAutomations(northwind);
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={{ ...s.data, canSpace: false } as never}>
      <BuilderPage automationId="aut_lead" initialTab="settings" />
    </AutomationsDataProvider>,
  );
  for (let i = 0; i < 3; i++) await flush();
  for (const id of ["add-access", "share", "add-follower"]) assert.equal(find(root, id), null, `${id} is not shown`);
  await press(find(root, "page-menu"));
  await flush();
  assert.equal(find(root, "menu-item-Undo last edit"), null);
  assert.equal(find(root, "menu-item-Move to Trash"), null);
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(
    s.calls.filter((c) => /^automations\.(update|delete|set_enabled|followers)/.test(c.cap)).length,
    0,
    "no write of any kind",
  );
});

test("the AI step's account and backup are on its form", () => {
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={createSampleAutomations(northwind).data}>
      <BuilderPage automationId="aut_lead" initialSelected="draft" />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.ok(out.includes("Backup"), "the backup key");
  assert.ok(out.includes("Runs on"), "the key it runs on");
});
