// Share a note through the one Access sheet: the rows a note's shares make, the notes.share patch each choice means, and the levels a note offers (View and Edit, never Manage).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { notePatchOf, noteShareRows } from "./model.ts";
import type { Note, Who } from "./model.ts";
import { ShareSheet } from "./NoteSheets.tsx";
import type { Person } from "./NoteSheets.tsx";

const T0 = Date.UTC(2026, 10, 3, 4, 0);
const names: Record<string, string> = { usr_me: "Irfad", usr_omar: "Omar Reyes", usr_sara: "Sara Malik" };
const who: Who = { meId: "usr_me", nameOf: (id) => names[id] ?? id, spaceName: "Northwind" };
const people: Person[] = [{ id: "usr_me", name: "Irfad", kind: "person" }, { id: "usr_omar", name: "Omar Reyes", kind: "person" }, { id: "usr_sara", name: "Sara Malik", kind: "person" }, { id: "agt_a", name: "Scout", kind: "agent" }];
const note = (o: Partial<Note> = {}): Note => ({
  noteId: "not_1", owner: "usr_me", title: "Lab 8 run of show", body: "", color: "", pinned: false, labels: [], hasImage: false, linked: [], share: { people: [{ personId: "usr_omar", role: "view" }], space: "off" },
  mine: true, canEdit: true, createdAt: T0, updatedAt: T0, ...o,
} as Note);

test("rows: each person at their role, and the Space as Everyone only when it is open", () => {
  assert.deepEqual(noteShareRows(note(), who.nameOf).map((r) => [r.subjectKind, r.subjectId, r.level]), [["person", "usr_omar", "view"]]);
  const open = noteShareRows(note({ share: { people: [], space: "edit" } }), who.nameOf);
  assert.deepEqual(open.map((r) => [r.subjectKind, r.subjectId, r.level]), [["group", "grp_everyone", "edit"]]);
});

test("patches: a person is a role or a removal, Everyone is the Space, anything else is not a note share", () => {
  assert.deepEqual(notePatchOf({ subject: { kind: "person", id: "usr_omar" }, level: "edit" }), { people: [{ personId: "usr_omar", role: "edit" }] });
  assert.deepEqual(notePatchOf({ subject: { kind: "person", id: "usr_omar" } }, true), { people: [{ personId: "usr_omar", role: "remove" }] });
  assert.deepEqual(notePatchOf({ subject: { kind: "group", id: "grp_everyone" }, level: "view" }), { space: "view" });
  assert.deepEqual(notePatchOf({ subject: { kind: "group", id: "grp_everyone" } }, true), { space: "off" });
  assert.equal(notePatchOf({ subject: { kind: "agent", id: "agt_a" }, level: "view" }), null);
  assert.equal(notePatchOf({ subject: { kind: "group", id: "grp_fin" }, level: "view" }), null);
});

async function open(n: Note) {
  const patches: unknown[] = [];
  const root = createRoot();
  await act(async () => { root.render(<ShareSheet n={n} who={who} people={people} onShare={(p) => patches.push(p)} onClose={() => undefined} />); });
  await flush();
  return { patches, tree: root.container as unknown as Parameters<typeof find>[0] };
}

test("the sheet: title, the owner once, Omar at Can view, General access, and no agent is offered", async () => {
  const restore = installDom();
  try {
    const s = await open(note());
    const text = textOf(s.tree);
    for (const word of ["Lab 8 run of show", "General access", "Everyone in Northwind", "Irfad", "Owner", "Omar Reyes", "Can view"]) assert.ok(text.includes(word), word);
    assert.ok(!text.includes("Scout"), "agents read what their person can see: none to pick");
  } finally { restore(); }
});

test("a change and a removal are one notes.share patch each, and Manage is not offered", async () => {
  const restore = installDom();
  try {
    const s = await open(note());
    await press(find(s.tree, "as-acc-level-usr_omar"));
    assert.ok(find(s.tree, "menu-item-Can manage") === null, "a note has no Manage");
    await press(find(s.tree, "menu-item-Can edit"));
    await press(find(s.tree, "as-acc-remove-usr_omar"));
    await flush();
    assert.deepEqual(s.patches, [{ people: [{ personId: "usr_omar", role: "edit" }] }, { people: [{ personId: "usr_omar", role: "remove" }] }]);
  } finally { restore(); }
});

test("General access sets the Space: Can edit, then No access", async () => {
  const restore = installDom();
  try {
    const s = await open(note({ share: { people: [], space: "view" } }));
    await press(find(s.tree, "as-acc-level-space"));
    await press(find(s.tree, "menu-item-Can edit"));
    await press(find(s.tree, "as-acc-level-space"));
    await press(find(s.tree, "menu-item-No access"));
    await flush();
    assert.deepEqual(s.patches, [{ space: "edit" }, { space: "off" }]);
  } finally { restore(); }
});

test("a reader of someone else's note can give nothing above View", async () => {
  const restore = installDom();
  try {
    const s = await open(note({ owner: "usr_omar", mine: false, share: { people: [{ personId: "usr_me", role: "edit" }, { personId: "usr_sara", role: "view" }], space: "off" } }));
    await press(find(s.tree, "as-acc-level-usr_sara"));
    assert.ok(find(s.tree, "menu-item-Can edit") === null, "a person gives no more than they have");
  } finally { restore(); }
});
