// The row menus in the Chats sidebar itself: right-click or the row's "..." on an agent, a person, a chat and a channel opens the menu of that kind, and each item calls its capability with the row's own id.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { press, find, flush, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { drawn, fireUp, rowIds } from "../sidebar/chats-open.support.tsx";

const rightClick = (root: Node, rowId: string): Promise<void> => fireUp(root, rowId, "onContextMenu", { preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} });
const itemIds = (root: Node): string[] => itemIdsAll(root).filter((x) => x !== "report");
const itemIdsAll = (root: Node): string[] => { const out: string[] = []; const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string" && t.startsWith("menu-item-")) out.push(t.slice(10)); (n.children ?? []).forEach(walk); }; walk(root); return out; };
const caps = (s: { calls: { cap: string; input: unknown }[] }, cap: string): unknown[] => s.calls.filter((c) => c.cap === cap).map((c) => c.input);

test("an agent row: right-click gives the agent menu (not the chat menu), admin items last, and each item calls its capability", async () => {
  const { s, root } = await drawn(createRoot, { open: null });
  const face = rowIds(root, "row-f:").find((i) => i !== "row-f:agt_assistant")!;
  const agentId = face.slice("row-f:".length);
  s.menus.computers.set(agentId, { computerId: "cmp_a", state: "working" });
  await rightClick(root, face);
  await flush(); await rightClick(root, face);   // the first press reads the facts (mutes, computers); the menu then has them
  const ids = itemIds(root);
  assert.ok(ids.some((x) => x.startsWith("Message ")), ids.join("|"));
  assert.ok(!ids.includes("Mark as Unread") && !ids.includes("Archive"), "it is not the chat menu");
  assert.ok(ids.includes("Pause") && ids.includes("Mute") && ids.includes("Remove Star"), ids.join("|"));
  assert.equal(ids.at(-1), "Delete Agent…", "danger last");
  await press(find(root, "menu-item-Pause"));
  await flush();
  assert.deepEqual(caps(s, "agents.pause"), [{ agentId }]);
  await rightClick(root, face);
  await press(find(root, "menu-item-Mute"));
  await flush();
  assert.deepEqual(caps(s, "notifications.mute.set"), [{ target: { kind: "agent", id: agentId } }]);
  await rightClick(root, face);
  assert.ok(find(root, "menu-item-Unmute") && !find(root, "menu-item-Mute"), "the words follow the state");
  await press(find(root, "menu-item-Unmute"));
  await flush();
  assert.deepEqual(caps(s, "notifications.mute.clear"), [{ target: { kind: "agent", id: agentId } }]);
  assert.deepEqual(s.rejected, [], "every call inside the contract");
});

test("an agent's computer: Sleep when it works, Wake when it sleeps, Give It a Computer when it has none", async () => {
  const { s, root } = await drawn(createRoot, { open: null });
  const faces = rowIds(root, "row-f:").filter((i) => i !== "row-f:agt_assistant");
  const [a, b] = faces.map((i) => i.slice("row-f:".length)) as [string, string];
  s.menus.computers.set(a, { computerId: "cmp_a", state: "working" });
  await rightClick(root, faces[0]!); await flush();
  await rightClick(root, faces[0]!);
  assert.ok(find(root, "menu-item-Sleep Its Computer"));
  await press(find(root, "menu-item-Sleep Its Computer")); await flush();
  assert.deepEqual(caps(s, "computers.sleep"), [{ computerId: "cmp_a" }]);
  await rightClick(root, faces[1]!);
  assert.ok(find(root, "menu-item-Give It a Computer"), "an agent with no computer offers one");
  await press(find(root, "menu-item-Give It a Computer")); await flush();
  assert.deepEqual(caps(s, "computers.provision"), [{ agentId: b, idempotencyKey: `pc_${b}` }]);
});

test("Delete Agent asks first; Cancel changes nothing, Delete agent deletes", async () => {
  const { s, root } = await drawn(createRoot, { open: null });
  const face = rowIds(root, "row-f:").find((i) => i !== "row-f:agt_assistant")!;
  await rightClick(root, face);
  await press(find(root, "menu-item-Delete Agent…")); await flush();
  assert.deepEqual(caps(s, "agents.delete"), [], "nothing yet");
  assert.ok(find(root, "menu-item-Cancel") && find(root, "menu-item-Delete agent"), "it asks");
  await press(find(root, "menu-item-Delete agent")); await flush();
  assert.deepEqual(caps(s, "agents.delete"), [{ agentId: face.slice("row-f:".length) }]);
});

test("a chat row: Rename edits it in the row and calls threads.update; Mute and Mark as Unread call theirs", async () => {
  const { s, root } = await drawn(createRoot, { open: null });
  const all = rowIds(root, "row-c:");
  assert.ok(all.length > 0, `chat rows: ${rowIds(root, "row-").join(" ")}`);
  const row = all[0]!;
  const threadId = row.slice("row-c:".length);
  await rightClick(root, row);
  const ids = itemIds(root);
  assert.ok(["Open", "Rename", "Star", "Mark as Unread", "Mute", "Archive", "Delete chat"].every((x) => ids.includes(x)), ids.join("|"));
  assert.equal(ids.at(-1), "Delete chat");
  await press(find(root, "menu-item-Mute")); await flush();
  assert.deepEqual(caps(s, "notifications.mute.set"), [{ target: { kind: "thread", id: threadId } }]);
  await rightClick(root, row);
  await press(find(root, "menu-item-Rename")); await flush();
  const field = find(root, `chat-rename-${threadId}`);
  assert.ok(field, "the title becomes a field in the row");
  await typeInto(field, "Records search, round two");
  await act(async () => { (find(root, `chat-rename-${threadId}`)!.props.onBlur as (e: unknown) => void)({ nativeEvent: {}, target: { value: "Records search, round two" } }); });
  await flush();
  assert.deepEqual(caps(s, "threads.update"), [{ threadId, title: "Records search, round two" }]);
  assert.equal(find(root, `chat-rename-${threadId}`), null, "the field closes");
  assert.deepEqual(s.rejected, []);
});

test("a person row: Message, read state and Mute; the row's ... opens the same menu", async () => {
  const { s, root } = await drawn(createRoot, { open: null, people: [{ id: "usr_maya", name: "Maya Chen" }, { id: "usr_omar", name: "Omar Haddad" }] });
  const pr = rowIds(root, "row-p:");
  assert.ok(pr.length > 0, `people rows: ${rowIds(root, "row-").join(" ")}`);
  const row = pr[0]!;
  const id = row.slice("row-p:".length);
  const hot = [...(await import("../sidebar/chats-open.support.tsx")).chainTo(root, row) ?? []].reverse().find((n) => typeof n.props.onMouseEnter === "function");
  assert.ok(hot, "the row reacts to the pointer");
  await act(async () => { (hot.props.onMouseEnter as () => void)(); });
  await flush();
  await press(find(root, `more-p:${id}`)); await flush();
  const ids = itemIds(root);
  assert.ok(ids.some((x) => x.startsWith("Message ")) && ids.includes("Mute"), ids.join("|"));
  await press(find(root, "menu-item-Mute")); await flush();
  assert.deepEqual(caps(s, "notifications.mute.set"), [{ target: { kind: "person", id } }]);
});
