// files agent-stage: an agent's save, delete, rename and move in a Review changes folder are staged in a changeset, never applied (spec 2.16; P-L4_04b). A person's own
// writes, a service and folders without Review changes are untouched.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /modules/files/migrations/0003_changesets.sql
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { aesUnwrap, aesWrap } from "../../../kernel/src/seal/box.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import { handlers } from "../impl.ts";
import { withAgentStaging } from "../handlers/agent-stage.ts";

type Row = Record<string, unknown>;

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

function open(answers: Record<string, unknown> = {}): { ctx: Ctx; events: { name: string; payload: unknown }[]; db: ReturnType<typeof memoryDb>; calls: { cap: string; input: unknown }[] } {
  const db = memoryDb();
  const calls: { cap: string; input: unknown }[] = [];
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
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      const answer = answers[cap];
      if (answer === undefined) throw new Error(`no answer for ${cap}`);
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? (answer as (i: unknown) => unknown)(input) : answer;
    },
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_test" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 0, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_test",
    seal: spaceSeal(key),
  };
  return { ctx, events, db, calls };
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

const lines = (n: number, edits: Record<number, string> = {}): string =>
  Array.from({ length: n }, (_, i) => edits[i + 1] ?? `line ${i + 1}`).join("\n");
const agentOf = (ctx: Ctx, id = "agt_intake"): Ctx => ({ ...ctx, principal: { kind: "agent", id }, actingFor: "per_maya", thread: "thr_1" });
const personOf = (ctx: Ctx, id: string): Ctx => ({ ...ctx, principal: { kind: "person", id } });
const eventsOf = (events: { name: string; payload: unknown }[], name: string): unknown[] => events.filter((e) => e.name === name).map((e) => e.payload);


// ---- the world: Docs (Review changes on) with plan.txt and notes.txt, Docs/sub, and a Free folder without Review changes ----

async function setup(answers: Record<string, unknown> = {}) {
  const k = open(answers);
  const tree = await handlers["files.tree"](k.ctx, {});
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  const docs = (await handlers["files.folder.create"](k.ctx, { parentId: personal, name: "Docs", reviewChanges: true })).folder.folderId;
  const sub = (await handlers["files.folder.create"](k.ctx, { parentId: docs, name: "sub" })).folder.folderId;
  const free = (await handlers["files.folder.create"](k.ctx, { parentId: personal, name: "Free" })).folder.folderId;
  const plan = (await handlers["files.create"](k.ctx, { folderId: docs, name: "plan.txt", content: { text: lines(10) } })).file.fileId;
  const notes = (await handlers["files.create"](k.ctx, { folderId: docs, name: "notes.txt", content: { text: "n1\nn2\n" } })).file.fileId;
  const loose = (await handlers["files.create"](k.ctx, { folderId: free, name: "loose.txt", content: { text: "l" } })).file.fileId;
  return { k, ctx: k.ctx, agent: agentOf(k.ctx), personal, docs, sub, free, plan, notes, loose };
}
type W = Awaited<ReturnType<typeof setup>>;
const textOf = async (ctx: Ctx, fileId: string): Promise<string> => (await handlers["files.read"](ctx, { fileId, as: "text" })).text ?? "";
const versionsOf = async (ctx: Ctx, fileId: string): Promise<number> => (await handlers["files.versions"](ctx, { fileId })).versions.length;

type Staged<T> = T & { changesetId?: string };
const del = async (ctx: Ctx, fileId: string): Promise<Staged<{ deleted: boolean }>> => handlers["files.delete"](ctx, { fileId });
const ren = async (ctx: Ctx, fileId: string, name: string) => (await handlers["files.rename"](ctx, { fileId, name })) as Staged<{ file: { fileId: string; name: string; folderId: string; version: number } }>;
const mov = async (ctx: Ctx, fileId: string, toFolderId: string, name?: string) =>
  (await handlers["files.move"](ctx, { fileId, toFolderId, ...(name ? { name } : {}) })) as Staged<{ file: { fileId: string; name: string; folderId: string; version: number } }>;
const fileRow = (k: W["k"], id: string): Record<string, unknown> | undefined => k.db.rows("files_file").find((r) => r["id"] === id);
/** Everything a direct write would move: the files, their versions, the blobs, the trash. */
// files_folder is left out: the first call by a new principal makes that principal a Personal root (ensurePersonal), which is not a change to any file
const TREE_TABLES = ["files_file", "files_file_version", "files_blob", "files_trash"];
const treeState = (k: W["k"]): Record<string, string[]> => Object.fromEntries(TREE_TABLES.map((t) => [t, k.db.rows(t).map((r) => JSON.stringify(r))]));
/** Fails with the table and the first row that differs, not with two long strings. */
function sameTree(k: W["k"], before: Record<string, string[]>, why: string): void {
  const now = treeState(k);
  for (const t of TREE_TABLES) {
    const a = before[t] ?? [];
    const b = now[t] ?? [];
    const at = a.findIndex((row, i) => row !== b[i]);
    if (a.length !== b.length || at >= 0) assert.fail(`${why}: ${t} changed (${a.length} rows before, ${b.length} after)${at >= 0 ? `\n before ${a[at]}\n after  ${b[at]}` : ""}`);
  }
}
const changesetFiles = async (ctx: Ctx, id: string) => (await handlers["changesets.get"](ctx, { changesetId: id })).files;
const stateOf = async (ctx: Ctx, id: string) => (await handlers["changesets.get"](ctx, { changesetId: id })).changeset["state"];

test("an agent delete in a Review changes folder is staged: the file stays, Trash is empty, Discard keeps it and Approve moves it to Trash", async () => {
  const { k, ctx, agent, docs, plan } = await setup();
  const before = treeState(k);
  const out = await del(agent, plan);
  assert.equal(out.deleted, false, "not deleted yet");
  assert.match(out.changesetId ?? "", /^chg_/);
  sameTree(k, before, "nothing in the tree moved");
  assert.equal(eventsOf(k.events, "file.deleted").length, 0);
  assert.equal(fileRow(k, plan)?.["deleted_at"] ?? null, null);
  assert.deepEqual(await changesetFiles(ctx, out.changesetId!), [{ path: "plan.txt", fileId: plan, status: "deleted", added: 0, removed: 10, conflict: false }]);
  assert.deepEqual(eventsOf(k.events, "changeset.opened"), [{ changesetId: out.changesetId, folderId: docs, by: "agt_intake", fileCount: 1, threadId: "thr_1" }]);

  // staging it again changes nothing; the file still reads
  assert.equal((await del(agent, plan)).changesetId, out.changesetId);
  assert.equal((await changesetFiles(ctx, out.changesetId!)).length, 1);
  assert.equal(await textOf(ctx, plan), lines(10));

  assert.deepEqual(await handlers["changesets.discard"](ctx, { changesetId: out.changesetId! }), { discarded: true });
  sameTree(k, before, "the tree");

  const again = await del(agent, plan);
  const approved = await handlers["changesets.approve"](ctx, { changesetId: again.changesetId! });
  assert.deepEqual([approved.approved, approved.conflicts], [true, []]);
  assert.notEqual(fileRow(k, plan)?.["deleted_at"] ?? null, null, "Approve deleted it");
  assert.equal(eventsOf(k.events, "file.deleted").length, 1);
});

test("a person deletes straight away, an agent outside Review changes too, and a service is not staged", async () => {
  const { k, ctx, agent, loose, plan } = await setup();
  assert.deepEqual(await del(agent, loose), { deleted: true });
  assert.notEqual(fileRow(k, loose)?.["deleted_at"] ?? null, null);
  assert.deepEqual(await del(ctx, plan), { deleted: true });
  assert.equal(k.db.rows("files_changeset").length, 0, "no changeset opened");
  const svc = await setup();
  assert.deepEqual(await del({ ...svc.ctx, principal: { kind: "service", id: "svc_cron" } }, svc.plan), { deleted: true });
  assert.equal(svc.k.db.rows("files_changeset").length, 0);
  await expectCode("validation.not_found", () => del(svc.agent, "fil_nothere"));
});

test("an outside actor is staged like an agent", async () => {
  const { k, ctx, docs, plan } = await setup();
  const outside: Ctx = { ...ctx, principal: { kind: "actor", id: "act_reviewer" } };
  const out = await del(outside, plan);
  assert.equal(out.deleted, false);
  assert.equal(fileRow(k, plan)?.["deleted_at"] ?? null, null);
  const cs = (await handlers["changesets.get"](ctx, { changesetId: out.changesetId! })).changeset;
  assert.deepEqual([cs["by"], cs["folderId"]], ["act_reviewer", docs]);
});

test("an agent rename is staged and applied on Approve; renaming again edits the same row and renaming back removes it", async () => {
  const { k, ctx, agent, plan, notes } = await setup();
  const before = treeState(k);
  const r = await ren(agent, plan, "plan-v2.txt");
  assert.equal(r.file.name, "plan.txt", "the file still has its name");
  assert.match(r.changesetId ?? "", /^chg_/);
  sameTree(k, before, "the tree");
  assert.equal(eventsOf(k.events, "file.renamed").length, 0);
  assert.deepEqual(await changesetFiles(ctx, r.changesetId!), [{ path: "plan.txt", fileId: plan, status: "renamed", added: 0, removed: 0, conflict: false }]);

  const r2 = await ren(agent, plan, "plan-v3.txt");
  assert.equal(r2.changesetId, r.changesetId);
  assert.equal((await changesetFiles(ctx, r.changesetId!)).length, 1);
  assert.equal(k.db.rows("files_changeset_file").find((e) => e["path"] === "plan.txt")?.["new_name"], "plan-v3.txt");

  // a rename to the name it has, or back to it, leaves nothing to review and the empty changeset closes
  const back = await ren(agent, plan, "plan.txt");
  assert.equal(back.changesetId, r.changesetId);
  assert.equal(await stateOf(ctx, r.changesetId!), "discarded");
  sameTree(k, before, "the tree");
  const noop = await ren(agent, plan, "plan.txt");
  assert.equal(noop.changesetId, undefined, "already named so: no changeset");
  assert.equal(k.db.rows("files_changeset").length, 1);

  const real = await ren(agent, plan, "plan-final.txt");
  await ren(agent, notes, "notes-final.txt");
  assert.equal((await changesetFiles(ctx, real.changesetId!)).length, 2);
  const res = await handlers["changesets.approve"](ctx, { changesetId: real.changesetId! });
  assert.deepEqual([res.approved, res.conflicts], [true, []]);
  assert.equal(fileRow(k, plan)?.["name"], "plan-final.txt");
  assert.equal(fileRow(k, notes)?.["name"], "notes-final.txt");
  assert.equal(await versionsOf(ctx, plan), 1, "a rename adds no version");
});

test("rename: a bad name, a taken name (file or folder) and a file already deleted in the changeset are refused, and stage nothing", async () => {
  const { k, ctx, agent, plan, notes, docs } = await setup();
  const before = treeState(k);
  const rows = k.db.rows("files_changeset").length;
  await expectCode("validation.bad_input", () => ren(agent, plan, "a/b.txt"));
  await expectCode("validation.bad_input", () => ren(agent, plan, ".."));
  await expectCode("validation.bad_input", () => ren(agent, plan, "  "));
  await expectCode("validation.duplicate", () => ren(agent, plan, "notes.txt"));
  await expectCode("validation.duplicate", () => ren(agent, plan, "sub"));
  assert.equal(k.db.rows("files_changeset").length, rows, "a refused rename opens no changeset");
  sameTree(k, before, "the tree");
  const d = await del(agent, notes);
  await expectCode("validation.precondition_failed", () => ren(agent, notes, "gone.txt"));
  await expectCode("validation.precondition_failed", () => mov(agent, notes, docs, "gone.txt"));
  assert.equal((await changesetFiles(ctx, d.changesetId!)).length, 1);
});

test("a rename staged after a write keeps the staged text: Approve renames and then writes one version", async () => {
  const { k, ctx, agent, plan } = await setup();
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 1: "ONE" }) }, baseVersion: 1 });
  const r = await ren(agent, plan, "plan-new.txt");
  assert.equal(r.changesetId, w.changesetId);
  assert.deepEqual(await changesetFiles(ctx, w.changesetId!), [{ path: "plan.txt", fileId: plan, status: "renamed", added: 1, removed: 1, conflict: false }]);
  const res = await handlers["changesets.approve"](ctx, { changesetId: w.changesetId! });
  assert.equal(res.approved, true);
  assert.equal(fileRow(k, plan)?.["name"], "plan-new.txt");
  assert.equal(await textOf(ctx, plan), lines(10, { 1: "ONE" }));
  assert.equal(await versionsOf(ctx, plan), 2);
  // renaming back keeps the staged text instead of dropping the row
  const w2 = await handlers["files.write"](agent, { fileId: plan, content: { text: "two" } });
  await ren(agent, plan, "elsewhere.txt");
  await ren(agent, plan, "plan-new.txt");
  assert.deepEqual((await changesetFiles(ctx, w2.changesetId!)).map((f) => f.status), ["modified"]);
});

test("an agent move is staged: the file keeps its folder, Approve moves it and gives the new name", async () => {
  const { k, ctx, agent, docs, sub, plan, notes } = await setup();
  const before = treeState(k);
  const m = await mov(agent, plan, sub);
  assert.equal(m.file.folderId, docs);
  assert.match(m.changesetId ?? "", /^chg_/);
  sameTree(k, before, "the tree");
  assert.equal(eventsOf(k.events, "file.moved").length, 0);
  assert.deepEqual(await changesetFiles(ctx, m.changesetId!), [{ path: "plan.txt", fileId: plan, status: "renamed", added: 0, removed: 0, conflict: false }]);
  // a rename after a move keeps the destination
  await ren(agent, plan, "plan-in-sub.txt");
  assert.equal(k.db.rows("files_changeset_file").find((e) => e["path"] === "plan.txt")?.["new_name"], `${sub}/plan-in-sub.txt`);
  await mov(agent, notes, sub, "n.txt");
  const res = await handlers["changesets.approve"](ctx, { changesetId: m.changesetId! });
  assert.deepEqual([res.approved, res.conflicts], [true, []]);
  assert.deepEqual([fileRow(k, plan)?.["folder_id"], fileRow(k, plan)?.["name"]], [sub, "plan-in-sub.txt"]);
  assert.deepEqual([fileRow(k, notes)?.["folder_id"], fileRow(k, notes)?.["name"]], [sub, "n.txt"]);
  assert.equal(eventsOf(k.events, "file.moved").length, 2);
});

test("move: out of a Review changes folder is staged too; back to where it was removes the row; the plain handler reports a missing folder or a taken name", async () => {
  const { k, ctx, agent, docs, sub, free, plan, notes, loose } = await setup();
  const out = await mov(agent, plan, free);
  assert.equal(out.file.folderId, docs);
  assert.equal(fileRow(k, plan)?.["folder_id"], docs);
  const home = await mov(agent, plan, docs);
  assert.equal(home.changesetId, out.changesetId);
  assert.equal(await stateOf(ctx, out.changesetId!), "discarded");
  await expectCode("validation.not_found", () => mov(agent, plan, "fld_nothere"));
  await handlers["files.create"](ctx, { folderId: sub, name: "notes.txt", content: { text: "taken" } });
  await expectCode("validation.duplicate", () => mov(agent, notes, sub));
  await expectCode("validation.bad_input", () => mov(agent, notes, sub, "a/b"));
  // a file outside any Review changes folder moves directly, even into one
  const into = await mov(agent, loose, docs);
  assert.equal(into.changesetId, undefined);
  assert.equal(fileRow(k, loose)?.["folder_id"], docs);
});

test("Approve refuses a move whose destination name was taken meanwhile, and applies nothing", async () => {
  const { k, ctx, agent, sub, plan, notes } = await setup();
  const m = await mov(agent, plan, sub);
  await mov(agent, notes, sub);
  await handlers["files.create"](ctx, { folderId: sub, name: "plan.txt", content: { text: "person" } });
  const res = await handlers["changesets.approve"](ctx, { changesetId: m.changesetId! });
  assert.deepEqual([res.approved, res.conflicts], [false, ["plan.txt"]]);
  assert.notEqual(fileRow(k, notes)?.["folder_id"], sub, "the clean entry waits with the conflicting one");
  assert.equal(fileRow(k, plan)?.["name"], "plan.txt");
  assert.deepEqual((await changesetFiles(ctx, m.changesetId!)).map((f) => [f.path, f.conflict]), [["notes.txt", false], ["plan.txt", true]]);
});

test("Approve refuses a delete when the file changed after the changeset started", async () => {
  const { k, ctx, agent, plan } = await setup();
  const d = await del(agent, plan);
  await handlers["files.write"](ctx, { fileId: plan, content: { text: "someone edited" } });
  const res = await handlers["changesets.approve"](ctx, { changesetId: d.changesetId! });
  assert.deepEqual([res.approved, res.conflicts], [false, ["plan.txt"]]);
  assert.equal(fileRow(k, plan)?.["deleted_at"] ?? null, null);
});

test("a file the agent added in the changeset can be renamed, moved inside the covered folders and deleted, all in the changeset", async () => {
  const { k, ctx, agent, docs, sub, free } = await setup();
  const made = await handlers["files.create"](agent, { folderId: docs, name: "draft.md", content: { text: "# d\n" } });
  const id = made.file.fileId;
  const cs = made.changesetId!;
  const r = await ren(agent, id, "final.md");
  assert.deepEqual([r.changesetId, r.file.name], [cs, "final.md"]);
  assert.deepEqual((await changesetFiles(ctx, cs)).map((f) => f.path), ["final.md"]);
  const m = await mov(agent, id, sub);
  assert.equal(m.changesetId, cs);
  assert.deepEqual((await changesetFiles(ctx, cs)).map((f) => f.path), ["sub/final.md"]);
  await expectCode("validation.precondition_failed", () => mov(agent, id, free));
  const other = await handlers["files.create"](agent, { folderId: sub, name: "other.md", content: { text: "o" } });
  await expectCode("validation.duplicate", () => ren(agent, other.file.fileId, "final.md"));
  await del(agent, other.file.fileId);
  const res = await handlers["changesets.approve"](ctx, { changesetId: cs });
  assert.equal(res.approved, true);
  const row = k.db.rows("files_file").find((f) => f["name"] === "final.md" && f["folder_id"] === sub);
  assert.ok(row, "created under the new name in the new folder");
  assert.equal(await textOf(ctx, String(row["id"])), "# d\n");

  const gone = await handlers["files.create"](agent, { folderId: docs, name: "scrap.md", content: { text: "x" } });
  const dropped = await del(agent, gone.file.fileId);
  assert.deepEqual([dropped.deleted, dropped.changesetId], [true, gone.changesetId]);
  assert.equal(await stateOf(ctx, gone.changesetId!), "discarded", "nothing left for the reviewer");
  assert.equal(k.db.rows("files_file").some((f) => f["name"] === "scrap.md"), false);
});

// ---- save ----

const OK_LINT = { file: "agent_md", lines: 3, state: "ok", overrides: [], problems: [] };
function saveSetup(lint: unknown = OK_LINT) {
  const direct: { input: unknown }[] = [];
  const staging = async () => {
    const w = await setup({ "files.lint": () => lint });
    const saved = withAgentStaging({ ...handlers, "files.save": async (_c: Ctx, input: unknown) => { direct.push({ input }); return { versionId: "ver_direct", n: 9, lint: OK_LINT, added: 0, removed: 0 }; } });
    return { ...w, saved, direct };
  };
  return staging;
}
const save = (h: { saved: { "files.save": (c: Ctx, i: unknown) => Promise<unknown> } }, ctx: Ctx, input: Record<string, unknown>) =>
  h.saved["files.save"](ctx, input) as Promise<{ versionId: string; n: number; lint: unknown; added: number; removed: number; changesetId?: string }>;

test("an agent save in a Review changes folder is staged after the lint passes: no version is made until Approve", async () => {
  const h = await saveSetup()();
  const { k, ctx, agent, plan, docs } = h;
  const before = treeState(k);
  const out = await save(h, agent, { fileId: plan, text: lines(10, { 1: "ONE", 2: "TWO" }), baseVersion: 1, reason: "tidy" });
  assert.match(out.changesetId ?? "", /^chg_/);
  assert.deepEqual([out.n, out.added, out.removed], [1, 2, 2]);
  assert.equal(out.versionId, k.db.rows("files_file_version").find((v) => v["file_id"] === plan && v["n"] === 1)?.["id"], "the version it would replace");
  assert.deepEqual(out.lint, OK_LINT);
  assert.equal(h.direct.length, 0, "the plain save never ran");
  sameTree(k, before, "the tree");
  assert.equal(await versionsOf(ctx, plan), 1);
  assert.deepEqual(eventsOf(k.events, "changeset.opened"), [{ changesetId: out.changesetId, folderId: docs, by: "agt_intake", fileCount: 1, threadId: "thr_1" }]);
  assert.deepEqual(await changesetFiles(ctx, out.changesetId!), [{ path: "plan.txt", fileId: plan, status: "modified", added: 2, removed: 2, conflict: false }]);

  const again = await save(h, agent, { fileId: plan, text: lines(10, { 1: "ONE" }) });
  assert.equal(again.changesetId, out.changesetId);
  assert.deepEqual([again.added, again.removed], [1, 1]);
  assert.equal(eventsOf(k.events, "changeset.updated").length, 1);
  assert.equal((await handlers["changesets.approve"](ctx, { changesetId: out.changesetId! })).approved, true);
  assert.equal(await textOf(ctx, plan), lines(10, { 1: "ONE" }));
  assert.equal(await versionsOf(ctx, plan), 2);
});

test("save: a lint error, an unaccepted warning, a non-guidance file and a stale base are refused before anything is staged", async () => {
  const bad = { ...OK_LINT, state: "red", problems: [{ severity: "error", rule: "secret", message: "line 2 holds a secret" }] };
  const warn = { ...OK_LINT, state: "amber", problems: [{ severity: "warn", rule: "long", message: "VYRE.md is long" }] };
  for (const [lint, code, input] of [
    [bad, "validation.precondition_failed", {}],
    [warn, "validation.precondition_failed", {}],
    [{ ...OK_LINT, file: "other" }, "validation.precondition_failed", {}],
    [OK_LINT, "validation.version_conflict", { baseVersion: 2 }],
    [OK_LINT, "validation.bad_input", { baseVersion: 0 }],
  ] as [unknown, string, Record<string, unknown>][]) {
    const h = await saveSetup(lint)();
    const before = treeState(h.k);
    await expectCode(code, () => save(h, h.agent, { fileId: h.plan, text: "x", ...input }));
    assert.equal(h.k.db.rows("files_changeset").length, 0, "no changeset opened");
    assert.equal(h.k.db.rows("files_changeset_file").length, 0);
    sameTree(h.k, before, "the tree");
    assert.equal(h.direct.length, 0, "and never written directly");
  }
  const h = await saveSetup(warn)();
  assert.match((await save(h, h.agent, { fileId: h.plan, text: "x", acceptWarnings: true })).changesetId ?? "", /^chg_/);
});

test("save: a person, an agent outside Review changes and a bad input go to the plain save", async () => {
  const h = await saveSetup()();
  await save(h, h.ctx, { fileId: h.plan, text: "by a person" });
  await save(h, h.agent, { fileId: h.loose, text: "in an open folder" });
  await save(h, h.agent, { fileId: h.plan, text: 5 });
  await save(h, h.agent, { fileId: "fil_nothere", text: "x" });
  assert.equal(h.direct.length, 4);
  assert.equal(h.k.db.rows("files_changeset").length, 0);
  const del2 = await saveSetup()();
  await del2.saved["files.delete"](del2.agent, { fileId: del2.plan });
  assert.equal(del2.k.db.rows("files_changeset").length, 1, "withAgentStaging wraps the rest of the map as well");
});

test("withAgentStaging wraps only what the map has", () => {
  const plain = async () => ({});
  assert.deepEqual(Object.keys(withAgentStaging({})), []);
  const some = withAgentStaging({ "files.read": plain, "files.delete": plain });
  assert.deepEqual(Object.keys(some).sort(), ["files.delete", "files.read"]);
  assert.equal(some["files.read"], plain, "untouched handlers are the same function");
  assert.notEqual(some["files.delete"], plain);
});

// ---- the rule itself ----

test("an agent changes no file, version, blob or Trash row by any of write, create, save, delete, rename or move in a Review changes folder", async () => {
  const h = await saveSetup()();
  const { k, ctx, agent, docs, sub, plan, notes } = h;
  const before = treeState(k);
  const eventsBefore = k.events.length;
  const steps: [string, () => Promise<unknown>][] = [
    ["write", () => handlers["files.write"](agent, { fileId: plan, content: { text: "w" } })],
    ["create", () => handlers["files.create"](agent, { folderId: docs, name: "c.txt", content: { text: "c" } })],
    ["save", () => save(h, agent, { fileId: notes, text: "s" })],
    ["rename", () => ren(agent, notes, "r.txt")],
    ["move", () => mov(agent, plan, sub)],
    ["delete", () => del(agent, notes)],
  ];
  for (const [name, run] of steps) {
    await run();
    sameTree(k, before, `${name} left the tree as it was`);
  }
  assert.equal(h.direct.length, 0);
  assert.deepEqual(k.events.slice(eventsBefore).filter((e) => e.name.startsWith("file.")), [], "no file event: nothing happened to a file");
  // one changeset holds all of it, and Discard returns to the start
  const open = await handlers["changesets.list"](ctx, { state: "open" });
  assert.equal(open.total, 1);
  const only = open.changesets[0]!["changesetId"] as string;
  assert.deepEqual((await changesetFiles(ctx, only)).map((f) => f.status).sort(), ["added", "deleted", "renamed"]);
  await handlers["changesets.discard"](ctx, { changesetId: only });
  sameTree(k, before, "the tree");
  assert.equal(k.db.rows("files_changeset_file").length, 0);
});

test("a second asker, or a second agent, gets a changeset of its own", async () => {
  const { ctx, agent, plan, notes } = await setup();
  const a = await del(agent, plan);
  const other = await ren(agentOf(ctx, "agt_billing"), notes, "n2.txt");
  const forSam: Ctx = { ...agent, actingFor: "per_sam" };
  const s = await ren(forSam, notes, "n3.txt");
  assert.equal(new Set([a.changesetId, other.changesetId, s.changesetId]).size, 3);
});

test("the staging survives a host that refuses changeset events the capability does not declare, and still stops other emit errors", async () => {
  const { k, ctx, plan, notes, docs } = await setup();
  const refuse = (names: string[], why: string): Ctx => ({
    ...agentOf(ctx),
    emit: <T,>(name: string, subject: string, payload: T) => {
      if (names.includes(name)) throw Object.assign(new Error("refused"), { error: { code: "internal.unexpected", details: { why } } });
      return ctx.emit(name as never, subject, payload);
    },
  });
  const quiet = refuse(["changeset.opened", "changeset.updated", "changeset.discarded"], "event not declared in emits");
  const first = await del(quiet, plan);
  assert.match(first.changesetId ?? "", /^chg_/);
  assert.equal((await ren(quiet, notes, "n.txt")).changesetId, first.changesetId);
  assert.equal(eventsOf(k.events, "changeset.opened").length, 0);
  assert.equal((await changesetFiles(ctx, first.changesetId!)).length, 2, "the reviewer still sees it");
  assert.equal((await handlers["changesets.list"](ctx, { folderId: docs, state: "open" })).total, 1);
  const third = (await handlers["files.create"](ctx, { folderId: docs, name: "third.txt", content: { text: "t" } })).file.fileId;
  const broken = refuse(["changeset.opened", "changeset.updated"], "something else");
  await assert.rejects(ren(broken, third, "x.txt"), (e: unknown) => (e as { error?: { details?: { why?: string } } }).error?.details?.why === "something else");
});

// Run on the final commit together with changesets.test.ts (P-L4_04b).
