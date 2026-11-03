// Imported sessions in the sidebar, their second file (the first is imported-menu.test.tsx): archive, unarchive and delete. Both draw through chats-open.support.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { IMPORTED, ids, drawn, fireUp } from "./chats-open.support.tsx";
import type { Node } from "../../../onboarding/test-dom.ts";

/** A right-click on a row: its menu opens. */
const rightClick = (root: Node, rowId: string): Promise<void> => fireUp(root, rowId, "onContextMenu", { preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} });

test("Archive moves an imported session into the Archived section, and Unarchive puts it back", async () => {
  const { s, root } = await drawn(createRoot, { imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Archive"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.archive").map((c) => c.input), [{ conversationId: "isc_a" }]);
  assert.ok(!ids(root).includes("row-i:isc_a"), "gone from Imported");
  assert.ok(ids(root).includes("head-archived") && textOf(find(root, "count-archived")).trim() === "1", "the Archived head counts it");
  await press(find(root, "toggle-archived"));
  await flush();
  assert.ok(ids(root).includes("row-i:isc_a"), "it is in the Archived section");
  await rightClick(root, "row-i:isc_a");
  assert.ok(find(root, "menu-item-Unarchive") && !find(root, "menu-item-Archive"));
  await press(find(root, "menu-item-Unarchive"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.archive").map((c) => c.input), [{ conversationId: "isc_a" }, { conversationId: "isc_a", unarchive: true }]);
  assert.ok(!ids(root).includes("head-archived"), "nothing archived, no section");
  assert.ok(ids(root).includes("row-i:isc_a"), "back under Imported");
  assert.deepEqual(s.rejected, []);
});

test("Delete asks in the menu, removes the imported copy, keeps the chat it was continued in, and leaves its open transcript", async () => {
  const { s, root, news } = await drawn(createRoot, { imported: IMPORTED, open: "i:isc_b" });
  await rightClick(root, "row-i:isc_b");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  assert.ok(textOf(root).includes("Delete this imported session? Its chat stays."), "a plain confirm in the menu");
  assert.equal(s.calls.filter((c) => c.cap === "sessions.delete").length, 0, "nothing is deleted before the confirm");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.delete").map((c) => c.input), [{ conversationId: "isc_b" }]);
  assert.ok(!ids(root).includes("row-i:isc_b"), "the imported row is gone");
  assert.ok(ids(root).includes("row-c:c3"), "the chat it was continued in stays");
  assert.equal(s.calls.filter((c) => c.cap.startsWith("threads.")).length, 0, "no chat is touched");
  assert.deepEqual(news, ["new"], "the transcript that was open goes: the place shows a new chat");
  assert.deepEqual(s.rejected, []);
});

test("Cancel in the delete confirm deletes nothing", async () => {
  const { s, root } = await drawn(createRoot, { imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  await press(find(root, "menu-item-Cancel"));
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "sessions.delete").length, 0);
  assert.ok(ids(root).includes("row-i:isc_a"));
});
