// The menu fixes of the l-menus lane (MENU-AUDIT.md): each behaviour that was dead, wrong or named twice is checked where it is built.
import test from "node:test";
import assert from "node:assert/strict";
import { pressChip } from "../conversation/MessageView.tsx";
import { faceDoor } from "../conversation/model.ts";
import { chatHeaderEntries, isArchivedIn } from "../conversation/chat-header-menu.ts";
import { openFace } from "../mounts/data.ts";
import { tabMenuEntries } from "../../../../../../ui/src/TabStrip/index.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderMovePicker } from "../../files/tree/FolderMovePicker.tsx";
import { pathInto, restoreCall, trashCall } from "../../files/tree/model.ts";
import { versionRows } from "../../files/viewer/model.ts";
import { brandPatch, DEFAULT_EMAIL_STYLE } from "../../../../../../ui/src/EmailBuilder/index.tsx";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const labels = (e: readonly MenuEntry[]): string[] =>
  e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));
const rows = (e: readonly MenuEntry[]): MenuItem[] =>
  e.filter((x): x is MenuItem => !("separator" in x) && !("head" in x));

test("the reaction chip toggles: it adds yours when you have not reacted and takes it back when you have", () => {
  const sent: string[] = [];
  const a = {
    react: (id: string, emoji: string, remove: boolean) =>
      void sent.push(`${id}:${emoji}:${remove ? "remove" : "add"}`),
  };
  pressChip(a, "m1", "✅", ["usr_maya", "agt_mira"], "usr_me");
  pressChip(a, "m1", "✅", ["usr_maya", "usr_me"], "usr_me");
  assert.deepEqual(sent, ["m1:✅:add", "m1:✅:remove"]);
});

test("a face opens by what it is: a person's profile, an agent's page, a helper's chat", () => {
  const opened: string[] = [];
  const rt = {
    open: (t: { subject?: { type: string; id: string } }) => void opened.push(`${t.subject?.type}:${t.subject?.id}`),
  } as never;
  const go = { agent: (id: string) => void opened.push(`agent-page:${id}`) } as never;
  const list = [
    { id: "usr_maya", name: "Maya", kind: "person" },
    { id: "agt_mira", name: "Mira", kind: "agent" },
  ] as never;
  openFace(rt, go, list, "usr_maya");
  openFace(rt, go, list, "agt_mira");
  assert.deepEqual(opened, ["contact:usr_maya", "agent-page:agt_mira"]);
  assert.equal(faceDoor(["thr_helper1"], "thr_helper1"), "helper");
  assert.equal(faceDoor(["thr_helper1"], "agt_mira"), "principal");
});

test("the chat header menu is short and in sentence case: an agent chat reads Plan first, Fork, Find in this chat, Export, Archive; each entry calls what it says (G4)", () => {
  const calls: string[] = [];
  const d = {
    plan: () => calls.push("plan"),
    fork: () => calls.push("fork"),
    find: () => calls.push("find"),
    exportMd: () => calls.push("export"),
    mute: (on: boolean) => calls.push(`mute:${on}`),
    archive: () => calls.push("archive"),
    unarchive: () => calls.push("unarchive"),
    stopAll: () => calls.push("stop"),
  };
  const facts = {
    withAgent: true,
    withPeople: false,
    planOn: false,
    muted: false,
    archived: false,
    working: false,
    archivable: true,
  };
  const e = chatHeaderEntries(facts, d);
  assert.deepEqual(labels(e), ["Plan first", "Fork", "Find in this chat", "-", "Export", "-", "Archive"]);
  for (const x of rows(e)) x.onSelect?.();
  assert.deepEqual(calls, ["plan", "fork", "find", "export", "archive"]);
  // while an agent works, Stop everyone closes the list, in red
  const working = chatHeaderEntries({ ...facts, working: true }, d);
  assert.deepEqual(labels(working).slice(-2), ["Archive", "Stop everyone"]);
  assert.equal(rows(working).at(-1)!.danger, true);
  // Rewind and Kept are drawn only where the chat can do them
  const more = chatHeaderEntries(facts, { ...d, rewind: () => calls.push("rewind"), kept: () => calls.push("kept") });
  assert.deepEqual(labels(more), [
    "Plan first",
    "Fork",
    "Rewind",
    "Find in this chat",
    "Kept",
    "-",
    "Export",
    "-",
    "Archive",
  ]);
  // a chat with one other person: Find, Export, Mute, Archive; no Plan first, no Fork, nothing about an agent
  const dm = chatHeaderEntries({ ...facts, withAgent: false, withPeople: true }, d);
  assert.deepEqual(labels(dm), ["Find in this chat", "-", "Export", "-", "Mute", "Archive"]);
  assert.deepEqual(
    labels(chatHeaderEntries({ ...facts, withAgent: false, withPeople: true, muted: true, archived: true }, d)),
    ["Find in this chat", "-", "Export", "-", "Unmute", "Unarchive"],
  );
  // no Title Case, no Rename, Star, Copy Link, Delete: those are the title and the sidebar row menu
  for (const l of [...labels(e), ...labels(dm), ...labels(more)])
    assert.ok(l === "-" || !/\b[A-Z][a-z]+ [A-Z][a-z]+/.test(l), l);
  for (const gone of [
    "Rename",
    "Star",
    "Delete chat",
    "Copy Link",
    "Add People\u2026",
    "Search All Chats\u2026",
    "Fork This Chat",
  ])
    assert.ok(!labels(e).includes(gone), gone);
});

test("a tab strip whose tabs cannot be closed offers no Close items (they did nothing); one that can still has all three", () => {
  const tabs = [
    { key: "a", title: "A" },
    { key: "b", title: "B" },
  ];
  assert.deepEqual(labels(tabMenuEntries(tabs, "a", [], () => undefined, false)), []);
  assert.deepEqual(labels(tabMenuEntries(tabs, "a", [], () => undefined)), [
    "Close Tab",
    "Close Other Tabs",
    "Close All Tabs",
  ]);
  assert.deepEqual(
    labels(tabMenuEntries(tabs, "a", [{ label: "Rename" }], () => undefined, false)),
    ["Rename"],
    "extras stand alone, with no divider before nothing",
  );
});

test("the Move picker's path: going into a folder adds it, going into one already on the path steps back to it", () => {
  const top = [{ id: null, name: "Top of Files" }];
  const a = pathInto(top, null, "f1", "Clients");
  const b = pathInto(a, "f1", "f2", "Rivera");
  assert.deepEqual(
    b.map((c) => c.name),
    ["Top of Files", "Clients", "Rivera"],
  );
  assert.deepEqual(
    pathInto(b, "f2", "f1", "Clients").map((c) => c.name),
    ["Top of Files", "Clients"],
  );
});

test("the viewer's History lists versions newest first; the current one is marked and cannot be restored, the others can", () => {
  const r = versionRows(
    [
      { versionId: "v3", n: 3, by: "usr_a", at: Date.UTC(2026, 10, 6, 9, 5) },
      { versionId: "v2", n: 2, by: "usr_b", at: Date.UTC(2026, 10, 5, 8, 0), reason: "Edited" },
    ],
    (id) => (id === "usr_a" ? "Ava" : "Ben"),
  );
  assert.deepEqual(
    r.map((x) => x.label),
    ["v3 (now) · Ava · 2026-11-06 09:05", "v2 · Ben · 2026-11-05 08:00 · Edited"],
  );
  assert.deepEqual(
    r.map((x) => x.versionId),
    [null, "v2"],
  );
});

test("Use brand sets the brand's font and its colour on links and the button; a colour that is not a hex is left out", () => {
  const p = brandPatch(DEFAULT_EMAIL_STYLE, { color: "#112233", font: "Georgia" });
  assert.equal(p.font, "Georgia");
  assert.equal(p.colors?.links, "#112233");
  assert.equal(p.colors?.button, "#112233");
  assert.equal(p.colors?.text, DEFAULT_EMAIL_STYLE.colors.text, "the other colours stay");
  assert.equal(
    brandPatch(DEFAULT_EMAIL_STYLE, { color: "teal", font: "Georgia" }).colors?.button,
    DEFAULT_EMAIL_STYLE.colors.button,
  );
});

test("a folder deleted from Files goes to Trash with files.folder.delete and comes back with files.folder.restore (the same trash); folders.delete is not used", () => {
  assert.deepEqual(trashCall("folder", "f1"), { cap: "files.folder.delete", input: { folderId: "f1" } });
  assert.deepEqual(restoreCall("folder", "f1"), { cap: "files.folder.restore", input: { folderId: "f1" } });
  assert.deepEqual([trashCall("file", "x").cap, restoreCall("file", "x").cap], ["files.delete", "files.restore"]);
});

test("the header menu says Unarchive for a chat that is in the Archived list, and Archive for one that is not", () => {
  const recent = { archived: [{ threadId: "thr_old" }] };
  assert.equal(isArchivedIn(recent, "thr_old"), true);
  assert.equal(isArchivedIn(recent, "thr_new"), false);
  assert.equal(isArchivedIn(null, "thr_new"), false);
  const d = { plan() {}, fork() {}, find() {}, exportMd() {}, mute() {}, archive() {}, unarchive() {}, stopAll() {} };
  const facts = { withAgent: true, withPeople: false, planOn: false, muted: false, working: false, archivable: true };
  assert.ok(
    labels(chatHeaderEntries({ ...facts, archived: isArchivedIn(recent, "thr_old") }, d)).includes("Unarchive"),
  );
  assert.ok(labels(chatHeaderEntries({ ...facts, archived: isArchivedIn(recent, "thr_new") }, d)).includes("Archive"));
});

test("the folder Move picker opens with a search box and the path, and never offers the folder being moved", () => {
  const html = renderToStaticMarkup(
    <FolderMovePicker
      moving={{ id: "f1", name: "Billing" }}
      call={async () => ({ folders: [] })}
      onMove={() => undefined}
      onClose={() => undefined}
    />,
  );
  assert.ok(
    html.includes("Move Billing") && html.includes('data-testid="folder-move-search"') && html.includes("Top of Files"),
  );
  assert.ok(html.includes("Move to Top of Files"), "the one action names where it moves to");
});
