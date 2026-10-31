// ui/PeoplePicker: search narrows the list, a press toggles, chips remove, Enter takes the first match.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { PeoplePicker, matching } from "./index.tsx";

const entries = [
  { id: "usr_maya", name: "Maya Chen", kind: "person" as const, sub: "Partner" },
  { id: "usr_omar", name: "Omar Haddad", kind: "person" as const },
  { id: "agt_assistant", name: "Assistant", kind: "agent" as const, sub: "Assistant" },
];
const open: Array<{ unmount(): void }> = [];
afterEach(async () => { for (const r of open.splice(0)) await act(async () => { r.unmount(); }); });
async function mount(el: ReactElement): Promise<Node> {
  const r = createRoot();
  open.push(r);
  await act(async () => { r.render(el); });
  await flush();
  return r.container as unknown as Node;
}

test("matching narrows by any part of the name, case aside", () => {
  assert.deepEqual(matching(entries, "ma").map((e) => e.id), ["usr_maya", "usr_omar"]);
  assert.deepEqual(matching(entries, "  ").length, 3);
  assert.deepEqual(matching(entries, "zzz"), []);
});

test("a press toggles a row, a chosen one is a chip, and a press on the chip removes it", async () => {
  installDom();
  let picked: string[] = [];
  const view = (): ReactElement => <PeoplePicker entries={entries} selected={picked} onToggle={(id) => { picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; }} />;
  const root = await mount(view());
  await press(find(root, "row-people-picker-usr_omar"));
  assert.deepEqual(picked, ["usr_omar"]);
  const again = await mount(<PeoplePicker entries={entries} selected={["usr_omar"]} onToggle={(id) => { picked = picked.filter((x) => x !== id); }} />);
  assert.ok(find(again, "people-picker-chip-usr_omar"), "the chosen one shows as a chip");
  await press(find(again, "people-picker-chip-usr_omar"));
  assert.deepEqual(picked, []);
});

test("typing narrows the list and Enter takes the first match", async () => {
  installDom();
  const got: string[] = [];
  const root = await mount(<PeoplePicker entries={entries} selected={[]} onToggle={(id) => void got.push(id)} />);
  await typeInto(find(root, "people-picker-search"), "oma");
  assert.ok(find(root, "row-people-picker-usr_omar") && !find(root, "row-people-picker-usr_maya"));
  await act(async () => { (find(root, "people-picker-search")!.props.onKeyDown as (e: unknown) => void)({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {}, isDefaultPrevented: () => false, target: { blur() {} } }); });
  assert.deepEqual(got, ["usr_omar"]);
  await typeInto(find(root, "people-picker-search"), "zzz");
  assert.match(textOf(find(root, "people-picker-list")), /No match/);
});
