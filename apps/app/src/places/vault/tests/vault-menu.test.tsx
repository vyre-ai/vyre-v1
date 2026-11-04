// The Vault item's right-click menu in the place itself (lane l-chrome2a): the menu of kinds-b.ts for the row's level, each item making its capability call with the row's own id, and Move to Trash last.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import Vault from "../layout/index.tsx";
import { createSampleVault } from "../layout/sample.ts";
import { fireUp } from "../../chats/sidebar/chats-open.support.tsx";
import type { Node } from "../../../onboarding/test-dom.ts";

Dimensions.set({ window: { width: 1280, height: 800, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 800, scale: 1, fontScale: 1 } });
installDom();
const rightClick = (root: Node, rowId: string): Promise<void> => fireUp(root, rowId, "onContextMenu", { preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} });
const menuLabels = (root: Node): string[] => { const out: string[] = []; const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"] ?? n.props["testID"]; if (typeof t === "string" && t.startsWith("menu-item-")) out.push(t.slice("menu-item-".length)); (n.children ?? []).forEach(walk as never); }; walk(root as never); return out.filter((x) => x !== "report"); };
const caps = (calls: { cap: string; input: unknown }[], cap: string): unknown[] => calls.filter((c) => c.cap === cap).map((c) => c.input);

test("a manager's item row: the full menu, Mark as Rotated and Move to a folder call their capabilities, Move to Trash is last", async () => {
  const v = createSampleVault();
  const root = await mount(createRoot, <Vault data={v.data} />);
  await flush();
  await rightClick(root as never, "row-vit_ghl");
  const labels = menuLabels(root as never);
  assert.deepEqual(labels.slice(0, 5), ["Edit…", "Reveal Values…", "Copy Handle", "Copy Name", "Share…"], labels.join("|"));
  assert.equal(labels.at(-1), "Move to Trash…", "danger last");
  assert.ok(labels.includes("Mark as Rotated") && labels.includes("Usage…"));
  await press(find(root as never, "menu-item-Mark as Rotated") as never);
  await flush();
  assert.deepEqual(caps(v.calls, "vault.item.mark_rotated"), [{ itemId: "vit_ghl" }]);
  await rightClick(root as never, "row-vit_ghl");
  const target = menuLabels(root as never).find((l) => !/^(Edit|Reveal|Copy|Share|Mark|Usage|Move to Trash)/.test(l))!;
  await press(find(root as never, `menu-item-${target}`) as never);
  await flush();
  const moved = caps(v.calls, "vault.item.move") as { itemId: string; folderId: string }[];
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.itemId, "vit_ghl");
});

test("an editor's row has no Share, Move or Trash; Copy Handle puts the handle on the clipboard", async () => {
  const v = createSampleVault();
  const root = await mount(createRoot, <Vault data={v.data} />);
  await flush();
  await rightClick(root as never, "row-vit_stripe");
  const labels = menuLabels(root as never);
  assert.ok(labels.includes("Edit…") && labels.includes("Mark as Rotated"));
  assert.ok(!labels.includes("Share…") && !labels.some((l) => /Trash|Move to Folder/.test(l)), labels.join("|"));
  await press(find(root as never, "menu-item-Copy Handle") as never);
  await flush();
  assert.equal(v.copied.length, 1);
});
