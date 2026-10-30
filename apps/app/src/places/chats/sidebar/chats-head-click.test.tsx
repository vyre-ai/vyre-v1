// The Chats section head is a real control: pressing it folds the list of chats and pressing it again opens it (a click path, not markup).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { Node } from "../../../onboarding/test-dom.ts";
import { installDom, mount, press, find, flush } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { createSampleSidebar } from "./sample.ts";

test("pressing the Chats head folds the chats and pressing it again brings them back", async () => {
  installDom();
  const s = createSampleSidebar();
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />);
  assert.ok(find(root, "head-recent"), "the Chats head is drawn");
  const ids: string[] = [];
  const walk = (n: Node | string): void => { if (typeof n === "string") return; if (typeof n.props["data-testid"] === "string") ids.push(n.props["data-testid"] as string); (n.children ?? []).forEach(walk); };
  const rowIds = (): string[] => { ids.length = 0; walk(root); return ids.filter((i) => i.startsWith("row-c:")); };
  const before = rowIds().length;
  assert.ok(before > 0, "the sample Space has chats under the head");
  await press(find(root, "toggle-recent"));
  await flush();
  assert.equal(rowIds().length, 0, "folded: no chat rows");
  await press(find(root, "toggle-recent"));
  await flush();
  assert.equal(rowIds().length, before, "open again: the chats are back");
});

test("the list itself takes the arrow keys and says so, so a click on its empty area is not a dead control", async () => {
  installDom();
  const root = await mount(createRoot, <ChatsSidebar data={createSampleSidebar().data} window={{ start: 0, end: 500 }} />);
  const list = find(root, "chats-sidebar");
  assert.ok(list && typeof list.props["data-noop-ok"] === "string", "marked noop-ok");
  assert.equal(list.props.tabIndex, 0, "still reachable by Tab for the arrow keys");
});
