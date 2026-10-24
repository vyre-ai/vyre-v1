// files changesets: agent writes staged in Review changes folders, 3-way merge on Approve, conflicts to the reviewer, discard leaves no trace.
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
import { merge3 } from "../handlers/changesets.ts";

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

async function setup(answers: Record<string, unknown> = {}) {
  const k = open(answers);
  const tree = await handlers["files.tree"](k.ctx, {});
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  const docs = (await handlers["files.folder.create"](k.ctx, { parentId: personal, name: "Docs", reviewChanges: true })).folder.folderId;
  const plan = (await handlers["files.create"](k.ctx, { folderId: docs, name: "plan.txt", content: { text: lines(10) } })).file.fileId;
  return { k, ctx: k.ctx, agent: agentOf(k.ctx), personal, docs, plan };
}
const textOf = async (ctx: Ctx, fileId: string): Promise<string> => (await handlers["files.read"](ctx, { fileId, as: "text" })).text ?? "";
const versionsOf = async (ctx: Ctx, fileId: string): Promise<number> => (await handlers["files.versions"](ctx, { fileId })).versions.length;

test("merge3: disjoint edits merge, identical edits collapse, overlapping or touching edits conflict", () => {
  const base = ["a", "b", "c", "d", "e"];
  assert.deepEqual(merge3(base, ["a", "B", "c", "d", "e"], ["a", "b", "c", "d", "E"]), { lines: ["a", "B", "c", "d", "E"], conflicts: 0 });
  assert.deepEqual(merge3(base, ["a", "X", "c", "d", "e"], ["a", "X", "c", "d", "e"]), { lines: ["a", "X", "c", "d", "e"], conflicts: 0 });
  assert.equal(merge3(base, ["a", "X", "c", "d", "e"], ["a", "Y", "c", "d", "e"]).conflicts, 1);
  assert.equal(merge3(base, ["a", "c", "d", "e"], ["a", "Y", "c", "d", "e"]).conflicts, 1, "a delete against an edit");
  assert.equal(merge3(base, ["a", "B", "c", "d", "e"], ["a", "b", "C", "d", "e"]).conflicts, 1, "neighbouring lines are the reviewer's call");
  assert.deepEqual(merge3(["a", "b"], ["s", "a", "b"], ["a", "b", "e"]), { lines: ["s", "a", "b", "e"], conflicts: 0 });
  assert.deepEqual(merge3([], ["x"], []), { lines: ["x"], conflicts: 0 });
  assert.deepEqual(merge3(base, base, ["a", "b"]), { lines: ["a", "b"], conflicts: 0 });
});

test("an agent write in a Review changes folder is staged: the file, its versions and the blob store do not move", async () => {
  const { k, ctx, agent, docs, plan } = await setup();
  const blobsBefore = k.db.rows("files_blob").length;
  const staged = lines(10, { 2: "LINE 2" });
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: staged }, baseVersion: 1 });
  assert.match(w.changesetId ?? "", /^chg_/);
  assert.equal(w.versionId, undefined);
  assert.equal(w.file.version, 1);
  assert.equal(await textOf(ctx, plan), lines(10));
  assert.equal(await versionsOf(ctx, plan), 1);
  assert.equal(k.db.rows("files_blob").length, blobsBefore, "nothing sealed into the blob store before Approve");
  assert.deepEqual(eventsOf(k.events, "changeset.opened"), [{ changesetId: w.changesetId, folderId: docs, by: "agt_intake", fileCount: 1, threadId: "thr_1" }]);
  assert.equal(eventsOf(k.events, "file.version_added").length, 1, "only the person's first version");

  const got = await handlers["changesets.get"](ctx, { changesetId: w.changesetId! });
  assert.deepEqual(got.files, [{ path: "plan.txt", status: "modified", added: 1, removed: 1, conflict: false }]);
  const cs = got.changeset as Record<string, unknown>;
  assert.deepEqual([cs["state"], cs["by"], cs["onBehalfOf"], cs["baseVersion"], cs["fileCount"], cs["threadId"], cs["folderId"]], ["open", "agt_intake", "per_maya", "1", 1, "thr_1", docs]);

  // a second write by the same agent joins the same changeset
  const again = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 2: "LINE 2", 3: "LINE 3" }) } });
  assert.equal(again.changesetId, w.changesetId);
  assert.equal(eventsOf(k.events, "changeset.updated").length, 1);
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: w.changesetId! })).files[0]?.added, 2);

  // people write straight through; a folder without Review changes does too, even for an agent
  const person = await handlers["files.write"](ctx, { fileId: plan, content: { text: lines(10, { 9: "nine" }) }, baseVersion: 1 });
  assert.ok(person.versionId);
  assert.equal(person.changesetId, undefined);
  const tree = await handlers["files.tree"](ctx, {});
  const personal = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  const open1 = (await handlers["files.create"](ctx, { folderId: personal, name: "free.txt", content: { text: "x" } })).file.fileId;
  const direct = await handlers["files.write"](agent, { fileId: open1, content: { text: "y" } });
  assert.ok(direct.versionId);
  assert.equal(await textOf(ctx, open1), "y");

  // a stale baseVersion on the first staged write is the usual conflict
  const second = await handlers["files.create"](ctx, { folderId: docs, name: "other.txt", content: { text: "a" } });
  await handlers["files.write"](ctx, { fileId: second.file.fileId, content: { text: "b" } });
  await expectCode("validation.version_conflict", () => handlers["files.write"](agent, { fileId: second.file.fileId, content: { text: "c" }, baseVersion: 1 }));
  await expectCode("validation.bad_input", () => handlers["files.write"](agent, { fileId: second.file.fileId, content: { text: "c" }, baseVersion: 0 }));
  await expectCode("validation.bad_input", () => handlers["files.write"](agent, { fileId: second.file.fileId, content: {} }));
  await expectCode("validation.not_found", () => handlers["files.write"](agent, { fileId: "fil_nothere", content: { text: "c" } }));
});

test("approve with no change underneath: the staged text becomes the next version, once", async () => {
  const { k, ctx, agent, plan } = await setup();
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 2: "LINE 2" }) }, baseVersion: 1 });
  const cs = w.changesetId!;
  const res = await handlers["changesets.approve"](ctx, { changesetId: cs, message: "ship it" });
  assert.equal(res.approved, true);
  assert.deepEqual(res.conflicts, []);
  assert.equal(res.versionIds.length, 1);
  assert.equal(await textOf(ctx, plan), lines(10, { 2: "LINE 2" }));
  assert.equal(await versionsOf(ctx, plan), 2);
  assert.equal((await handlers["files.versions"](ctx, { fileId: plan })).versions.at(-1)?.reason ?? (await handlers["files.versions"](ctx, { fileId: plan })).versions[0]?.reason, "ship it");
  assert.deepEqual(eventsOf(k.events, "changeset.approved"), [{ changesetId: cs, folderId: (await handlers["changesets.get"](ctx, { changesetId: cs })).changeset["folderId"], by: "per_maya", fileCount: 1 }]);
  const row = (await handlers["changesets.get"](ctx, { changesetId: cs })).changeset as Record<string, unknown>;
  assert.deepEqual([row["state"], row["reviewer"]], ["approved", "per_maya"]);
  assert.ok(k.db.rows("files_changeset_file").every((r) => r["content"] === null), "the staged copy is dropped after Approve");
  const again = await handlers["changesets.approve"](ctx, { changesetId: cs });
  assert.deepEqual(again.versionIds, res.versionIds);
  assert.equal(await versionsOf(ctx, plan), 2, "approving twice commits once");
  // after Approve the next agent write opens a new changeset
  const next = await handlers["files.write"](agent, { fileId: plan, content: { text: "z" } });
  assert.notEqual(next.changesetId, cs);
  await expectCode("validation.precondition_failed", async () => {
    await handlers["changesets.discard"](ctx, { changesetId: cs });
  });
});

test("approve merges three ways when the file moved on; overlapping edits go to the reviewer and nothing is committed", async () => {
  const { k, ctx, agent, plan } = await setup();
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 2: "AGENT 2" }) }, baseVersion: 1 });
  await handlers["files.write"](ctx, { fileId: plan, content: { text: lines(10, { 9: "MAYA 9" }) }, baseVersion: 1 });
  const merged = await handlers["changesets.approve"](ctx, { changesetId: w.changesetId! });
  assert.equal(merged.approved, true);
  assert.equal(await textOf(ctx, plan), lines(10, { 2: "AGENT 2", 9: "MAYA 9" }));
  assert.equal(await versionsOf(ctx, plan), 3);

  // a conflict: both sides changed line 5
  const w2 = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 2: "AGENT 2", 5: "AGENT 5", 9: "MAYA 9" }) }, baseVersion: 3 });
  await handlers["files.write"](ctx, { fileId: plan, content: { text: lines(10, { 2: "AGENT 2", 5: "MAYA 5", 9: "MAYA 9" }) }, baseVersion: 3 });
  const blocked = await handlers["changesets.approve"](ctx, { changesetId: w2.changesetId! });
  assert.deepEqual([blocked.approved, blocked.versionIds, blocked.conflicts], [false, [], ["plan.txt"]]);
  assert.equal(await versionsOf(ctx, plan), 4, "no version from the blocked approve");
  assert.equal(await textOf(ctx, plan), lines(10, { 2: "AGENT 2", 5: "MAYA 5", 9: "MAYA 9" }));
  const got = await handlers["changesets.get"](ctx, { changesetId: w2.changesetId! });
  assert.equal(got.changeset["state"], "open");
  assert.equal(got.files[0]?.conflict, true);
  assert.equal(eventsOf(k.events, "changeset.approved").length, 1);

  // the agent reads what is there now and writes again: the base moves up and the conflict clears
  const fixed = lines(10, { 2: "AGENT 2", 5: "BOTH 5", 9: "MAYA 9" });
  await handlers["files.write"](agent, { fileId: plan, content: { text: fixed } });
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: w2.changesetId! })).files[0]?.conflict, false);
  const done = await handlers["changesets.approve"](ctx, { changesetId: w2.changesetId! });
  assert.equal(done.approved, true);
  assert.equal(await textOf(ctx, plan), fixed);
});

test("a file the agent adds is created on Approve, and the agent can keep writing to the id it was given", async () => {
  const { k, ctx, agent, docs, plan } = await setup();
  const made = await handlers["files.create"](agent, { folderId: docs, name: "new.md", content: { text: "# Hi\n" } });
  const cs = made.changesetId!;
  assert.match(made.file.fileId, /^fil_/);
  assert.equal(made.file.name, "new.md");
  assert.equal(k.db.rows("files_file").filter((r) => r["name"] === "new.md").length, 0, "not in the tree yet");
  await handlers["files.write"](agent, { fileId: made.file.fileId, content: { text: "# Hello\n" } });
  const again = await handlers["files.create"](agent, { folderId: docs, name: "new.md", content: { text: "# Hello there\n" } });
  assert.equal(again.file.fileId, made.file.fileId);
  assert.deepEqual((await handlers["changesets.get"](ctx, { changesetId: cs })).files, [{ path: "new.md", status: "added", added: 1, removed: 0, conflict: false }]);
  await expectCode("validation.duplicate", () => handlers["files.create"](agent, { folderId: docs, name: "plan.txt", content: { text: "x" } }));
  assert.equal(plan.length > 0, true);
  const res = await handlers["changesets.approve"](ctx, { changesetId: cs });
  assert.equal(res.approved, true);
  assert.equal(res.versionIds.length, 1);
  const row = k.db.rows("files_file").find((r) => r["name"] === "new.md");
  assert.ok(row);
  assert.equal(await textOf(ctx, String(row["id"])), "# Hello there\n");

  // a name taken by someone else in the meantime is a conflict, not an overwrite
  const late = await handlers["files.create"](agent, { folderId: docs, name: "late.md", content: { text: "agent" } });
  await handlers["files.create"](ctx, { folderId: docs, name: "late.md", content: { text: "person" } });
  const blocked = await handlers["changesets.approve"](ctx, { changesetId: late.changesetId! });
  assert.deepEqual([blocked.approved, blocked.conflicts], [false, ["late.md"]]);
});

test("nested folders share the changeset of the folder that has Review changes on; paths are relative to it", async () => {
  const { ctx, agent, docs, plan } = await setup();
  const sub = (await handlers["files.folder.create"](ctx, { parentId: docs, name: "sub" })).folder;
  assert.equal(sub.reviewChanges, true, "a new folder inherits Review changes");
  const a = (await handlers["files.create"](ctx, { folderId: sub.folderId, name: "a.txt", content: { text: "one" } })).file.fileId;
  const w1 = await handlers["files.write"](agent, { fileId: plan, content: { text: "p" } });
  const w2 = await handlers["files.write"](agent, { fileId: a, content: { text: "two" } });
  assert.equal(w1.changesetId, w2.changesetId);
  const got = await handlers["changesets.get"](ctx, { changesetId: w1.changesetId! });
  assert.deepEqual(got.files.map((f) => f.path), ["plan.txt", "sub/a.txt"]);
  // another agent, or the same agent for another asker, gets its own changeset
  const other = await handlers["files.write"](agentOf(ctx, "agt_billing"), { fileId: a, content: { text: "three" } });
  assert.notEqual(other.changesetId, w1.changesetId);
  const list = await handlers["changesets.list"](ctx, { state: "open" });
  assert.equal(list.total, 2);
  assert.equal((await handlers["changesets.list"](ctx, { state: "open", limit: 1 })).next, "1");
  assert.equal((await handlers["changesets.list"](ctx, { state: "approved" })).changesets.length, 0);
  assert.equal((await handlers["changesets.list"](ctx, { mine: true })).changesets.length, 2, "mine: the asker is Maya");
  assert.equal((await handlers["changesets.list"](personOf(ctx, "per_sam"), { mine: true })).changesets.length, 0);
  await expectCode("validation.bad_input", () => handlers["changesets.list"](ctx, { state: "nope" }));
});

test("discard leaves no trace: no blob, no version, no staged row, no comment", async () => {
  const { k, ctx, agent, docs, plan } = await setup();
  const before = { blobs: k.db.rows("files_blob").length, versions: k.db.rows("files_file_version").length, files: k.db.rows("files_file").length };
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 1: "x" }) } });
  await handlers["files.create"](agent, { folderId: docs, name: "gone.txt", content: { text: "bye" } });
  await handlers["changesets.comments.add"](ctx, { changesetId: w.changesetId!, anchor: { kind: "line", line: 1, path: "plan.txt" }, text: "no" });
  assert.equal((await handlers["changesets.discard"](ctx, { changesetId: w.changesetId! })).discarded, true);
  assert.deepEqual({ blobs: k.db.rows("files_blob").length, versions: k.db.rows("files_file_version").length, files: k.db.rows("files_file").length }, before);
  assert.equal(k.db.rows("files_changeset_file").length, 0);
  assert.equal(k.db.rows("files_changeset_comment").length, 0);
  assert.equal(await textOf(ctx, plan), lines(10));
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: w.changesetId! })).changeset["state"], "discarded");
  assert.deepEqual(eventsOf(k.events, "changeset.discarded"), [{ changesetId: w.changesetId, folderId: docs, by: "per_maya" }]);
  assert.equal((await handlers["changesets.discard"](ctx, { changesetId: w.changesetId! })).discarded, true);
  await expectCode("validation.precondition_failed", () => handlers["changesets.approve"](ctx, { changesetId: w.changesetId! }));
  await expectCode("validation.not_found", () => handlers["changesets.discard"](ctx, { changesetId: "chg_none" }));
  // the agent starts a fresh changeset afterwards
  const next = await handlers["files.write"](agent, { fileId: plan, content: { text: "again" } });
  assert.notEqual(next.changesetId, w.changesetId);
});

test("request changes: unsent comments go to the agent thread once, the changeset stays open and reopens on the next write", async () => {
  const { k, ctx, agent, plan } = await setup({ "chat.post": { message: {} } });
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 2: "LINE 2" }) } });
  const cs = w.changesetId!;
  await expectCode("validation.bad_input", () => handlers["changesets.request_changes"](ctx, { changesetId: cs }));
  const c1 = await handlers["changesets.comments.add"](ctx, { changesetId: cs, anchor: { kind: "line", line: 2, path: "plan.txt" }, text: "Why was this changed?", mentions: ["agt_intake"] });
  assert.equal(c1.comment["changesetId"], cs);
  assert.deepEqual([c1.comment["by"], c1.comment["resolved"], c1.comment["mentions"]], ["per_maya", false, ["agt_intake"]]);
  assert.deepEqual(k.calls.map((c) => c.cap), ["chat.post"], "an @ agent answers in the thread");
  assert.deepEqual(k.calls[0]?.input, { threadId: "thr_1", body: "plan.txt: Why was this changed?", mentions: [{ kind: "agent", id: "agt_intake" }] });
  await handlers["changesets.comments.add"](ctx, { changesetId: cs, anchor: { kind: "file", path: "plan.txt" }, text: "Keep the old heading." });
  assert.equal((await handlers["changesets.comments.list"](ctx, { changesetId: cs })).comments.length, 2);
  assert.ok(eventsOf(k.events, "file.comment_added").length === 2);
  await expectCode("validation.not_found", () => handlers["changesets.comments.add"](ctx, { changesetId: cs, anchor: { kind: "file", path: "missing.txt" }, text: "x" }));

  const sent = await handlers["changesets.request_changes"](ctx, { changesetId: cs, note: "Two things." });
  assert.equal(sent.sent, 1, "the comment the agent already got is not sent again");
  assert.deepEqual(k.calls.at(-1)?.input, { threadId: "thr_1", body: "Two things.\nplan.txt: Keep the old heading." });
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: cs })).changeset["state"], "changes_requested");
  assert.deepEqual(eventsOf(k.events, "changeset.changes_requested").map((e) => (e as { comments: number }).comments), [1]);
  await handlers["files.write"](agent, { fileId: plan, content: { text: lines(10, { 2: "LINE 2 again" }) } });
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: cs })).changeset["state"], "open");
  await handlers["changesets.discard"](ctx, { changesetId: cs });
  await expectCode("validation.precondition_failed", () => handlers["changesets.request_changes"](ctx, { changesetId: cs, note: "late" }));
  await expectCode("validation.precondition_failed", () => handlers["changesets.comments.add"](ctx, { changesetId: cs, anchor: { kind: "file" }, text: "late" }));
});

test("diff and revert: hunks against the recorded base, one hunk or one file at a time", async () => {
  const { ctx, agent, plan } = await setup();
  const big = (edits: Record<number, string>): string => lines(30, edits);
  await handlers["files.write"](ctx, { fileId: plan, content: { text: big({}) } });
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: big({ 2: "line TWO", 25: "line 25 changed" }) } });
  const cs = w.changesetId!;
  const d = await handlers["changesets.diff"](ctx, { changesetId: cs, path: "plan.txt" });
  assert.deepEqual([d.kind, d.added, d.removed, d.identical, d.hunks.map((h) => h.hunkId)], ["text", 2, 2, false, ["h1", "h2"]]);
  const words = await handlers["changesets.diff"](ctx, { changesetId: cs, path: "plan.txt", mode: "words" });
  assert.ok(words.hunks[0]?.lines.some((l) => l.op === "add" && l.marks !== undefined));
  await expectCode("validation.not_found", () => handlers["changesets.diff"](ctx, { changesetId: cs, path: "x.txt" }));
  await expectCode("validation.bad_input", () => handlers["changesets.diff"](ctx, { changesetId: cs, path: "plan.txt", mode: "wide" }));

  assert.equal((await handlers["changesets.revert_change"](ctx, { changesetId: cs, path: "plan.txt", hunkId: "h1" })).fileCount, 1);
  const after = await handlers["changesets.diff"](ctx, { changesetId: cs, path: "plan.txt" });
  assert.deepEqual([after.added, after.removed, after.hunks.length], [1, 1, 1]);
  assert.equal(after.hunks[0]?.lines.find((l) => l.op === "add")?.text, "line 25 changed");
  await expectCode("validation.not_found", () => handlers["changesets.revert_change"](ctx, { changesetId: cs, path: "plan.txt", hunkId: "h9" }));
  assert.equal((await handlers["changesets.revert_change"](ctx, { changesetId: cs, path: "plan.txt", hunkId: "h1" })).fileCount, 0, "a file back at its base leaves the changeset");

  // a change on the very first line, and a whole-file revert
  await handlers["files.write"](agent, { fileId: plan, content: { text: big({ 1: "FIRST" }) } });
  await handlers["changesets.revert_change"](ctx, { changesetId: cs, path: "plan.txt", hunkId: "h1" });
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: cs })).files.length, 0);
  await handlers["files.write"](agent, { fileId: plan, content: { text: "all new" } });
  assert.equal((await handlers["changesets.revert_change"](ctx, { changesetId: cs, path: "plan.txt" })).fileCount, 0);
  assert.deepEqual(eventsOf((await setup()).k.events, "changeset.updated"), []);
});

test("diff of images and binary files carries no hunks", async () => {
  const { ctx, agent, docs } = await setup();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  const bin = Buffer.from([1, 0, 2, 0, 3]).toString("base64");
  const img = (await handlers["files.create"](ctx, { folderId: docs, name: "pic.png", mime: "image/png", content: { base64: png } })).file.fileId;
  const dat = (await handlers["files.create"](ctx, { folderId: docs, name: "data.bin", content: { base64: bin } })).file.fileId;
  const w = await handlers["files.write"](agent, { fileId: img, content: { base64: Buffer.from([9, 9, 9]).toString("base64") } });
  await handlers["files.write"](agent, { fileId: dat, content: { base64: Buffer.from([7, 0, 7]).toString("base64") } });
  const di = await handlers["changesets.diff"](ctx, { changesetId: w.changesetId!, path: "pic.png" });
  assert.deepEqual([di.kind, di.hunks.length, di.identical], ["image", 0, false]);
  assert.ok(di.images?.left);
  const db = await handlers["changesets.diff"](ctx, { changesetId: w.changesetId!, path: "data.bin" });
  assert.equal(db.kind, "binary");
  await expectCode("validation.precondition_failed", () => handlers["changesets.revert_change"](ctx, { changesetId: w.changesetId!, path: "data.bin", hunkId: "h1" }));
  // a binary file whose current version moved on cannot merge line by line
  await handlers["files.write"](ctx, { fileId: dat, content: { base64: Buffer.from([5, 0, 5]).toString("base64") } });
  const res = await handlers["changesets.approve"](ctx, { changesetId: w.changesetId! });
  assert.deepEqual([res.approved, res.conflicts], [false, ["data.bin"]]);
});

test("approve: edit access is needed, and the asker can be barred from approving their own agent's work", async () => {
  const { ctx, agent, plan } = await setup({ "settings.get": { row: { value: true } } });
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: "x" } });
  const denied: Ctx = { ...ctx, authorize: () => ({ effect: "deny", reason: "test", decisionId: "dec_no" }) };
  await expectCode("permission.no_grant", () => handlers["changesets.approve"](denied, { changesetId: w.changesetId! }));
  await expectCode("validation.precondition_failed", () => handlers["changesets.approve"](ctx, { changesetId: w.changesetId! }));
  assert.equal((await handlers["changesets.approve"](personOf(ctx, "per_sam"), { changesetId: w.changesetId! })).approved, true);
  assert.equal((await handlers["changesets.get"](ctx, { changesetId: w.changesetId! })).changeset["reviewer"], "per_sam");
});

test("approve with push: commit then push through git; a failed push leaves the changeset approved with the push pending", async () => {
  const ok = await setup({ "git.commit": { sha: "abc1234", files: 1 }, "git.push": { pushed: true } });
  await expectCode("validation.precondition_failed", async () => {
    const w = await handlers["files.write"](ok.agent, { fileId: ok.plan, content: { text: "x" } });
    await handlers["changesets.approve"](ok.ctx, { changesetId: w.changesetId!, push: true });
  });
  (ok.k.ctx.db as { run(sql: string, ...a: unknown[]): unknown }).run("UPDATE files_folder SET git = ? WHERE id = ?", 1, ok.docs);
  const cs = (await handlers["changesets.list"](ok.ctx, { state: "open" })).changesets[0]!["changesetId"] as string;
  const res = await handlers["changesets.approve"](ok.ctx, { changesetId: cs, message: "Update plan", push: true });
  assert.deepEqual([res.approved, res.commit], [true, "abc1234"]);
  const gitCalls = ok.k.calls.filter((c) => c.cap.startsWith("git."));
  assert.deepEqual(gitCalls.map((c) => c.cap), ["git.commit", "git.push"]);
  assert.deepEqual(gitCalls[0]?.input, { folderId: ok.docs, message: "Update plan" });
  assert.deepEqual(eventsOf(ok.k.events, "changeset.approved").map((e) => (e as { commit?: string }).commit), ["abc1234"]);

  const bad = await setup({ "git.commit": { sha: "def5678" }, "git.push": new Error("remote down") });
  (bad.k.ctx.db as { run(sql: string, ...a: unknown[]): unknown }).run("UPDATE files_folder SET git = ? WHERE id = ?", 1, bad.docs);
  const w = await handlers["files.write"](bad.agent, { fileId: bad.plan, content: { text: "y" } });
  const res2 = await handlers["changesets.approve"](bad.ctx, { changesetId: w.changesetId!, push: true });
  assert.deepEqual([res2.approved, res2.commit], [true, "def5678"]);
  const row = (await handlers["changesets.get"](bad.ctx, { changesetId: w.changesetId! })).changeset;
  assert.deepEqual([row["state"], row["pushPending"]], ["approved", true]);
});

test("review with an outside agent: an actor with Use on the folder, never Edit", async () => {
  const { k, ctx, agent, docs, plan } = await setup({
    "access.actors.create": { actor: { id: "act_rev" }, oneTimeToken: "tok", expiresAt: 1_760_000_999_000 },
    "access.share": { grant: {} },
  });
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: "x" } });
  const res = await handlers["changesets.review_externally"](ctx, { changesetId: w.changesetId! });
  assert.deepEqual(res, { actorId: "act_rev", expiresAt: 1_760_000_999_000 });
  assert.deepEqual(k.calls.map((c) => c.cap), ["access.actors.create", "access.share"]);
  assert.deepEqual(k.calls[1]?.input, { resource: { type: "folder", id: docs }, subject: { kind: "actor", id: "act_rev" }, level: "use" });
  assert.deepEqual(eventsOf(k.events, "changeset.sent_for_review"), [{ changesetId: w.changesetId, actorId: "act_rev" }]);
  const known = await handlers["changesets.review_externally"](ctx, { changesetId: w.changesetId!, actorId: "act_codex" });
  assert.equal(known.actorId, "act_codex");
  assert.equal(k.calls.filter((c) => c.cap === "access.actors.create").length, 1, "an existing actor is not registered again");
  assert.equal(k.db.rows("files_changeset_review").length, 2);
  await handlers["changesets.discard"](ctx, { changesetId: w.changesetId! });
  assert.equal(k.db.rows("files_changeset_review").length, 0);
  await expectCode("validation.precondition_failed", () => handlers["changesets.review_externally"](ctx, { changesetId: w.changesetId! }));
});

test("approve applies a staged move ('<folderId>/<name>' in new_name) through files.move; a deleted target folder is a conflict", async () => {
  const { k, ctx, agent, docs, plan } = await setup();
  const run = (sql: string, ...a: unknown[]): unknown => (k.db as unknown as { run(sql: string, ...a: unknown[]): unknown }).run(sql, ...a);
  const archive = (await handlers["files.folder.create"](ctx, { parentId: docs, name: "Archive" })).folder.folderId;
  const w = await handlers["files.write"](agent, { fileId: plan, content: { text: "staged" } });
  const cs = w.changesetId!;
  // turn the staged write into a move with a new name and nothing else staged (what agent-stage.ts stages for files.move)
  run("UPDATE files_changeset_file SET status = ?, new_name = ?, content = NULL WHERE changeset_id = ?", "renamed", `${archive}/moved.txt`, cs);
  const before = k.db.rows("files_file").find((r) => r["id"] === plan);
  assert.equal(before?.["folder_id"], docs, "staging does not move the file");
  const res = await handlers["changesets.approve"](ctx, { changesetId: cs });
  assert.deepEqual([res.approved, res.conflicts], [true, []]);
  const after = k.db.rows("files_file").find((r) => r["id"] === plan);
  assert.deepEqual([after?.["folder_id"], after?.["name"]], [archive, "moved.txt"]);
  assert.equal(await textOf(ctx, plan), lines(10), "a move alone leaves the content as it was");

  // a second changeset: the folder it moves to is deleted before Approve
  const gone = (await handlers["files.folder.create"](ctx, { parentId: docs, name: "Gone" })).folder.folderId;
  const w2 = await handlers["files.write"](agent, { fileId: plan, content: { text: "again" } });
  run("UPDATE files_changeset_file SET status = ?, new_name = ?, content = NULL WHERE changeset_id = ?", "renamed", `${gone}/other.txt`, w2.changesetId);
  run("UPDATE files_folder SET deleted_at = ? WHERE id = ?", 1_760_000_500_000, gone);
  const bad = await handlers["changesets.approve"](ctx, { changesetId: w2.changesetId! });
  assert.equal(bad.approved, false);
  assert.equal(bad.conflicts.length, 1);
  const still = k.db.rows("files_file").find((r) => r["id"] === plan);
  assert.deepEqual([still?.["folder_id"], still?.["name"]], [archive, "moved.txt"], "a conflict commits nothing");
});
