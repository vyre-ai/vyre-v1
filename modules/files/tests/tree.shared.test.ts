// The Shared with me count on the files.tree root (spec 2.4, 2.16, 3.5): it counts what access lists for the caller as shared, the same items files.shared_with_me returns, not a fixed 0.
// access answers through a scripted ctx.call; a caller with no grants sees 0, and an access failure does not take the tree down.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

type Row = Record<string, unknown>;

interface Access { sharedFiles: string[]; sharedFolders: string[] }

/** access.lists for the one caller who has grants; everybody else has none. */
function script(a: Access, grantee: string): (cap: string, input: unknown, who: string) => unknown {
  return (cap, input, who) => {
    const i = (input ?? {}) as Row;
    if (cap === "access.lists") {
      const ids = who !== grantee ? [] : i["type"] === "file" ? a.sharedFiles : a.sharedFolders;
      return { rows: ids.map((id) => ({ type: i["type"], id, title: id, via: "grant", level: "view", starred: false, following: false })), counts: {}, total: ids.length };
    }
    if (cap === "access.shares_of") return { shares: [{ grant: { createdAt: 0 }, through: "owner" }] };
    throw new Error(`unscripted call ${cap}`);
  };
}

const shared = async (ctx: Parameters<(typeof handlers)["files.tree"]>[0]): Promise<number> => {
  const tree = await handlers["files.tree"](ctx, {});
  const root = tree.roots.find((r) => r.key === "shared");
  assert.ok(root, "the Shared with me root is on the tree");
  assert.equal(root.kind, "virtual");
  return root.count;
};

test("the Shared with me root counts the caller's shared items: files and folders, not what a shared folder already holds, not trashed rows, not ids this module does not hold", async () => {
  const access: Access = { sharedFiles: [], sharedFolders: [] };
  const { ctx } = open(script(access, "per_maya"));
  assert.equal(await shared(ctx), 0, "nothing is shared yet");
  const personal = (await handlers["files.tree"](ctx, {})).roots.find((r) => r.key === "personal")!.folderId!;
  const folder = async (parentId: string, name: string): Promise<string> => (await handlers["files.folder.create"](ctx, { parentId, name })).folder.folderId;
  const file = async (folderId: string, name: string): Promise<string> => (await handlers["files.create"](ctx, { folderId, name, content: { text: name } })).file.fileId;
  const clients = await folder(personal, "Clients");
  const inside = await file(clients, "inside.txt");
  const a = await file(personal, "a.md");
  const b = await file(personal, "b.md");
  const gone = await file(personal, "gone.md");
  await handlers["files.delete"](ctx, { fileId: gone });

  access.sharedFiles = [inside, a];
  access.sharedFolders = [clients];
  assert.equal(await shared(ctx), 2, "a.md and Clients; inside.txt opens from the shared folder");
  access.sharedFiles = [inside, a, b, gone, "fil_notinfiles"];
  access.sharedFolders = [clients, "fld_notinfiles"];
  assert.equal(await shared(ctx), 3, "b.md joins; the trashed file and the unknown ids do not count");
  const list = await handlers["files.shared_with_me"](ctx, {});
  assert.equal(list.total, 3, "the root count is the list's total");
  access.sharedFiles = [];
  access.sharedFolders = [];
  assert.equal(await shared(ctx), 0, "unsharing takes it back to 0");
});

test("a caller without grants sees 0 whatever others share, and the other roots keep their own counts", async () => {
  const access: Access = { sharedFiles: [], sharedFolders: [] };
  const maya = open(script(access, "per_maya"), "per_maya");
  const omar = open(script(access, "per_maya"), "per_omar");
  for (const w of [maya, omar]) {
    const personal = (await handlers["files.tree"](w.ctx, {})).roots.find((r) => r.key === "personal")!.folderId!;
    const f = (await handlers["files.create"](w.ctx, { folderId: personal, name: "x.md", content: { text: "x" } })).file.fileId;
    if (w === maya) access.sharedFiles = [f];
  }
  assert.equal(await shared(maya.ctx), 1);
  assert.equal(await shared(omar.ctx), 0, "refused by access: nothing is listed for omar");
  const roots = (await handlers["files.tree"](maya.ctx, {})).roots;
  assert.equal(roots.find((r) => r.key === "personal")!.count, 1, "Personal still counts its own contents");
  assert.equal(roots.find((r) => r.key === "trash")!.count, 0);
});

test("when access cannot answer, the tree still loads and the Shared with me count is 0", async () => {
  const { ctx } = open((cap) => { throw new Error(`access is down: ${cap}`); });
  const tree = await handlers["files.tree"](ctx, {});
  assert.equal(tree.roots.length, 13, "every root is still there");
  assert.equal(tree.roots.find((r) => r.key === "shared")!.count, 0);
});
