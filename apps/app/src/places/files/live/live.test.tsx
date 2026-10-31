// Live folders (rc.8): the words each mount's row says, the order of the list, and the buttons of the view.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { LiveFolders } from "./LiveFolders.tsx";
import { liveRow, needsReconnect, orderRows, summaryLine, whoWords } from "./model.ts";
import type { MountRow, Share } from "./model.ts";

installDom();

const NOW = 1_760_000_000_000;
const m = (o: Partial<MountRow>): MountRow => ({ mountId: "mnt_1", folderId: "fld_1", kind: "google_drive", provider: "Google Drive", name: "Sales", state: "idle", mode: "server_copy", reviewChanges: true, pendingChanges: 0, conflicts: 0, lastSyncAt: NOW - 10_000, ...o } as MountRow);
const share = (kind: string, id: string): Share => ({ grant: { id: `g_${id}`, subject: { kind, id }, resource: { type: "folder", id: "fld_1" }, level: "view", conditions: {}, by: "usr_me", createdAt: 1 }, through: "direct" } as Share);

test("a mount that synced seconds ago is Live; an older one says when; lag, waiting changes and conflicts are listed", () => {
  assert.equal(liveRow(m({}), null, NOW).state, "Live");
  assert.equal(liveRow(m({ lastSyncAt: NOW - 5 * 60_000 }), null, NOW).state, "Synced 5 min ago");
  assert.equal(liveRow(m({ lastSyncAt: undefined }), null, NOW).state, "Not synced yet");
  assert.equal(liveRow(m({ kind: "local", provider: "Local folder" }), null, NOW).state, "Synced 10 s ago", "a folder on a computer is never called live");
  const busy = liveRow(m({ lagSeconds: 45, pendingChanges: 2, conflicts: 1 }), null, NOW);
  assert.equal(busy.detail, "45 s behind · 2 changes waiting · 1 conflict");
  assert.equal(busy.state, "Synced 10 s ago", "behind is not live");
  assert.equal(busy.tone, "warn");
});

test("a failing mount needs attention and offers Reconnect only when the sign-in is the cause", () => {
  const auth = liveRow(m({ state: "failing", error: "Sign in to Google again" }), null, NOW);
  assert.deepEqual([auth.state, auth.tone, auth.actions[0]], ["Needs attention", "bad", "reconnect"]);
  const other = liveRow(m({ state: "failing", error: "Google is not answering" }), null, NOW);
  assert.equal(other.actions[0], "sync");
  assert.equal(needsReconnect({ state: "idle", error: "sign in" }), false);
  assert.deepEqual(liveRow(m({ state: "paused" }), null, NOW).actions, ["resume", "open"]);
});

test("who can see it, the order (needs attention first) and the summary line", () => {
  assert.equal(whoWords(null), "");
  assert.equal(whoWords([]), "Only you");
  assert.equal(whoWords([share("person", "a"), share("agent", "b")]), "You and 1 person");
  assert.equal(whoWords([share("person", "a"), share("person", "b")]), "You and 2 people");
  assert.equal(whoWords([share("group", "g")]), "Shared with a group");
  const rows = [liveRow(m({ name: "B" }), null, NOW), liveRow(m({ mountId: "x", name: "A", state: "failing", error: "x" }), null, NOW), liveRow(m({ mountId: "y", name: "C", state: "paused" }), null, NOW)];
  assert.deepEqual(orderRows(rows).map((r) => r.name), ["A", "C", "B"]);
  assert.equal(summaryLine(rows), "3 folders · 1 needs attention");
  assert.equal(summaryLine([rows[0]!]), "1 folder · all well");
});

test("the view: each row has its button, the first action runs, empty and error are designed", async () => {
  const done: string[] = [];
  const rows = [liveRow(m({ state: "failing", error: "Sign in to Google again" }), [share("person", "a")], NOW), liveRow(m({ mountId: "mnt_2", name: "Docs", kind: "onedrive", provider: "OneDrive" }), null, NOW)];
  const root = await mount(createRoot, <LiveFolders rows={rows} busy={new Set()} said={null} onAction={(r, a) => done.push(`${r.mountId}:${a}`)} onConnect={() => done.push("connect")} onRetry={() => done.push("retry")} />);
  assert.match(textOf(find(root, "live-state-mnt_1")), /Needs attention/);
  assert.match(textOf(find(root, "live-act-mnt_1")), /Reconnect/);
  assert.match(textOf(find(root, "live-act-mnt_2")), /Sync now/);
  await press(find(root, "live-act-mnt_1"));
  await press(find(root, "live-connect"));
  assert.deepEqual(done, ["mnt_1:reconnect", "connect"]);
  const empty = await mount(createRoot, <LiveFolders rows={[]} busy={new Set()} said={null} onAction={() => undefined} onConnect={() => done.push("c2")} onRetry={() => undefined} />);
  assert.match(textOf(find(empty, "live-empty")), /No folders yet/);
  await press(find(empty, "live-connect"));
  const err = await mount(createRoot, <LiveFolders rows="error" busy={new Set()} said={null} onAction={() => undefined} onConnect={() => undefined} onRetry={() => done.push("retry")} />);
  await press(find(err, "live-retry"));
  await flush();
  assert.deepEqual(done.slice(2), ["c2", "retry"]);
});
