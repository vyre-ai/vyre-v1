// Imported sessions in the sidebar: the menu, rename, archive and delete.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { press, find, flush, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import { importedDeleteConfirm, importedMenuEntries } from "./chat-menu.ts";
import { importedRows } from "../imported/model.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { IMPORTED, ids, chainTo, drawn } from "./chats-open.support.tsx";

const rightClick = async (root: Node, rowId: string): Promise<void> => {
  const w = [...(chainTo(root, rowId) ?? [])].reverse().find((n) => typeof n.props.onContextMenu === "function");
  assert.ok(w, `${rowId} opens a menu on right-click`);
  await act(async () => { (w.props.onContextMenu as (e: unknown) => void)({ preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} }); });
  await flush();
};

test("an imported row's menu is Open, Rename, Archive or Unarchive, and Delete session; delete asks first and says the chat stays when there is one", () => {
  const noop = { open() {}, rename() {}, archive() {}, unarchive() {}, deleteSession() {} };
  const [a, b] = importedRows(IMPORTED);
  const labels = (r: typeof a): string[] => importedMenuEntries(r!, noop).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.deepEqual(labels(a), ["Open", "Rename", "Archive", "Delete session"]);
  assert.deepEqual(labels({ ...a!, archived: true }), ["Open", "Rename", "Unarchive", "Delete session"]);
  assert.deepEqual(importedMenuEntries(a!, noop).filter((e) => "danger" in e && e.danger === true).map((e) => ("label" in e ? e.label : "")), ["Delete session"]);
  const continued = IMPORTED[1]!.continuedThreadId ? b! : a!;
  assert.deepEqual(importedDeleteConfirm(continued, () => undefined).map((e) => ("head" in e ? e.head : "label" in e ? e.label : "-")), ["Delete this imported session? Its chat stays.", "Delete session", "Cancel"]);
  assert.equal((importedDeleteConfirm(a!, () => undefined)[0] as { head: string }).head, "Delete this imported session?");
});

test("a continued session shows its chat's last day, not the word Chat; one never continued shows the day it started", async () => {
  const { root } = await drawn({ imported: IMPORTED, open: null });
  assert.equal(textOf(find(root, "imported-day-isc_b")).trim(), "Oct 24", "the day October invoices was last active");
  assert.equal(textOf(find(root, "imported-day-isc_a")).trim(), "Oct 20");
  assert.ok(!textOf(find(root, "imported-row-isc_b")).includes("Chat"));
});

test("right-click and the row's ... open the same menu; Rename edits the title in the row and keeps it", async () => {
  const { s, root } = await drawn({ imported: IMPORTED, open: "i:isc_a" });
  // the "..." shows while the pointer is on the row
  const hot = [...(chainTo(root, "row-i:isc_a") ?? [])].reverse().find((n) => typeof n.props.onMouseEnter === "function");
  assert.ok(hot, "the row reacts to the pointer");
  await act(async () => { (hot.props.onMouseEnter as () => void)(); });
  await flush();
  await press(find(root, "more-i:isc_a"));
  await flush();
  assert.ok(find(root, "menu-item-Rename") && find(root, "menu-item-Archive") && find(root, "menu-item-Delete session") && find(root, "menu-item-Open"), "the ... opens the menu");
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Rename"));
  await flush();
  const field = find(root, "imported-rename-isc_a");
  assert.ok(field, "the title becomes a field in the row");
  await typeInto(field, "Login fix, round two");
  await act(async () => { (find(root, "imported-rename-isc_a")!.props.onBlur as (e: unknown) => void)({ nativeEvent: {}, target: { value: "Login fix, round two" } }); });
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.rename").map((c) => c.input), [{ conversationId: "isc_a", title: "Login fix, round two" }]);
  assert.equal(find(root, "imported-rename-isc_a"), null, "the field closes");
  assert.equal(find(root, "row-i:isc_a")?.props["aria-label"], "Login fix, round two", "the row has the new name");
  const kept = await s.data.call("sessions.list", {}) as { sessions: { conversationId: string; title: string }[] };
  assert.equal(kept.sessions.find((x) => x.conversationId === "isc_a")?.title, "Login fix, round two", "the name persists where the list is read from");
  assert.deepEqual(s.rejected, [], "every call inside the contract");
});

test("Escape, or leaving the name as it was, renames nothing", async () => {
  const { s, root } = await drawn({ imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Rename"));
  await flush();
  await act(async () => { (find(root, "imported-rename-isc_a")!.props.onBlur as (e: unknown) => void)({ nativeEvent: {}, target: { value: "Fix the login" } }); });
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "sessions.rename").length, 0);
  assert.equal(find(root, "row-i:isc_a")?.props["aria-label"], "Fix the login");
});

test("Archive moves an imported session into the Archived section, and Unarchive puts it back", async () => {
  const { s, root } = await drawn({ imported: IMPORTED });
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
  const { s, root, news } = await drawn({ imported: IMPORTED, open: "i:isc_b" });
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
  const { s, root } = await drawn({ imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  await press(find(root, "menu-item-Cancel"));
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "sessions.delete").length, 0);
  assert.ok(ids(root).includes("row-i:isc_a"));
});

