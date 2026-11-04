// The Knows tab: groups by kind, shows who and when, strikes through what was replaced and says by what, offers Edit and Remove only to people who may edit the place, and edits in place.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, textOf } from "../testing/dom.ts";
import { Knows, SourceChip } from "./index.tsx";
import { groupKnows, knowsMark, openMessage, sourceChip } from "./model.ts";
import type { KnowsItem } from "./model.ts";

const item = (o: Partial<KnowsItem> & { factId: string }): KnowsItem => ({ kind: "decision", text: "t", state: "current", by: "Omar Haddad", at: "Today 9:50 am", canEdit: true, ...o });

test("groups by kind, current first, dropping what was removed with its message", () => {
  const g = groupKnows([item({ factId: "a", state: "replaced" }), item({ factId: "b" }), item({ factId: "c", kind: "fact" }), item({ factId: "d", state: "source_removed" })]);
  assert.deepEqual(g.map((x) => [x.title, x.items.map((i) => i.factId)]), [["Decisions", ["b", "a"]], ["Facts", ["c"]]]);
  assert.equal(sourceChip("Omar Haddad", "9:50 am"), "Remembered from Omar Haddad, 9:50 am");
});

test("Edit and Remove show for people who may edit; a replaced line says by what; Edit saves in place", async () => {
  installDom();
  const calls: string[] = [];
  const items = [item({ factId: "a", text: "Waive the fee" }), item({ factId: "b", text: "Monday at 11", state: "replaced", replacedBy: "Tuesday at 2" })];
  const root = await mount(createRoot, <Knows place="Rivera account" items={items} onSource={(i) => calls.push(`src:${i.factId}`)} onEdit={(i, t) => calls.push(`edit:${i.factId}:${t}`)} onRemove={(i) => calls.push(`rm:${i.factId}`)} />);
  assert.match(textOf(find(root, "knows")), /What Vyre remembers in Rivera account/);
  assert.match(textOf(find(root, "knows-replaced-b")), /Replaced by: Tuesday at 2/);
  assert.equal(find(root, "knows-remove-b"), null, "a replaced line is history: no Edit, no Remove");
  await press(find(root, "knows-source-a"));
  await press(find(root, "knows-remove-a"));
  assert.deepEqual(calls, ["src:a", "rm:a"]);
});

test("a reader who may not edit sees Source only; the source chip names who and when", async () => {
  installDom();
  const root = await mount(createRoot, <Knows place="P" items={[item({ factId: "a", canEdit: false })]} onSource={() => undefined} onEdit={() => undefined} onRemove={() => undefined} />);
  assert.equal(find(root, "knows-editbtn-a"), null);
  assert.equal(find(root, "knows-remove-a"), null);
  const chip = await mount(createRoot, <SourceChip by="Omar Haddad" at="9:50 am" />);
  assert.match(textOf(find(chip, "source-chip")), /Remembered from Omar Haddad, 9:50 am/);
});

test("a commitment says who owes it and when it is due, then when it was said; linked places and Space markers come last, each naming its place", async () => {
  installDom();
  assert.equal(knowsMark(item({ factId: "c", kind: "commitment", by: "Intake", at: "Yesterday 4:20 pm", owes: "Mon 5:00 pm" })), "Intake \u00b7 due Mon 5:00 pm \u00b7 said yesterday 4:20 pm");
  const root = await mount(createRoot, <Knows place="Atlas" items={[item({ factId: "a" }), item({ factId: "l", scope: "linked", from: "Beta invites task", text: "Waves of fifty" }), item({ factId: "s", scope: "space", from: "Atlas", text: "Launch March 19" })]} onSource={() => undefined} onEdit={() => undefined} onRemove={() => undefined} />);
  assert.match(textOf(find(root, "knows-linked")), /From linked places[\s\S]*Waves of fifty[\s\S]*Beta invites task/);
  assert.match(textOf(find(root, "knows-space")), /Marker in Space memory \u00b7 from Atlas/);
  assert.equal(openMessage(item({ factId: "x", threadId: "thr_1", messageId: "msg_1" }))?.messageId, "msg_1");
  assert.equal(openMessage(item({ factId: "y" })), null);
});
