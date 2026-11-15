// F77, the same class as an agent's erase: a file deleted for good takes what hung on it (comments, marks, review and changeset rows), and a folder in Trash can be deleted for good, with everything under it.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

const h = handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<any>>;
const run = (w: ReturnType<typeof open>, sql: string, ...a: unknown[]) => w.ctx.db.run(sql, ...a);

test("a file deleted for good takes its comments, marks and changeset rows with it", async () => {
  const w = open();
  run(w, "INSERT INTO files_file (id, folder_id, name, deleted_at) VALUES (?, ?, ?, ?)", "fil_x", "fld_a", "x.txt", 1);
  run(w, "INSERT INTO files_trash (id, kind, root_id, deleted_at) VALUES (?, ?, ?, ?)", "fil_x", "file", "fil_x", 1);
  run(w, "INSERT INTO files_comment (id, file_id) VALUES (?, ?)", "cmt_1", "fil_x");
  run(w, "INSERT INTO files_mark (id, target_id) VALUES (?, ?)", "mrk_1", "fil_x");
  run(w, "INSERT INTO files_changeset_file (changeset_id, file_id) VALUES (?, ?)", "chg_1", "fil_x");
  run(w, "INSERT INTO files_changeset (id) VALUES (?)", "chg_1");
  assert.deepEqual(await h["files.purge"]!(w.ctx, { fileId: "fil_x" }), { purged: true });
  for (const t of ["files_comment", "files_mark", "files_changeset_file", "files_changeset"])
    assert.equal(w.db.rows(t).length, 0, `${t} is empty`);
});

test("a folder in Trash is deleted for good with everything under it, and says whose folder it was", async () => {
  const w = open();
  run(
    w,
    "INSERT INTO files_folder (id, parent_id, name, path, system_key, deleted_at) VALUES (?, ?, ?, ?, ?, ?)",
    "fld_ag",
    null,
    "Desk",
    "Agents/Desk",
    "agent:agt_desk",
    1,
  );
  run(
    w,
    "INSERT INTO files_file (id, folder_id, name, deleted_at) VALUES (?, ?, ?, ?)",
    "fil_y",
    "fld_ag",
    "AGENT.md",
    1,
  );
  run(
    w,
    "INSERT INTO files_trash (id, kind, root_id, deleted_at) VALUES (?, ?, ?, ?)",
    "fld_ag",
    "folder",
    "fld_ag",
    1,
  );
  assert.deepEqual(await h["files.folder.purge"]!(w.ctx, { folderId: "fld_ag" }), { purged: true });
  assert.equal(w.db.rows("files_folder").filter((r) => r["id"] === "fld_ag").length, 0);
  assert.equal(w.db.rows("files_file").filter((r) => r["id"] === "fil_y").length, 0);
  const ev = w.events.find((e) => e.name === "folder.purged");
  assert.deepEqual(ev?.payload, { folderId: "fld_ag", subjectKind: "agent", subjectId: "agt_desk" });
});
