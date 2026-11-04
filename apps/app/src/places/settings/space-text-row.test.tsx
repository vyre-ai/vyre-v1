// A text Space setting is a row: the value at the right and a Set or Edit button that opens the field. Saving keeps the settings.set_space call. On a phone a short picker stays on its label's line.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, installDom, press, textOf, typeInto, flush } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SavedProvider } from "./saved.tsx";
import { SpacePageBody } from "./SpacePages.tsx";
import { pickerStacks } from "./ui.tsx";
import { createSampleSettings, northwind } from "./sample.ts";
import type { SettingRow } from "./model.ts";

const row = (value: unknown): SettingRow => ({ key: "mounts.public_address", value } as unknown as SettingRow);

async function mountBody(value: string): Promise<{ root: Node; calls: { cap: string; input: unknown }[]; done(): void }> {
  const restore = installDom();
  const calls: { cap: string; input: unknown }[] = [];
  const data = { ...createSampleSettings(northwind).data, call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return { previous: value }; } };
  const r = createRoot();
  await act(async () => { r.render(<SettingsDataProvider value={data}><SavedProvider><SpacePageBody page="advanced" rows={[row(value)]} reload={() => undefined} found={null} /></SavedProvider></SettingsDataProvider>); });
  await flush();
  return { root: r.container as unknown as Node, calls, done: () => { try { void act(() => { r.unmount(); }); } catch { /* gone */ } restore(); } };
}

test("Public address for file changes is a row: Not set and a Set button, no greyed input", async () => {
  const m = await mountBody("");
  try {
    assert.ok(find(m.root, "ctl-mounts.public_address-value"), "the value is on the right");
    assert.match(textOf(find(m.root, "ctl-mounts.public_address-value")), /Not set/);
    assert.equal(find(m.root, "ctl-mounts.public_address"), null, "the field is not drawn until Set is pressed");
    assert.match(textOf(find(m.root, "ctl-mounts.public_address-edit")), /Set/);
  } finally { m.done(); }
});

test("Set opens the field, leaving it saves through settings.set_space, and a set value reads Edit", async () => {
  const m = await mountBody("");
  try {
    await press(find(m.root, "ctl-mounts.public_address-edit"));
    assert.ok(find(m.root, "ctl-mounts.public_address"), "the field opens");
    await typeInto(find(m.root, "ctl-mounts.public_address"), "https://files.example.com");
    await act(async () => { (find(m.root, "ctl-mounts.public_address")!.props["onBlur"] as (e: unknown) => void)({ target: {}, nativeEvent: {} }); });
    await flush();
    assert.deepEqual(m.calls.filter((c) => c.cap === "settings.set_space").map((c) => c.input), [{ key: "mounts.public_address", value: "https://files.example.com" }]);
    assert.equal(find(m.root, "ctl-mounts.public_address"), null, "the field closes");
  } finally { m.done(); }
  const set = await mountBody("https://files.example.com");
  try {
    assert.match(textOf(find(set.root, "ctl-mounts.public_address-value")), /files\.example\.com/);
    assert.match(textOf(find(set.root, "ctl-mounts.public_address-edit")), /Edit/);
  } finally { set.done(); }
});

test("on a phone a short picker stays on its label's line; a long picker name or a long label stacks", () => {
  assert.equal(pickerStacks("Local folders keep a server copy", "Yes"), false);
  assert.equal(pickerStacks("Mailgun region", "US"), false);
  assert.equal(pickerStacks("Send email through", "Mailgun"), false);
  assert.equal(pickerStacks("Record calls on new numbers", "Announce and record"), true);
  assert.equal(pickerStacks("Connect people's Microsoft mail and calendar and more besides", "Yes"), true);
});

test("the Files rows draw beside their controls on a phone: Set and a short Yes are inline", () => {
  // the phone rule: a row marked inline keeps its control on the label line
  assert.equal(pickerStacks("Local folders keep a server copy", "Yes"), false);
});
