// The step picker as a person meets it: the list, the submenu beside it, search, the keyboard, and the pinned Connect an app row. Every element has a defined press and key.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { StepPicker } from "./StepPicker.tsx";
import type { PickApp, PickStep } from "./model.ts";

installDom();

const STEPS: PickStep[] = [
  { key: "create_task", title: "Create a task" },
  { key: "send_email", title: "Send an email" },
  { key: "sign", title: "Send for signature" },
  { key: "google.gmail.send_message", title: "Send a Gmail message" },
  { key: "google.sheets.append_values", title: "Add a row to a sheet" },
  { key: "ms.mail.send_message", title: "Send an Outlook message" },
];
const APPS: PickApp[] = [
  { id: "google", name: "Google Workspace", connected: true, mayUse: true },
  { id: "microsoft", name: "Microsoft 365", connected: true, mayUse: false, admin: "Dana Whitfield" },
];
const model = { steps: STEPS, apps: APPS, suggested: ["send_email"] };

function setup() {
  const calls: string[] = [];
  const el = (
    <StepPicker
      model={model}
      x={100}
      y={100}
      onChoose={(id) => calls.push(`choose:${id}`)}
      onConnect={() => calls.push("connect")}
      onClose={() => calls.push("close")}
    />
  );
  return { calls, el };
}
const key = async (root: Parameters<typeof find>[0], k: string) => {
  const panel = find(root, "step-picker")!;
  await act(async () => {
    (panel.props["onKeyDown"] as (e: unknown) => void)({ key: k, preventDefault() {}, stopPropagation() {} });
  });
};

test("it lists Suggested next, Vyre's groups and your apps, never an app he may not use, with Connect an app last", async () => {
  const { el } = setup();
  const root = await mount(createRoot, el);
  const text = textOf(root);
  for (const want of [
    "Suggested next",
    "Send an email",
    "Vyre",
    "Messages",
    "Tasks",
    "Your apps",
    "Google Workspace",
    "Connect an app",
  ])
    assert.ok(text.includes(want), want);
  assert.ok(!text.includes("Microsoft") && !text.includes("Outlook"), "an app he may not use is absent");
  assert.ok(find(root, "row-pk-connect"));
});

test("Right opens an app's actions beside the list, Down and Enter add one", async () => {
  const { el, calls } = setup();
  const root = await mount(createRoot, el);
  assert.equal(find(root, "pk-sub"), null);
  for (const k of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowRight"]) await key(root, k);
  const sub = find(root, "pk-sub");
  assert.ok(sub, "the submenu is open");
  assert.ok(textOf(sub).includes("Send a Gmail message") && textOf(sub).includes("Add a row to a sheet"));
  await key(root, "ArrowDown");
  await key(root, "Enter");
  assert.deepEqual(calls, ["choose:google.sheets.append_values"]);
});

test("Left steps back out of the actions; Escape clears the search and then closes", async () => {
  const { el, calls } = setup();
  const root = await mount(createRoot, el);
  for (const k of ["ArrowDown", "ArrowRight"]) await key(root, k);
  assert.ok(find(root, "pk-sub"));
  await key(root, "ArrowLeft");
  assert.equal(find(root, "pk-sub"), null);
  await typeInto(find(root, "pk-search"), "sign");
  await key(root, "Escape");
  assert.equal((find(root, "pk-search")!.props["value"] as string) ?? "", "");
  assert.deepEqual(calls, []);
  await key(root, "Escape");
  assert.deepEqual(calls, ["close"]);
});

test("typing searches every action, names where each is from, and Enter adds the first", async () => {
  const { el, calls } = setup();
  const root = await mount(createRoot, el);
  await typeInto(find(root, "pk-search"), "gmail");
  const text = textOf(root);
  assert.ok(text.includes("Send a Gmail message") && text.includes("Google Workspace"));
  assert.ok(!text.includes("Create a task"));
  await key(root, "Enter");
  assert.deepEqual(calls, ["choose:google.gmail.send_message"]);
});

test("pressing a step adds it, pressing a group opens it, pressing Connect an app asks for the sheet", async () => {
  const { el, calls } = setup();
  const root = await mount(createRoot, el);
  await press(find(root, "row-pk-send_email"));
  await press(find(root, "row-pk-connect"));
  assert.deepEqual(calls, ["choose:send_email", "connect"]);
  await press(find(root, "row-pk-app:google"));
  await flush();
  assert.ok(find(root, "pk-sub"));
});

test("nothing found says so and still offers Connect an app", async () => {
  const { el } = setup();
  const root = await mount(createRoot, el);
  await typeInto(find(root, "pk-search"), "zzzz");
  assert.ok(textOf(root).includes("Nothing called “zzzz” in your apps."));
  assert.ok(find(root, "row-pk-connect"));
});

test("the actions open beside the row they belong to, not at the top of the list", async () => {
  const doc = globalThis as unknown as { document: { querySelector: (q: string) => unknown } };
  const had = doc.document.querySelector;
  (Dimensions as unknown as { set(d: object): void }).set({
    window: { width: 1200, height: 900, scale: 1, fontScale: 1 },
  });
  doc.document.querySelector = (q: string) =>
    q.includes("pk-app:google")
      ? { getBoundingClientRect: () => ({ top: 300, left: 0, right: 0, bottom: 340, height: 40, width: 380 }) }
      : null;
  try {
    const { el } = setup();
    const root = await mount(createRoot, el);
    for (const k of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowRight"]) await key(root, k);
    await flush();
    const sub = find(root, "pk-sub")!;
    const style = ([] as Record<string, unknown>[]).concat(sub.props["style"] as never).flat(3);
    const top = style.map((x) => (x as { top?: number }).top).find((t) => t !== undefined);
    const y = parseFloat(String(top));
    assert.ok(y >= 290 && y <= 300, `submenu top ${String(top)} is beside its row`);
  } finally {
    doc.document.querySelector = had;
  }
});
