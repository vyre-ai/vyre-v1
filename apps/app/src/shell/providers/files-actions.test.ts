// @tsx
// Files' New folder, Rename and Upload (the doors that used to open a screen nobody read): each is a capability call, a name is required, and the file chooser feeds the same store the chat uses.
import test from "node:test";
import assert from "node:assert/strict";
import { newFolderIn, renameEntry, rootOf, uploadInto } from "./files-actions.ts";

const ROOTS = { roots: [{ key: "recent", kind: "recent" }, { key: "personal", kind: "folder", folderId: "fld_me" }, { key: "space", kind: "folder", folderId: "fld_space" }] };

function world() {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    if (cap === "files.tree") return ROOTS;
    if (cap === "files.folder.create") return { folder: { folderId: "fld_new" } };
    if (cap === "files.create") return { file: { fileId: `fil_${calls.length}` } };
    return {};
  };
  return { calls, call };
}

test("the top of a scope is its root folder; an unknown scope falls back to the Personal root", async () => {
  const w = world();
  assert.equal(await rootOf(w.call, "space"), "fld_space");
  assert.equal(await rootOf(w.call, "personal"), "fld_me");
  assert.equal(await rootOf(async () => ({ roots: [] }), "space"), null);
});

test("New folder makes a real folder in the open folder, or at the top of the scope when none is open, and needs a name", async () => {
  const w = world();
  assert.equal(await newFolderIn(w.call, "personal", "fld_open", "  Walk folder "), "fld_new");
  assert.deepEqual(w.calls.at(-1)?.input, { ...w.calls.at(-1)?.input, parentId: "fld_open", name: "Walk folder" });
  assert.ok(String(w.calls.at(-1)?.input["idempotencyKey"]).startsWith("files-folder:"));
  await newFolderIn(w.call, "space", null, "Top");
  assert.equal(w.calls.at(-1)?.input["parentId"], "fld_space");
  await assert.rejects(newFolderIn(w.call, "personal", "fld_open", "   "), /name/);
  assert.equal(await newFolderIn(async (cap) => (cap === "files.tree" ? { roots: [] } : {}), "personal", null, "x").catch((e: Error) => e.message), "There is no place to put it yet.");
});

test("Rename calls the file or the folder capability by what is renamed", async () => {
  const w = world();
  await renameEntry(w.call, "file", "fil_1", " New name.txt ");
  assert.deepEqual([w.calls.at(-1)?.cap, w.calls.at(-1)?.input["fileId"], w.calls.at(-1)?.input["name"]], ["files.rename", "fil_1", "New name.txt"]);
  await renameEntry(w.call, "folder", "fld_1", "Sales");
  assert.deepEqual([w.calls.at(-1)?.cap, w.calls.at(-1)?.input["folderId"]], ["files.folder.rename", "fld_1"]);
  await assert.rejects(renameEntry(w.call, "file", "fil_1", ""), /name/);
});

test("Upload opens the file chooser and stores what was chosen in the folder, or in the Personal root", async () => {
  const w = world();
  const g = globalThis as { document?: unknown };
  const before = g.document;
  const made: { onchange: (() => void) | null; files: unknown[] }[] = [];
  g.document = {
    createElement: () => { const el = { type: "", multiple: false, files: [] as unknown[], onchange: null as (() => void) | null, oncancel: null, click() { el.files = [{ name: "walk.txt", type: "text/plain", size: 5, arrayBuffer: async () => new TextEncoder().encode("hello").buffer }]; el.onchange?.(); } }; made.push(el); return el; },
    body: { appendChild: () => undefined, removeChild: () => undefined },
  };
  try {
    assert.equal(await uploadInto(w.call, undefined, "fld_open"), 1);
    const created = w.calls.filter((c) => c.cap === "files.create");
    assert.deepEqual([created[0]?.input["folderId"], created[0]?.input["name"]], ["fld_open", "walk.txt"]);
    assert.equal(made[0]?.files.length, 1);
    await uploadInto(w.call, undefined, null);
    assert.equal(w.calls.filter((c) => c.cap === "files.create").at(-1)?.input["folderId"], "fld_me");
  } finally { g.document = before; }
  g.document = undefined;
  assert.equal(await uploadInto(w.call, undefined, "fld_open"), 0, "no page, no chooser, nothing stored");
  g.document = before;
});
