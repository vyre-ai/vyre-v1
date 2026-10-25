// Files lists (P-L4_10; spec 2.4, 2.16, 3.5): Shared with me lists only what access grants the caller, newest share first, without repeating what a shared folder already holds; Knowledge shows the readable
// shared knowledge plus the Memory and Graph entries; Recent and Trash list what tree.ts keeps. access and memory answer through a scripted ctx.call.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /modules/files/handlers/lists.ts
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

type Row = Record<string, unknown>;

async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.message : "throw");
    assert.equal(e.error.code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

function idOf(v: string | undefined, label: string): string {
  if (typeof v !== "string" || v.length === 0) assert.fail(label);
  return v;
}

/** What the scripted access module knows: ids shared with the caller, ids the caller may read, and when each share was made. */
interface Access {
  sharedFiles: string[];
  sharedFolders: string[];
  readableFiles: string[];
  readableFolders: string[];
  sharedAt: Record<string, number>;
}

function accessScript(a: Access, extra: (cap: string, input: unknown) => unknown = () => undefined): (cap: string, input: unknown) => unknown {
  const row = (type: string, id: string): Row => ({ type, id, title: id, via: "grant", level: "view", starred: false, following: false });
  return (cap, input) => {
    const i = (input ?? {}) as Row;
    if (cap === "access.lists") {
      const ids = i["section"] === "shared"
        ? (i["type"] === "file" ? a.sharedFiles : a.sharedFolders)
        : (i["type"] === "file" ? a.readableFiles : a.readableFolders);
      return { rows: ids.map((id) => row(String(i["type"]), id)), counts: {}, total: ids.length };
    }
    if (cap === "access.shares_of") {
      const res = i["resource"] as { id: string };
      const at = a.sharedAt[res.id] ?? 0;
      return { shares: [{ grant: { createdAt: 0 }, through: "owner" }, ...(at > 0 ? [{ grant: { createdAt: at }, through: "direct" }] : [])] };
    }
    const other = extra(cap, input);
    if (other === undefined) throw new Error(`unscripted call ${cap}`);
    return other;
  };
}

test("Shared with me lists only granted items, newest share first, and not what a shared folder already holds", async () => {
  const access: Access = { sharedFiles: [], sharedFolders: [], readableFiles: [], readableFolders: [], sharedAt: {} };
  const { ctx, calls } = open(accessScript(access));
  const tree = await handlers["files.tree"](ctx, {});
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");

  const clients = (await handlers["files.folder.create"](ctx, { parentId: personal, name: "Clients" })).folder.folderId;
  const sub = (await handlers["files.folder.create"](ctx, { parentId: clients, name: "Sub" })).folder.folderId;
  const other = (await handlers["files.folder.create"](ctx, { parentId: personal, name: "Other" })).folder.folderId;
  const make = async (folderId: string, name: string): Promise<string> => (await handlers["files.create"](ctx, { folderId, name, content: { text: name } })).file.fileId;
  const inside = await make(clients, "inside.txt");
  const deep = await make(sub, "deep.txt");
  const oldest = await make(personal, "oldest.md");
  const loose = await make(personal, "loose.md");
  const newest = await make(personal, "newest.md");
  const mine = await make(personal, "mine.txt");
  const gone = await make(personal, "gone.txt");
  await handlers["files.delete"](ctx, { fileId: gone });

  // access: the grants, the flow-down rows of the shared folder, a trashed file, an id this module does not hold; "mine" is the caller's own, so it is not in the shared section
  access.sharedFiles = [inside, deep, oldest, loose, newest, gone, "fil_notinfiles"];
  access.sharedFolders = [clients, sub, other, "fld_notinfiles"];
  access.sharedAt = { [clients]: 100, [other]: 200, [oldest]: 100, [loose]: 300, [newest]: 500, [inside]: 50 };

  const out = await handlers["files.shared_with_me"](ctx, {});
  assert.deepEqual(out.files.map((f) => f.name), ["newest.md", "loose.md", "oldest.md"], "newest share first; flow-down rows, the trashed file and the unknown id are left out");
  assert.deepEqual(out.folders.map((f) => f.name), ["Other", "Clients"], "folders newest share first; Sub opens from Clients");
  assert.equal(out.total, 5);
  assert.equal(out.next, undefined);
  assert.ok(!out.files.some((f) => f.fileId === mine), "what the caller owns is not shared with them");
  assert.ok(calls.some((c) => c.cap === "access.lists" && (c.input as Row)["section"] === "shared" && (c.input as Row)["type"] === "file"));
  assert.ok(calls.some((c) => c.cap === "access.lists" && (c.input as Row)["section"] === "shared" && (c.input as Row)["type"] === "folder"));

  // pages cover the same rows once, in the same order
  const first = await handlers["files.shared_with_me"](ctx, { limit: 2 });
  assert.equal(first.total, 5);
  assert.equal(first.next, "2");
  const second = await handlers["files.shared_with_me"](ctx, { limit: 2, cursor: String(first.next) });
  const third = await handlers["files.shared_with_me"](ctx, { limit: 2, cursor: String(second.next) });
  const names = [first, second, third].flatMap((p) => [...p.folders.map((f) => f.name), ...p.files.map((f) => f.name)]);
  assert.deepEqual([...names].sort(), ["Clients", "Other", "loose.md", "newest.md", "oldest.md"]);
  assert.equal(third.next, undefined);
  assert.deepEqual(first.files.map((f) => f.name).concat(first.folders.map((f) => f.name)), ["newest.md", "loose.md"], "newest.md (500) and loose.md (300) come first");

  // a kind filter returns files of that kind only
  const md = await handlers["files.shared_with_me"](ctx, { kind: "markdown" });
  assert.deepEqual(md.files.map((f) => f.name), ["newest.md", "loose.md", "oldest.md"]);
  assert.deepEqual(md.folders, []);
  const text = await handlers["files.shared_with_me"](ctx, { kind: "text" });
  assert.deepEqual(text.files, [], "inside.txt and deep.txt sit in a shared folder, so they are not repeated");
  assert.equal(text.total, 0);

  // a file that was shared and then trashed or restored follows its row
  await handlers["files.restore"](ctx, { fileId: gone });
  const back = await handlers["files.shared_with_me"](ctx, {});
  assert.ok(back.files.some((f) => f.name === "gone.txt"));
});

test("Shared with me for a caller with no grants is empty, and bad input is refused", async () => {
  const none: Access = { sharedFiles: [], sharedFolders: [], readableFiles: [], readableFolders: [], sharedAt: {} };
  const { ctx } = open(accessScript(none), "per_guest");
  const tree = await handlers["files.tree"](ctx, {});
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  await handlers["files.create"](ctx, { folderId: personal, name: "private.txt", content: { text: "x" } });
  const out = await handlers["files.shared_with_me"](ctx, {});
  assert.deepEqual([out.files, out.folders, out.total], [[], [], 0], "no grant, nothing listed, even with files in the Space");
  await expectCode("validation.bad_input", () => handlers["files.shared_with_me"](ctx, { kind: "not_a_kind" }));
  await expectCode("validation.bad_input", () => handlers["files.shared_with_me"](ctx, { limit: 0 }));
  await expectCode("validation.bad_input", () => handlers["files.shared_with_me"](ctx, { cursor: "abc" }));
  await expectCode("validation.bad_input", () => handlers["files.shared_with_me"](ctx, []));
});

test("Shared with me follows access across pages of its answer", async () => {
  const access: Access = { sharedFiles: [], sharedFolders: [], readableFiles: [], readableFolders: [], sharedAt: {} };
  const seen: Row[] = [];
  const ids: string[] = [];
  const script = accessScript(access);
  const { ctx } = open((cap, input) => {
    if (cap === "access.lists" && (input as Row)["type"] === "file" && (input as Row)["section"] === "shared") {
      seen.push(input as Row);
      const cursor = (input as Row)["cursor"];
      return cursor === undefined
        ? { rows: ids.slice(0, 1).map((id) => ({ type: "file", id, title: id, via: "grant", level: "view" })), next: "1" }
        : { rows: ids.slice(1).map((id) => ({ type: "file", id, title: id, via: "grant", level: "view" })) };
    }
    return script(cap, input);
  });
  const tree = await handlers["files.tree"](ctx, {});
  seen.length = 0;   // the tree's own Shared with me count asks access too; this test is about the pages of files.shared_with_me
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  for (const name of ["a.txt", "b.txt"]) ids.push((await handlers["files.create"](ctx, { folderId: personal, name, content: { text: name } })).file.fileId);
  const out = await handlers["files.shared_with_me"](ctx, {});
  assert.deepEqual(out.files.map((f) => f.name), ["a.txt", "b.txt"]);
  assert.deepEqual(seen.map((s) => s["cursor"]), [undefined, "1"], "the second page is asked for with the cursor access gave");
});

test("Knowledge shows the readable shared knowledge and the Memory and Graph entries with their counts", async () => {
  const access: Access = { sharedFiles: [], sharedFolders: [], readableFiles: [], readableFolders: [], sharedAt: {} };
  const { ctx, calls } = open(accessScript(access, (cap) => {
    if (cap === "memory.notes.list") return { notes: [], total: 7 };
    if (cap === "memory.graph") return { nodes: Array.from({ length: 12 }, (_v, n) => ({ nodeId: `n${n}` })), edges: [], clusters: [] };
    return undefined;
  }));
  const tree = await handlers["files.tree"](ctx, {});
  const root = idOf(tree.roots.find((r) => r.key === "shared_knowledge")?.folderId, "shared_knowledge");
  const playbooks = (await handlers["files.folder.create"](ctx, { parentId: root, name: "Playbooks" })).folder.folderId;
  const secret = (await handlers["files.folder.create"](ctx, { parentId: root, name: "Secret" })).folder.folderId;
  const guide = (await handlers["files.create"](ctx, { folderId: root, name: "guide.md", content: { text: "g" } })).file.fileId;
  const hidden = (await handlers["files.create"](ctx, { folderId: root, name: "hidden.md", content: { text: "h" } })).file.fileId;
  const nested = (await handlers["files.create"](ctx, { folderId: playbooks, name: "nested.md", content: { text: "n" } })).file.fileId;
  access.readableFolders = [playbooks];
  access.readableFiles = [guide, nested];
  void secret; void hidden;

  const out = await handlers["files.knowledge"](ctx, {});
  assert.deepEqual(out.folders.map((f) => f.name), ["Playbooks"], "the folder the caller may not read is not listed, and neither are the Memory and Graph system folders");
  assert.deepEqual(out.files.map((f) => f.name), ["guide.md"], "only the top of the knowledge folder: nested.md opens from Playbooks");
  assert.deepEqual(out.views, [{ key: "memory", title: "Memory", count: 7 }, { key: "graph", title: "Graph", count: 12 }]);
  assert.equal(out.total, 2);
  assert.deepEqual(calls.filter((c) => c.cap.startsWith("memory.")).map((c) => [c.cap, c.input]), [["memory.notes.list", { layer: "space", limit: 1 }], ["memory.graph", { scope: "space" }]]);

  const paged = await handlers["files.knowledge"](ctx, { limit: 1 });
  assert.deepEqual([paged.folders.length, paged.files.length, paged.next], [1, 0, "1"], "folders come before files");
  const rest = await handlers["files.knowledge"](ctx, { limit: 1, cursor: "1" });
  assert.deepEqual([rest.folders.length, rest.files.length, rest.next], [0, 1, undefined]);
});

test("Knowledge for a caller who may read nothing lists nothing but still names Memory and Graph; a failing memory module is not hidden", async () => {
  const none: Access = { sharedFiles: [], sharedFolders: [], readableFiles: [], readableFolders: [], sharedAt: {} };
  const { ctx } = open(accessScript(none, (cap) => (cap === "memory.notes.list" ? { notes: [{}, {}], total: 2 } : cap === "memory.graph" ? { nodes: [], edges: [], clusters: [] } : undefined)), "per_guest");
  const tree = await handlers["files.tree"](ctx, {});
  const root = idOf(tree.roots.find((r) => r.key === "shared_knowledge")?.folderId, "shared_knowledge");
  await handlers["files.create"](ctx, { folderId: root, name: "closed.md", content: { text: "c" } });
  const out = await handlers["files.knowledge"](ctx, {});
  assert.deepEqual([out.files, out.folders, out.total], [[], [], 0]);
  assert.deepEqual(out.views, [{ key: "memory", title: "Memory", count: 2 }, { key: "graph", title: "Graph", count: 0 }]);
  await expectCode("validation.bad_input", () => handlers["files.knowledge"](ctx, { limit: 501 }));

  const broken = open((cap, input) => {
    if (cap === "access.lists") return { rows: [], counts: {}, total: 0 };
    throw new Error(`down: ${cap} ${JSON.stringify(input)}`);
  });
  await assert.rejects(() => handlers["files.knowledge"](broken.ctx, {}), /down: memory\.notes\.list/);
});

test("Recent lists the newest opened first and Trash lists deleted roots, folders and files", async () => {
  const { ctx } = open();
  const tree = await handlers["files.tree"](ctx, {});
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  const a = (await handlers["files.create"](ctx, { folderId: personal, name: "a.txt", content: { text: "a" } })).file.fileId;
  const b = (await handlers["files.create"](ctx, { folderId: personal, name: "b.txt", content: { text: "b" } })).file.fileId;
  await handlers["files.read"](ctx, { fileId: a });
  const recent = await handlers["files.recent"](ctx, {});
  assert.deepEqual(recent.files.map((f) => f.fileId), [a, b], "a was opened after b was made");
  assert.deepEqual((await handlers["files.recent"](ctx, { limit: 1 })).files.map((f) => f.fileId), [a]);
  await expectCode("validation.bad_input", () => handlers["files.recent"](ctx, { limit: 201 }));

  const box = (await handlers["files.folder.create"](ctx, { parentId: personal, name: "Box" })).folder.folderId;
  await handlers["files.delete"](ctx, { fileId: b });
  await handlers["files.folder.delete"](ctx, { folderId: box });
  const trash = await handlers["files.trash.list"](ctx, {});
  assert.deepEqual(trash.files.map((f) => f.name), ["b.txt"]);
  assert.deepEqual(trash.folders.map((f) => f.name), ["Box"]);
  assert.equal(trash.total, 2);
  assert.equal((await handlers["files.recent"](ctx, {})).files.some((f) => f.fileId === b), false, "a trashed file leaves Recent");
});
