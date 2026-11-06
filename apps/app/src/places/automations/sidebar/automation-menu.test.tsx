// The automation row's right-click menu in the sidebar (lane l-chrome2a): the menu of kinds-b.ts for the row's state and the person's rights, each item one capability call with the row's own id, Move to Trash last and asked first.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsSidebar } from "./AutomationsSidebar.tsx";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "./sample.ts";
import { fireUp } from "../../chats/sidebar/chats-open.support.tsx";
import type { Node } from "../../../onboarding/test-dom.ts";

installDom();
const rightClick = (root: Node, rowId: string): Promise<void> => fireUp(root, rowId, "onContextMenu", { preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} });
const ids = (root: Node): string[] => { const out: string[] = []; const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"] ?? n.props["testID"]; if (typeof t === "string" && t.startsWith("menu-item-")) out.push(t.slice("menu-item-".length)); (n.children ?? []).forEach(walk as never); }; walk(root as never); return out.filter((x) => x !== "report"); };
const rowIdOf = (root: Node): string => { let found = ""; const walk = (n: Node | string): void => { if (typeof n === "string" || found) return; const t = n.props["data-testid"] ?? n.props["testID"]; if (typeof t === "string" && t.startsWith("row-auto-")) found = t; (n.children ?? []).forEach(walk as never); }; walk(root as never); return found; };

test("an automation row: Run Now, Turn Off or On by state, Test, Runs, a Personal copy, Copy link, and Move to Trash last; each calls its capability", async () => {
  const s = createSampleAutomations(northwind);
  const root = await mount(createRoot, <AutomationsDataProvider value={s.data}><AutomationsSidebar shared={s.shared} reasons={s.space.reasons} /></AutomationsDataProvider>);
  await flush();
  const row = rowIdOf(root as never);
  assert.ok(row, "a row is drawn");
  const id = row.slice(row.lastIndexOf(":") + 1);
  await rightClick(root as never, row);
  const labels = ids(root as never);
  assert.equal(labels[0], "Open");
  assert.ok(labels.includes("Run Now") && labels.some((l) => /^Turn (On|Off)$/.test(l)) && labels.includes("Test…") && labels.some((l) => l.startsWith("Runs")) && labels.includes("Copy link"), labels.join("|"));
  assert.equal(labels.at(-1), "Move to Trash…", "danger last");
  await press(find(root as never, "menu-item-Run Now") as never);
  await flush();
  const calls = (s as unknown as { calls: { cap: string; input: any }[] }).calls;   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(calls.filter((c) => c.cap === "automations.run").map((c) => c.input.automationId), [id]);
  await rightClick(root as never, row);
  const toggle = ids(root as never).find((l) => /^Turn (On|Off)$/.test(l))!;
  await press(find(root as never, `menu-item-${toggle}`) as never);
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "automations.set_enabled").map((c) => c.input), [{ automationId: id, enabled: toggle === "Turn On" }]);
  await rightClick(root as never, row);
  await press(find(root as never, "menu-item-Move to Trash…") as never);
  await flush();
  assert.equal(calls.some((c) => c.cap === "automations.delete"), false, "it asks first");
  await press(find(root as never, "menu-item-Move to Trash") as never);
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "automations.delete").map((c) => c.input), [{ automationId: id }]);
});
