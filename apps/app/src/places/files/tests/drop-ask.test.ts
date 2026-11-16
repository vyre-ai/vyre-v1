// A drop in the tree asks the same question the list asks: the tree reads where each dragged file is (files.get), a dragged folder is one it has drawn, and a drop that crosses a connected folder's edge comes back as an ask.
import test from "node:test";
import assert from "node:assert/strict";
import { planTreeDrop } from "../tree/drop-ask.ts";
import type { Line } from "../tree/model.ts";

const file = (fileId: string, folderId: string, provider?: string): unknown => ({
  file: {
    fileId,
    folderId,
    name: `${fileId}.docx`,
    kind: "document",
    mime: "application/x",
    size: 1,
    updatedAt: 1,
    updatedBy: null,
    thumb: false,
    ...(provider ? { source: { provider, mountId: "mnt_1" } } : {}),
  },
});
const call =
  (rows: Record<string, unknown>) =>
  async (cap: string, input: unknown): Promise<unknown> => {
    assert.equal(cap, "files.get");
    const id = (input as { fileId: string }).fileId;
    if (!(id in rows)) throw new Error("gone");
    return rows[id];
  };

test("a file dragged out of a connected folder onto a local one is an ask, with the copy as the other answer", async () => {
  const plan = await planTreeDrop(
    call({ a: file("a", "fo_drive", "google_drive") }),
    "file:a",
    { id: "fo_local", source: null },
    new Map(),
  );
  assert.equal(plan.ask?.dir, "out");
  assert.equal(plan.ask?.moves.length, 1);
  assert.equal(plan.ask?.copies[0]?.cap, "files.copy");
});

test("a local file dropped onto a connected folder is an ask about the upload; onto a local folder it just moves", async () => {
  const rows = { b: file("b", "fo_local") };
  const into = await planTreeDrop(call(rows), "file:b", { id: "fo_drive", source: "google_drive" }, new Map());
  assert.equal(into.ask?.dir, "in");
  const plain = await planTreeDrop(call(rows), "file:b", { id: "fo_other", source: null }, new Map());
  assert.equal(plain.ask, null);
  assert.equal(plain.planned.length, 1);
});

test("a file already in the folder stays put, and a file that cannot be read is moved without asking", async () => {
  const there = await planTreeDrop(call({ c: file("c", "fo_x") }), "file:c", { id: "fo_x", source: null }, new Map());
  assert.equal(there.planned.length, 0);
  const unread = await planTreeDrop(call({}), "file:zzz", { id: "fo_x", source: null }, new Map());
  assert.equal(unread.ask, null);
  assert.equal(unread.planned.length, 1);
});

test("a folder dragged out of a connected folder is an ask too", async () => {
  const known = new Map<string, Line>([
    [
      "fo_sub",
      {
        key: "folder:fo_sub",
        type: "folder",
        id: "fo_sub",
        name: "Sub",
        kind: "folder",
        size: 0,
        updatedAt: 0,
        updatedBy: null,
        thumb: false,
        source: "google_drive",
        items: 0,
        folderId: "fo_drive",
      },
    ],
  ]);
  const plan = await planTreeDrop(call({}), "folder:fo_sub", { id: "fo_local", source: null }, known);
  assert.equal(plan.ask?.dir, "out");
  assert.deepEqual(plan.ask?.copies, [], "a folder has no copy answer");
});
