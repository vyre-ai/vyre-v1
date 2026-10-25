// Tree, trash restore and AES-GCM blob integrity (spec 2.16, 2.4, 3.5).
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aesUnwrap, aesWrap } from "../../../kernel/src/seal/box.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import { seed } from "../fixtures/seed.ts";
import { handlers, putUploadedBytes } from "../impl.ts";
import { inline } from "../projections.ts";

type Row = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));

function memoryDb(): Ctx["db"] & { rows(table: string): Row[] } {
  const tables = new Map<string, Row[]>();
  const bag = (name: string): Row[] => {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  };
  const take = (args: unknown[], at: { i: number }): unknown => {
    if (at.i >= args.length) throw new Error("sql is missing a value");
    const value = args[at.i];
    at.i += 1;
    return value;
  };
  const compile = (where: string | undefined, args: unknown[], at: { i: number }): ((row: Row) => boolean) => {
    if (!where) return () => true;
    const preds: ((row: Row) => boolean)[] = [];
    for (const part of where.split(" AND ")) {
      const isNull = /^(\w+) IS NULL$/.exec(part);
      if (isNull) {
        const col = isNull[1];
        if (col === undefined) throw new Error(`bad predicate ${part}`);
        preds.push((row) => row[col] === null || row[col] === undefined);
        continue;
      }
      const eq = /^(\w+) = \?$/.exec(part);
      if (!eq) throw new Error(`bad predicate ${part}`);
      const col = eq[1];
      if (col === undefined) throw new Error(`bad predicate ${part}`);
      const val = take(args, at);
      preds.push((row) => {
        const cur = row[col];
        if (cur === null || cur === undefined) return false;
        return cur === val;
      });
    }
    return (row) => preds.every((pred) => pred(row));
  };
  const all = (sql: string, ...args: unknown[]): unknown[] => {
    const text = sql.replace(/\s+/g, " ").trim();
    const sel = /^SELECT \* FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!sel) throw new Error(`unsupported sql: ${text}`);
    const name = sel[1];
    if (name === undefined) throw new Error(`unsupported sql: ${text}`);
    const at = { i: 0 };
    const pred = compile(sel[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    return bag(name).filter(pred).map((row) => ({ ...row }));
  };
  const run = (sql: string, ...args: unknown[]): { changes: number } => {
    const text = sql.replace(/\s+/g, " ").trim();
    const at = { i: 0 };
    const insert = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(text);
    if (insert) {
      const name = insert[1];
      const colSql = insert[2];
      const valSql = insert[3];
      if (name === undefined || colSql === undefined || valSql === undefined) throw new Error(`unsupported sql: ${text}`);
      const cols = colSql.split(",").map((col) => col.trim());
      const marks = valSql.split(",").map((mark) => mark.trim());
      if (marks.some((mark) => mark !== "?") || marks.length !== cols.length) throw new Error(`unsupported sql: ${text}`);
      const row: Row = {};
      for (const col of cols) row[col] = take(args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      bag(name).push(row);
      return { changes: 1 };
    }
    const update = /^UPDATE (\w+) SET (.+) WHERE (.+)$/.exec(text);
    if (update) {
      const name = update[1];
      const setSql = update[2];
      const where = update[3];
      if (name === undefined || setSql === undefined || where === undefined) throw new Error(`unsupported sql: ${text}`);
      const assigns: { col: string; val: unknown }[] = [];
      for (const part of setSql.split(", ")) {
        const m = /^(\w+) = \?$/.exec(part);
        if (!m || m[1] === undefined) throw new Error(`bad assignment ${part}`);
        assigns.push({ col: m[1], val: take(args, at) });
      }
      const pred = compile(where, args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      let changes = 0;
      for (const row of bag(name)) {
        if (!pred(row)) continue;
        for (const assign of assigns) row[assign.col] = assign.val;
        changes += 1;
      }
      return { changes };
    }
    const del = /^DELETE FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!del || del[1] === undefined) throw new Error(`unsupported sql: ${text}`);
    const name = del[1];
    const pred = compile(del[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    const kept: Row[] = [];
    let changes = 0;
    for (const row of bag(name)) {
      if (pred(row)) changes += 1;
      else kept.push(row);
    }
    tables.set(name, kept);
    return { changes };
  };
  return { all, run, rows: (table) => bag(table).map((row) => ({ ...row })) };
}

function spaceSeal(key: Uint8Array): Ctx["seal"] {
  return {
    seal(plain: Uint8Array, scope: string): Sealed {
      const box = aesWrap(key, plain, scope);
      return { keyId: "space-key", nonce: box.iv, bytes: JSON.stringify({ ct: box.ct, tag: box.tag, aad: scope }) };
    },
    unseal(sealed: Sealed): Uint8Array {
      if (sealed.keyId !== "space-key") throw new Error("wrong key");
      const parsed: unknown = JSON.parse(sealed.bytes);
      if (parsed === null || typeof parsed !== "object") throw new Error("bad box");
      const box = parsed as { ct?: unknown; tag?: unknown; aad?: unknown };
      if (typeof box.ct !== "string" || typeof box.tag !== "string" || typeof box.aad !== "string") throw new Error("bad box");
      return aesUnwrap(key, { iv: sealed.nonce, ct: box.ct, tag: box.tag }, box.aad);
    },
  };
}

function open(): { ctx: Ctx; events: { name: string; payload: unknown }[]; db: ReturnType<typeof memoryDb> } {
  const db = memoryDb();
  const events: { name: string; payload: unknown }[] = [];
  let clock = 1_760_000_000_000;
  const key = new Uint8Array(32);
  for (let i = 0; i < key.length; i++) key[i] = (i * 17 + 3) & 0xff;
  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: "per_maya" },
    trace: { traceId: "a".repeat(32), spanId: "b".repeat(16) },
    origin: "user",
    depth: 0,
    now: () => {
      clock += 1;
      return clock;
    },
    db,
    emit: <T>(name: string, _subject: string, payload: T): EventEnvelope<T> => {
      events.push({ name, payload });
      return {
        seq: events.length,
        id: `evt_${events.length}`,
        type: name,
        sv: 1,
        hlc: String(clock),
        at: clock,
        traceId: "a".repeat(32),
        actor: "per_maya",
        depth: 0,
        label: 0,
        vis: "space",
        enc: 0,
        payload,
      };
    },
    call: async () => {
      throw new Error("call is not used");
    },
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_test" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 0, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_test",
    seal: spaceSeal(key),
  };
  return { ctx, events, db };
}

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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("the migration and the entity schema are the tables the tree writes", () => {
  const migration = readFileSync(join(here, "../migrations/0001_files_tree.sql"), "utf8");
  const schema = readFileSync(join(here, "../../../generated/modules/files/schema.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS files_folder/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS files_blob/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS files_recent/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS files_trash/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS "files_file"/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS "files_file_version"/);
  assert.equal(seed.table, "files_folder");
  assert.equal(seed.rows.length, 0);
  assert.equal(seed.knowledge.length, 2);
  const db = memoryDb();
  db.run("INSERT INTO files_folder (id, parent_id, name, deleted_at) VALUES (?, ?, ?, ?)", "fld_1", null, "Personal", null);
  assert.equal(db.all("SELECT * FROM files_folder WHERE parent_id IS NULL AND name = ? AND deleted_at IS NULL", "Personal").length, 1);
  assert.equal(db.all("SELECT * FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", "fld_x").length, 0);
  db.run("UPDATE files_folder SET name = ? WHERE id = ?", "Library", "fld_1");
  const renamed = db.all("SELECT * FROM files_folder WHERE id = ?", "fld_1")[0] as Row;
  assert.equal(renamed.name, "Library");
  db.run("DELETE FROM files_folder WHERE id = ?", "fld_1");
  assert.equal(db.all("SELECT * FROM files_folder").length, 0);
});

test("tree roots, create, move, versions and path rewrite", async () => {
  const { ctx, events } = open();
  const tree = await handlers["files.tree"](ctx, {});
  assert.deepEqual(tree.roots.map((root) => root.key), seed.roots.map((root) => root.key));
  const knowledge = tree.roots.find((root) => root.key === "knowledge");
  assert.equal(knowledge?.kind, "folder");
  assert.equal(knowledge?.count, 2);
  const personalId = idOf(tree.roots.find((root) => root.key === "personal")?.folderId, "personal");

  const notes = await handlers["files.folder.create"](ctx, { parentId: personalId, name: "Notes" });
  assert.equal(notes.folder.path, "Personal/Notes");
  const inner = await handlers["files.folder.create"](ctx, { parentId: notes.folder.folderId, name: "Inner" });
  const created = await handlers["files.create"](ctx, {
    folderId: inner.folder.folderId,
    name: "plan.md",
    content: { text: "v1" },
  });
  assert.equal(created.file.version, 1);
  assert.equal(created.file.kind, "markdown");
  const fileId = created.file.fileId;

  const listed = await handlers["files.list"](ctx, { folder: inner.folder.folderId });
  assert.deepEqual(listed.files.map((file) => file.name), ["plan.md"]);
  assert.equal(listed.total, 1);
  const first = await handlers["files.read"](ctx, { fileId });
  assert.equal(first.text, "v1");
  assert.equal(first.truncated, false);

  const written = await handlers["files.write"](ctx, { fileId, content: { text: "v2" }, baseVersion: 1, reason: "edit" });
  assert.equal(written.file.version, 2);
  const second = await handlers["files.read"](ctx, { fileId });
  assert.equal(second.text, "v2");
  await expectCode("validation.version_conflict", () => handlers["files.write"](ctx, { fileId, content: { text: "stale" }, baseVersion: 1 }));

  const versions = await handlers["files.versions"](ctx, { fileId });
  assert.equal(versions.versions.length, 2);
  const oldest = versions.versions.find((version) => version.n === 1);
  const oldestId = idOf(oldest?.versionId, "version 1");
  const oldRead = await handlers["files.read"](ctx, { fileId, versionId: oldestId });
  assert.equal(oldRead.text, "v1");
  assert.equal(oldRead.version, 1);
  const restored = await handlers["files.restore_version"](ctx, { fileId, versionId: oldestId });
  assert.equal(restored.file.version, 3);
  const current = await handlers["files.read"](ctx, { fileId });
  assert.equal(current.text, "v1");

  const renamed = await handlers["files.folder.rename"](ctx, { folderId: notes.folder.folderId, name: "Docs" });
  assert.equal(renamed.folder.path, "Personal/Docs");
  const movedInner = await handlers["files.folder.get"](ctx, { folderId: inner.folder.folderId });
  assert.equal(movedInner.folder.path, "Personal/Docs/Inner");
  await handlers["files.move"](ctx, { fileId, toFolderId: notes.folder.folderId });
  const docs = await handlers["files.list"](ctx, { folder: notes.folder.folderId });
  assert.deepEqual(docs.folders.map((folder) => folder.name), ["Inner"]);
  assert.deepEqual(docs.files.map((file) => file.name), ["plan.md"]);
  const empty = await handlers["files.list"](ctx, { folder: inner.folder.folderId });
  assert.equal(empty.files.length, 0);
  const resolved = await handlers["files.resolve"](ctx, { path: "Personal/Docs/plan.md" });
  assert.equal(resolved.kind, "file");
  assert.equal(resolved.fileId, fileId);

  const names = events.map((event) => event.name);
  assert.ok(names.includes("folder.created"));
  assert.ok(names.includes("file.created"));
  assert.ok(names.includes("file.version_added"));
  assert.ok(names.includes("folder.renamed"));
  assert.ok(names.includes("file.moved"));
});

test("trash restore brings back a file and a folder with its children", async () => {
  const { ctx } = open();
  const tree = await handlers["files.tree"](ctx, {});
  const personalId = idOf(tree.roots.find((root) => root.key === "personal")?.folderId, "personal");
  const box = await handlers["files.folder.create"](ctx, { parentId: personalId, name: "Box" });
  const made = await handlers["files.create"](ctx, { folderId: box.folder.folderId, name: "a.txt", content: { text: "keep" } });
  const beside = await handlers["files.create"](ctx, { folderId: personalId, name: "beside.txt", content: { text: "side" } });
  const fileId = made.file.fileId;

  await handlers["files.folder.delete"](ctx, { folderId: box.folder.folderId });
  await expectCode("validation.precondition_failed", () => handlers["files.list"](ctx, { folder: box.folder.folderId }));
  await expectCode("validation.precondition_failed", () => handlers["files.write"](ctx, { fileId, content: { text: "no" } }));
  await expectCode("validation.precondition_failed", () => handlers["files.restore"](ctx, { fileId }));
  const held = await handlers["files.read"](ctx, { fileId });
  assert.equal(held.text, "keep");
  const trashed = await handlers["files.trash.list"](ctx, {});
  assert.deepEqual(trashed.folders.map((folder) => folder.name), ["Box"]);
  assert.equal(trashed.files.length, 0);
  assert.equal(trashed.total, 1);
  const during = await handlers["files.tree"](ctx, {});
  assert.equal(during.roots.find((root) => root.key === "trash")?.count, 1);

  const back = await handlers["files.folder.restore"](ctx, { folderId: box.folder.folderId });
  assert.equal(back.folder.name, "Box");
  const again = await handlers["files.read"](ctx, { fileId });
  assert.equal(again.text, "keep");
  const kids = await handlers["files.list"](ctx, { folder: box.folder.folderId });
  assert.deepEqual(kids.files.map((file) => file.name), ["a.txt"]);
  const cleared = await handlers["files.trash.list"](ctx, {});
  assert.equal(cleared.total, 0);

  await handlers["files.delete"](ctx, { fileId: beside.file.fileId });
  const recent = await handlers["files.recent"](ctx, {});
  assert.equal(recent.files.some((file) => file.fileId === beside.file.fileId), false);
  const fileTrash = await handlers["files.trash.list"](ctx, {});
  assert.deepEqual(fileTrash.files.map((file) => file.name), ["beside.txt"]);
  const restored = await handlers["files.restore"](ctx, { fileId: beside.file.fileId });
  assert.equal(restored.file.deletedAt, undefined);
  const side = await handlers["files.read"](ctx, { fileId: beside.file.fileId });
  assert.equal(side.text, "side");
  const after = await handlers["files.trash.list"](ctx, {});
  assert.equal(after.total, 0);
});

test("blobs are sealed, deduped, rejected when tampered, and kept while a version still points at them", async () => {
  const { ctx, db } = open();
  const tree = await handlers["files.tree"](ctx, {});
  const personalId = idOf(tree.roots.find((root) => root.key === "personal")?.folderId, "personal");
  const plain = new TextEncoder().encode("sealed notes");
  const first = await handlers["files.create"](ctx, { folderId: personalId, name: "a.txt", content: { text: "sealed notes" } });
  const second = await handlers["files.create"](ctx, { folderId: personalId, name: "b.txt", content: { text: "sealed notes" } });
  const blobs = db.rows("files_blob");
  assert.equal(blobs.length, 1);
  const blob = blobs[0];
  assert.ok(blob);
  assert.equal(blob.refs, 2);
  assert.equal(blob.hash, await sha256(plain));
  assert.equal(String(blob.bytes).includes("sealed notes"), false);
  assert.equal(blob.scope, `files.blob:${ctx.space}:${String(blob.id)}`);
  const readA = await handlers["files.read"](ctx, { fileId: first.file.fileId });
  const readB = await handlers["files.read"](ctx, { fileId: second.file.fileId });
  assert.equal(readA.text, "sealed notes");
  assert.equal(readB.text, "sealed notes");

  const tampered = `${String(blob.bytes).slice(0, -1)}x`;
  db.run("UPDATE files_blob SET bytes = ? WHERE id = ?", tampered, blob.id);
  await expectCode("internal.unexpected", () => handlers["files.read"](ctx, { fileId: first.file.fileId }));

  const shared = open();
  const sharedTree = await handlers["files.tree"](shared.ctx, {});
  const sharedPersonal = idOf(sharedTree.roots.find((root) => root.key === "personal")?.folderId, "personal");
  const left = await handlers["files.create"](shared.ctx, { folderId: sharedPersonal, name: "left.txt", content: { text: "same" } });
  const right = await handlers["files.create"](shared.ctx, { folderId: sharedPersonal, name: "right.txt", content: { text: "same" } });
  assert.equal(shared.db.rows("files_blob")[0]?.refs, 2);
  await handlers["files.delete"](shared.ctx, { fileId: left.file.fileId });
  const emptied = await handlers["files.trash.empty"](shared.ctx, {});
  assert.equal(emptied.purged, 1);
  assert.equal(shared.db.rows("files_blob")[0]?.refs, 1);
  const still = await handlers["files.read"](shared.ctx, { fileId: right.file.fileId });
  assert.equal(still.text, "same");
  const healthy = await handlers["files.health"](shared.ctx, {});
  assert.equal(healthy.state, "healthy");

  const uploaded = open();
  const upTree = await handlers["files.tree"](uploaded.ctx, {});
  const upPersonal = idOf(upTree.roots.find((root) => root.key === "personal")?.folderId, "personal");
  const body = new TextEncoder().encode("from upload");
  const slot = await handlers["files.upload_url"](uploaded.ctx, { size: body.byteLength, mime: "text/plain" });
  const token = slot.url.split("token=")[1];
  assert.equal(typeof token, "string");
  const stored = await putUploadedBytes(uploaded.ctx, slot.blobId, token ?? "", body);
  assert.equal(stored.size, body.byteLength);
  assert.equal(stored.hash, await sha256(body));
  const waiting = await handlers["files.health"](uploaded.ctx, {});
  assert.equal(waiting.state, "degraded");
  const filed = await handlers["files.create"](uploaded.ctx, {
    folderId: upPersonal,
    name: "up.txt",
    content: { blobId: slot.blobId },
  });
  const round = await handlers["files.read"](uploaded.ctx, { fileId: filed.file.fileId });
  assert.equal(round.text, "from upload");
  const ready = await handlers["files.health"](uploaded.ctx, {});
  assert.equal(ready.state, "healthy");
  assert.equal(uploaded.db.rows("files_upload").length, 0);
});

test("recent projection keeps the newest open and drops a deleted file", async () => {
  const { ctx, db } = open();
  const recent = inline["files.recent"];
  assert.equal(recent?.mode, "inline");
  assert.ok(recent);
  const enc = new TextEncoder();
  const event = (at: number, fileId: string) => ({ at, actor: "per_maya", payload: enc.encode(JSON.stringify({ fileId })) });
  recent.reset(db);
  recent.on["file.created"](db, event(10, "fil_a"));
  recent.on["file.created"](db, event(5, "fil_a"));
  const held = db.rows("files_recent");
  assert.equal(held.length, 1);
  assert.equal(held[0]?.at, 10);
  recent.on["file.version_added"](db, event(20, "fil_a"));
  assert.equal(db.rows("files_recent")[0]?.at, 20);
  recent.on["file.deleted"](db, event(30, "fil_a"));
  assert.equal(db.rows("files_recent").length, 0);
  recent.on["file.created"](db, { at: 40, actor: "per_maya", payload: enc.encode("{") });
  assert.equal(db.rows("files_recent").length, 0);

  const tree = await handlers["files.tree"](ctx, {});
  const personalId = idOf(tree.roots.find((root) => root.key === "personal")?.folderId, "personal");
  const first = await handlers["files.create"](ctx, { folderId: personalId, name: "one.txt", content: { text: "one" } });
  const second = await handlers["files.create"](ctx, { folderId: personalId, name: "two.txt", content: { text: "two" } });
  const list = await handlers["files.recent"](ctx, {});
  assert.deepEqual(list.files.map((file) => file.fileId), [second.file.fileId, first.file.fileId]);
  const counted = await handlers["files.tree"](ctx, {});
  assert.equal(counted.roots.find((root) => root.key === "recent")?.count, 2);
});

test("files.star is mine alone, shows on the file rows, and says so once", async () => {
  const { ctx, events } = open();
  const personalId = idOf((await handlers["files.tree"](ctx, {})).roots.find((root) => root.key === "personal")?.folderId, "personal");
  const made = await handlers["files.create"](ctx, { folderId: personalId, name: "a.md", content: { text: "x" } });
  const fileId = made.file.fileId;
  assert.equal(made.file.starred, false);
  assert.equal(made.file.conflict, false);
  const on = await handlers["files.star"](ctx, { fileId, starred: true });
  assert.equal(on.file.starred, true);
  assert.equal((await handlers["files.list"](ctx, { folder: personalId })).files[0]?.starred, true);
  await handlers["files.star"](ctx, { fileId, starred: true });
  assert.equal(events.filter((e) => e.name === "file.starred").length, 1, "starring again changes nothing");
  const other: Ctx = { ...ctx, principal: { kind: "person", id: "per_omar" } };
  assert.equal((await handlers["files.get"](other, { fileId })).file.starred, false, "someone else's view has no star");
  const off = await handlers["files.star"](ctx, { fileId, starred: false });
  assert.equal(off.file.starred, false);
  assert.equal(events.filter((e) => e.name === "file.starred").length, 2);
  await expectCode("validation.bad_input", () => handlers["files.star"](ctx, { fileId, starred: "yes" }));
});

test("a file with a collided staged change in an open changeset carries the conflict flag", async () => {
  const { ctx, db } = open();
  const personalId = idOf((await handlers["files.tree"](ctx, {})).roots.find((root) => root.key === "personal")?.folderId, "personal");
  const made = await handlers["files.create"](ctx, { folderId: personalId, name: "c.md", content: { text: "x" } });
  const fileId = made.file.fileId;
  db.run("INSERT INTO files_changeset (id, state) VALUES (?, ?)", "chg_1", "open");
  db.run("INSERT INTO files_changeset_file (changeset_id, path, file_id, conflict) VALUES (?, ?, ?, ?)", "chg_1", "c.md", fileId, 1);
  assert.equal((await handlers["files.get"](ctx, { fileId })).file.conflict, true);
  db.run("UPDATE files_changeset SET state = ? WHERE id = ?", "approved", "chg_1");
  assert.equal((await handlers["files.get"](ctx, { fileId })).file.conflict, false, "a settled changeset holds no conflict");
});

test("folders and tree roots say whether they belong to an agent, a project or the Space, with the id", async () => {
  const { ctx } = open();
  const tree = await handlers["files.tree"](ctx, {});
  assert.deepEqual(tree.roots.find((r) => r.key === "agents")?.subject, { kind: "agent" });
  assert.deepEqual(tree.roots.find((r) => r.key === "projects")?.subject, { kind: "project" });
  assert.deepEqual(tree.roots.find((r) => r.key === "channels")?.subject, { kind: "space" });
  const agentsId = idOf(tree.roots.find((r) => r.key === "agents")?.folderId, "agents");
  const mine = await handlers["files.folder.create"](ctx, { parentId: agentsId, name: "Scout", subject: { kind: "agent", id: "agt_scout1" } });
  assert.deepEqual(mine.folder.subject, { kind: "agent", id: "agt_scout1" });
  const inner = await handlers["files.folder.create"](ctx, { parentId: mine.folder.folderId, name: "Notes" });
  assert.deepEqual(inner.folder.subject, { kind: "agent", id: "agt_scout1" }, "a folder below it belongs to the same agent");
  const plain = await handlers["files.folder.create"](ctx, { parentId: idOf(tree.roots.find((r) => r.key === "channels")?.folderId, "channels"), name: "General" });
  assert.deepEqual(plain.folder.subject, { kind: "space" });
  await expectCode("validation.bad_input", () => handlers["files.folder.create"](ctx, { parentId: agentsId, name: "Bad", subject: { kind: "space", id: "x" } }));
});
// run on the final commit of P-CC_27
