// P-SEC_07: files.copy puts the source file's contents into a folder the caller can write, so the source needs its own explicit view allow. A restricted source, a hold and a context with no authorize
// all refuse and leave no copy behind; an allowed source copies.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

type World = ReturnType<typeof open>;

async function world(): Promise<{ w: World; secret: string; open: string; target: string }> {
  const w = open();
  const personal = (await handlers["files.tree"](w.ctx, {})).roots.find((r) => r.key === "personal")!.folderId!;
  const target = (await handlers["files.folder.create"](w.ctx, { parentId: personal, name: "Out" })).folder.folderId;
  const secret = (await handlers["files.create"](w.ctx, { folderId: personal, name: "secret.txt", content: { text: "restricted" } })).file.fileId;
  const plain = (await handlers["files.create"](w.ctx, { folderId: personal, name: "plain.txt", content: { text: "ok" } })).file.fileId;
  return { w, secret, open: plain, target };
}

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try { await run(); } catch (e) { return e instanceof VyreErr ? e.error.code : String(e); }
  return "none";
};

test("files.copy: a source the caller cannot view is refused and nothing is copied; an allowed source copies", async () => {
  const { w, secret, open: plain, target } = await world();
  const real = w.ctx.authorize;
  w.ctx.authorize = (a, r) => (r.id === secret ? { effect: "deny", reason: "restricted", decisionId: "dec_x" } : real(a, r));
  assert.equal(await code(() => handlers["files.copy"](w.ctx, { fileId: secret, toFolderId: target })), "permission.no_grant");
  const copied = await handlers["files.copy"](w.ctx, { fileId: plain, toFolderId: target });
  assert.equal(copied.file.name, "plain.txt");
  const names = w.db.rows("files_file").filter((r) => r["folder_id"] === target).map((r) => r["name"]);
  assert.deepEqual(names, ["plain.txt"], "the restricted file is not in the destination");
});

test("files.copy: a hold is a deny, and a context with no authorize refuses (fail closed)", async () => {
  const { w, secret, target } = await world();
  w.ctx.authorize = () => ({ effect: "hold", reason: "needs approval", decisionId: "dec_h" });
  assert.equal(await code(() => handlers["files.copy"](w.ctx, { fileId: secret, toFolderId: target })), "permission.no_grant");
  (w.ctx as { authorize?: unknown }).authorize = undefined;
  assert.equal(await code(() => handlers["files.copy"](w.ctx, { fileId: secret, toFolderId: target })), "permission.no_grant");
  assert.equal(w.db.rows("files_file").filter((r) => r["folder_id"] === target).length, 0);
});
