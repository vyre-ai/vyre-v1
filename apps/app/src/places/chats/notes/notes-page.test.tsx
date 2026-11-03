// The Notes page drawn over a scripted runtime: Pinned above Others, a pin and a delete reach the notes capabilities (the delete with Undo), Take a note saves what was typed and drops an
// empty one, the search narrows the grid, and the opened note offers its three actions.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { NotesPage } from "./NotesPage.tsx";
import { createNotesStore } from "./data.ts";
import type { Note } from "./model.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

const T0 = Date.UTC(2026, 10, 3, 4, 0);
const note = (id: string, o: Partial<Note> = {}): Note => ({
  noteId: id, owner: "usr_me", title: "", body: "", color: "", pinned: false, labels: [], hasImage: false, linked: [], share: { people: [], space: "off" }, mine: true, canEdit: true, createdAt: T0, updatedAt: T0, ...o,
});

function scripted(): { rt: ShellRuntime; calls: { cap: string; input: Record<string, unknown> }[] } {
  let rows: Note[] = [
    note("n1", { title: "Lab 8 run of show", pinned: true, labels: ["Lab 8"] }),
    note("n2", { title: "Weinberger intake call", body: "Joe wants PI leads routed by county", labels: ["Clients"] }),
    note("n3", { title: "GT+ pricing", labels: ["Sales"] }),
  ];
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown> & { noteId: string };
    calls.push({ cap, input: i });
    if (cap === "notes.list") return { notes: rows, labels: [{ name: "Lab 8", count: 1 }, { name: "Clients", count: 1 }, { name: "Sales", count: 1 }] };
    if (cap === "notes.pin") { rows = rows.map((n) => (n.noteId === i.noteId ? { ...n, pinned: i["pinned"] === true } : n)); return { note: rows.find((n) => n.noteId === i.noteId) }; }
    if (cap === "notes.delete") return { deleted: true, undo: { noteId: i.noteId } };
    if (cap === "notes.restore") return { note: rows.find((n) => n.noteId === i.noteId) };
    if (cap === "notes.create") { const made = note("n9", { title: String(i["title"] ?? ""), body: String(i["body"] ?? "") }); rows = [made, ...rows]; return { note: made }; }
    throw new Error(`no answer for ${cap}`);
  };
  const people = { status: "ready" as const, data: [{ id: "usr_me", name: "Irfad Imtiaz", kind: "person" as const }] };
  const rt = {
    call, me: { id: "usr_me", name: "Irfad Imtiaz" }, space: { id: "mla", kind: "team", name: "My Legal Academy" }, assistant: { id: "agt_assistant", name: "Assistant" },
    principals: { subscribe: () => () => undefined, getSnapshot: () => people }, clock: () => ({ now: T0 + 60_000, offsetMin: 300 }), open: () => undefined, openUrl: () => undefined,
  } as unknown as ShellRuntime;
  return { rt, calls };
}

const ids = (n: Node | string, prefix: string, out: string[] = []): string[] => {
  if (typeof n === "string") return out;
  const t = n.props["data-testid"] ?? n.props["testID"];
  if (typeof t === "string" && t.startsWith(prefix) && !out.includes(t)) out.push(t);
  for (const c of n.children ?? []) ids(c, prefix, out);
  return out;
};
const cardsIn = (root: Node, section: string): string[] => { const s = find(root, section); return s ? ids(s, "note-").filter((t) => /^note-n\d+$/.test(t)) : []; };

test("the grid: Pinned above Others, a pin and a delete with Undo reach the notes capabilities", async () => {
  installDom();
  const { rt, calls } = scripted();
  const store = createNotesStore((c, i) => rt.call(c, i), () => undefined, () => T0);
  const root = await mount(createRoot, <NotesPage rt={rt} nameOf={(id) => (id === "usr_me" ? "Irfad Imtiaz" : id)} store={store} />);
  await flush();
  assert.deepEqual(cardsIn(root, "notes-pinned"), ["note-n1"]);
  assert.deepEqual(cardsIn(root, "notes-others"), ["note-n2", "note-n3"]);
  assert.match(textOf(find(root, "notes-page")), /3 · private unless you share/);

  await press(find(root, "note-pin-n2"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "notes.pin").map((c) => c.input), [{ noteId: "n2", pinned: true }]);
  assert.deepEqual(cardsIn(root, "notes-pinned"), ["note-n1", "note-n2"], "a pinned note moves up at once");

  await press(find(root, "note-more-n3"));
  await flush();
  await press(find(root, "menu-item-Delete"));
  await flush();
  assert.ok(calls.some((c) => c.cap === "notes.delete" && c.input.noteId === "n3"));
  assert.deepEqual(cardsIn(root, "notes-others"), [], "the note leaves the grid");
  assert.match(textOf(find(root, "notes-bar")), /Note deleted/);
  await press(find(root, "notes-undo"));
  await flush();
  assert.ok(calls.some((c) => c.cap === "notes.restore" && c.input.noteId === "n3"));
  assert.deepEqual(cardsIn(root, "notes-others"), ["note-n3"], "Undo brings it back");
});

test("Take a note saves what was typed; an empty one is dropped; the search narrows the grid", async () => {
  installDom();
  const { rt, calls } = scripted();
  const store = createNotesStore((c, i) => rt.call(c, i), () => undefined, () => T0);
  const root = await mount(createRoot, <NotesPage rt={rt} nameOf={(id) => id} store={store} />);
  await flush();
  await press(find(root, "take-closed"));
  assert.ok(find(root, "take-open"), "the bar opens in place");
  await press(find(root, "take-close"));
  await flush();
  assert.equal(calls.filter((c) => c.cap === "notes.create").length, 0, "an empty note is dropped");
  assert.ok(find(root, "take-closed"));

  await press(find(root, "take-closed"));
  await typeInto(find(root, "take-title"), "JCS Law, Windows setup");
  await typeInto(find(root, "take-body"), "Send Josh the installer link.");
  await press(find(root, "take-close"));
  await flush();
  const made = calls.filter((c) => c.cap === "notes.create");
  assert.equal(made.length, 1);
  assert.equal(made[0]!.input["title"], "JCS Law, Windows setup");
  assert.equal(made[0]!.input["body"], "Send Josh the installer link.");
  assert.equal(typeof made[0]!.input["idempotencyKey"], "string");
  assert.ok(ids(root, "note-").includes("note-n9"), "the new note is in the grid");

  await typeInto(find(root, "notes-search"), "county");
  await flush();
  assert.deepEqual([...cardsIn(root, "notes-pinned"), ...cardsIn(root, "notes-others")], ["note-n2"]);
  await typeInto(find(root, "notes-search"), "nothing like it");
  await flush();
  assert.ok(find(root, "notes-no-match"));
});

test("an opened note offers Ask about this note, Turn into task and Turn into record", async () => {
  installDom();
  const { rt } = scripted();
  const store = createNotesStore((c, i) => rt.call(c, i), () => undefined, () => T0);
  const root = await mount(createRoot, <NotesPage rt={rt} nameOf={(id) => id} store={store} initial={{ open: "n2" }} />);
  await flush();
  const dialog = find(root, "note-dialog");
  assert.ok(dialog);
  for (const id of ["note-dialog-ask", "note-dialog-task", "note-dialog-record"]) assert.ok(find(dialog, id), id);
  await press(find(root, "note-dialog-close"));
  await flush();
  assert.equal(find(root, "note-dialog"), null);
});
