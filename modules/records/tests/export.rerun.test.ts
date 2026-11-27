// records.export's file writer run twice with the same trace (an outer layer that runs the call again): the second run finds the first run's file in the folder listing, asks for the next free name under its own key, and
// never meets an idempotency conflict; a repeat of the very same name replays the same file.
import test from "node:test";
import assert from "node:assert/strict";
import { filesPort } from "../handlers/merge.ts";

function files() {
  const made = new Map<string, { id: string; name: string }>(); // by idempotency key
  const names = new Set<string>();
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as { name?: string; idempotencyKey?: string; folder?: string; parentId?: string };
    if (cap === "files.tree") return { roots: [{ key: "personal", folderId: "fld_root" }] };
    if (cap === "files.list")
      return i.folder === "fld_root"
        ? { folders: [{ folderId: "fld_exports", name: "Exports" }] }
        : { files: [...names].map((name) => ({ name })) };
    if (cap === "files.create") {
      const key = String(i.idempotencyKey);
      const had = made.get(key);
      if (had) {
        if (had.name !== i.name)
          throw Object.assign(new Error("idempotency_conflict"), {
            error: { code: "validation.idempotency_conflict" },
          });
        return { file: { fileId: had.id } };
      }
      if (names.has(String(i.name)))
        throw Object.assign(new Error("duplicate"), { error: { code: "validation.duplicate" } });
      names.add(String(i.name));
      const id = `fil_${made.size + 1}`;
      made.set(key, { id, name: String(i.name) });
      return { file: { fileId: id } };
    }
    throw new Error(`unexpected ${cap}`);
  };
  return { call, names };
}

test("the writer run again with the same trace never meets an idempotency conflict: it makes the next free name, and the same name replays the same file", async () => {
  const f = files();
  const put = filesPort(f.call, "t".repeat(32));
  const first = await put({ name: "contact-2026-11-26.csv", mime: "text/csv", bytes: new Uint8Array([1]) });
  // the outer layer runs the call again: the listing now shows the first run's file
  const second = await put({ name: "contact-2026-11-26.csv", mime: "text/csv", bytes: new Uint8Array([1]) });
  assert.notEqual(second, first, "a second file, not an error");
  assert.deepEqual([...f.names].sort(), ["contact-2026-11-26 (2).csv", "contact-2026-11-26.csv"]);
  // a third run with a fresh trace is just another export
  const third = await filesPort(
    f.call,
    "u".repeat(32),
  )({ name: "contact-2026-11-26.csv", mime: "text/csv", bytes: new Uint8Array([1]) });
  assert.ok(third && third !== first && third !== second);
  assert.equal(f.names.size, 3);
});
