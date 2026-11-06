// The menu fixes of the l-menus lane (MENU-AUDIT.md): each behaviour that was dead, wrong or named twice is checked where it is built.
import test from "node:test";
import assert from "node:assert/strict";
import { pressChip } from "../conversation/MessageView.tsx";
import { faceDoor } from "../conversation/model.ts";
import { chatHeaderEntries } from "../conversation/chat-header-menu.ts";
import { chatMenu } from "./chat.ts";
import { openFace } from "../mounts/data.ts";
import { tabMenuEntries } from "../../../../../../ui/src/TabStrip/index.tsx";
import { moveTargets } from "../../files/tree/model.ts";
import { versionRows } from "../../files/viewer/model.ts";
import { brandPatch, DEFAULT_EMAIL_STYLE } from "../../../../../../ui/src/EmailBuilder/index.tsx";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const labels = (e: readonly MenuEntry[]): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));
const rows = (e: readonly MenuEntry[]): MenuItem[] => e.filter((x): x is MenuItem => !("separator" in x) && !("head" in x));

test("the reaction chip toggles: it adds yours when you have not reacted and takes it back when you have", () => {
  const sent: string[] = [];
  const a = { react: (id: string, emoji: string, remove: boolean) => void sent.push(`${id}:${emoji}:${remove ? "remove" : "add"}`) };
  pressChip(a, "m1", "✅", ["usr_maya", "agt_mira"], "usr_me");
  pressChip(a, "m1", "✅", ["usr_maya", "usr_me"], "usr_me");
  assert.deepEqual(sent, ["m1:✅:add", "m1:✅:remove"]);
});

test("a face opens by what it is: a person's profile, an agent's page, a helper's chat", () => {
  const opened: string[] = [];
  const rt = { open: (t: { subject?: { type: string; id: string } }) => void opened.push(`${t.subject?.type}:${t.subject?.id}`) } as never;
  const go = { agent: (id: string) => void opened.push(`agent-page:${id}`) } as never;
  const list = [{ id: "usr_maya", name: "Maya", kind: "person" }, { id: "agt_mira", name: "Mira", kind: "agent" }] as never;
  openFace(rt, go, list, "usr_maya");
  openFace(rt, go, list, "agt_mira");
  assert.deepEqual(opened, ["contact:usr_maya", "agent-page:agt_mira"]);
  assert.equal(faceDoor(["thr_helper1"], "thr_helper1"), "helper");
  assert.equal(faceDoor(["thr_helper1"], "agt_mira"), "principal");
});

test("the chat header menu is the sidebar row menu's own builder: Rename, Star, Mute, Archive and Delete, each calling what it says; no Open, no Mark as Read", () => {
  const calls: string[] = [];
  const d = { rename: () => calls.push("rename"), star: (on: boolean) => calls.push(`star:${on}`), mute: (on: boolean) => calls.push(`mute:${on}`), archive: () => calls.push("archive"), unarchive: () => calls.push("unarchive"), leave: () => calls.push("leave"), remove: () => calls.push("remove"), addPeople: () => calls.push("add"), copyLink: () => calls.push("link") };
  const e = chatHeaderEntries({ starred: false, muted: false, archived: false, withPeople: false }, d);
  assert.deepEqual(labels(e), ["Rename", "Star", "Mute", "-", "Add People…", "Copy link", "-", "Archive", "-", "Delete chat"]);
  for (const x of rows(e)) x.onSelect?.();
  assert.deepEqual(calls, ["rename", "star:true", "mute:true", "add", "link", "archive", "remove"]);
  assert.deepEqual(labels(chatHeaderEntries({ starred: true, muted: true, archived: true, withPeople: true }, d)), ["Rename", "Remove star", "Unmute", "-", "Add People…", "Copy link", "-", "Unarchive", "-", "Leave chat"]);
  // the same items, in the same words, as the row menu
  const side = labels(chatMenu({ starred: false, unread: false, local: false, archived: false, withPeople: false, muted: false }, { open() {}, rename() {}, star() {}, markRead() {}, markUnread() {}, mute() {}, archive() {}, unarchive() {}, leave() {}, remove() {}, addPeople() {}, copyLink() {} }));
  for (const word of labels(e).filter((l) => l !== "-")) assert.ok(side.includes(word), `${word} is in the row menu too`);
});

test("a tab strip whose tabs cannot be closed offers no Close items (they did nothing); one that can still has all three", () => {
  const tabs = [{ key: "a", title: "A" }, { key: "b", title: "B" }];
  assert.deepEqual(labels(tabMenuEntries(tabs, "a", [], () => undefined, false)), []);
  assert.deepEqual(labels(tabMenuEntries(tabs, "a", [], () => undefined)), ["Close Tab", "Close Other Tabs", "Close All Tabs"]);
  assert.deepEqual(labels(tabMenuEntries(tabs, "a", [{ label: "Rename" }], () => undefined, false)), ["Rename"], "extras stand alone, with no divider before nothing");
});

test("Move on a folder lists the top of Files and the other top folders, never the folder itself", () => {
  const t = moveTargets([{ folderId: "f1", name: "Billing" }, { folderId: "f2", name: "Clients" }], "f1");
  assert.deepEqual(t, [{ label: "Top of Files", to: null }, { label: "Clients", to: "f2" }]);
});

test("the viewer's History lists versions newest first; the current one is marked and cannot be restored, the others can", () => {
  const r = versionRows([{ versionId: "v3", n: 3, by: "usr_a", at: Date.UTC(2026, 10, 6, 9, 5) }, { versionId: "v2", n: 2, by: "usr_b", at: Date.UTC(2026, 10, 5, 8, 0), reason: "Edited" }], (id) => (id === "usr_a" ? "Ava" : "Ben"));
  assert.deepEqual(r.map((x) => x.label), ["v3 (now) · Ava · 2026-11-06 09:05", "v2 · Ben · 2026-11-05 08:00 · Edited"]);
  assert.deepEqual(r.map((x) => x.versionId), [null, "v2"]);
});

test("Use brand sets the brand's font and its colour on links and the button; a colour that is not a hex is left out", () => {
  const p = brandPatch(DEFAULT_EMAIL_STYLE, { color: "#112233", font: "Georgia" });
  assert.equal(p.font, "Georgia");
  assert.equal(p.colors?.links, "#112233");
  assert.equal(p.colors?.button, "#112233");
  assert.equal(p.colors?.text, DEFAULT_EMAIL_STYLE.colors.text, "the other colours stay");
  assert.equal(brandPatch(DEFAULT_EMAIL_STYLE, { color: "teal", font: "Georgia" }).colors?.button, DEFAULT_EMAIL_STYLE.colors.button);
});
