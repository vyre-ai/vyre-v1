// A file of a connected folder: the one quiet line it shows (view only, not yet sent, changed there too with its choice) and the provider's revisions in the History menu.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ConnectedBar } from "./ConnectedBar.tsx";
import { changedThereWords, providerRevisionRows } from "./model.ts";
import type { Connected } from "./model.ts";

installDom();
const NOW = 1_760_000_000_000;

test("a view only file says so before anyone types", async () => {
  const c: Connected = { provider: "Google Drive", viewOnly: true };
  const root = await mount(createRoot, <ConnectedBar connected={c} now={NOW} onChoose={() => undefined} />);
  assert.match(textOf(find(root, "file-connected-viewonly")), /View only\. You cannot change this at Google Drive\./);
});

test("a change that has not gone out is a small mark with the reason one press away", async () => {
  const c: Connected = {
    provider: "OneDrive",
    notSent: { reason: "OneDrive could not be reached. Vyre tries again by itself." },
  };
  const root = await mount(createRoot, <ConnectedBar connected={c} now={NOW} onChoose={() => undefined} />);
  assert.equal(textOf(find(root, "file-connected-notsent")).trim(), "Not yet at OneDrive");
  await press(find(root, "file-connected-notsent"));
  assert.match(textOf(find(root, "file-connected-notsent")), /could not be reached/);
});

test("a file that changed there too names who and when and offers Keep both and Use theirs", async () => {
  const c: Connected = {
    provider: "Google Drive",
    changedThere: { by: { name: "Kim Ito" }, at: NOW - 5 * 60_000 },
  };
  assert.equal(
    changedThereWords(c, NOW),
    "Kim Ito changed this at Google Drive too, 5 min ago. Your edit is kept here.",
  );
  assert.match(
    changedThereWords({ provider: "OneDrive", changedThere: {} }, NOW),
    /^Someone changed this at OneDrive too\./,
  );
  const chose: string[] = [];
  const root = await mount(createRoot, <ConnectedBar connected={c} now={NOW} onChoose={(x) => chose.push(x)} />);
  await press(find(root, "file-keep-both"));
  await press(find(root, "file-use-theirs"));
  assert.deepEqual(chose, ["keep_both", "use_theirs"]);
});

test("the provider's revisions list beside Vyre's versions, the current one marked and not restorable, an agent's edit named", () => {
  const rows = providerRevisionRows(
    [
      { revisionId: "r3", at: Date.UTC(2026, 10, 15, 9, 30), current: true, by: { name: "Kim Ito" } },
      {
        revisionId: "r2",
        at: Date.UTC(2026, 10, 14, 8, 0),
        current: false,
        by: { name: "Noah Berg", actor: "agt_scout" },
      },
      { revisionId: "r1", current: false },
    ],
    (id) => (id === "agt_scout" ? "Scout" : id),
    "Google Drive",
  );
  assert.deepEqual(rows, [
    { label: "Google Drive · Kim Ito · 2026-11-15 09:30 (now)", revisionId: null },
    { label: "Google Drive · Scout · 2026-11-14 08:00", revisionId: "r2" },
    { label: "Google Drive · Google Drive", revisionId: "r1" },
  ]);
});
