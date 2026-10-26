// files changesets, whole document (P-L9e_03): changesets.diff with context "full" returns every paragraph of the base and staged text around the changes, the changes keep their ids, and changesets.get names the file.
// Runs the real handlers over the module's own in-memory store and sealing, as the other files tests do. A booted daemon cannot stage a change: the gateway token is the Space owner, a person, and only an agent or an
// outside actor is staged (agent-stage.ts), so the agent principal is set on the handler context here.
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
      // files.tree reads access for the Shared with me count; those reads are not what these tests are about
      if (cap !== "access.lists" && cap !== "access.shares_of") calls.push({ cap, input });
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


const agentOf = (ctx: Ctx, id = "agt_docs"): Ctx => ({ ...ctx, principal: { kind: "agent", id }, actingFor: "per_maya", thread: "thr_1" });
const paragraphs = (n: number, edits: Record<number, string> = {}): string => Array.from({ length: n }, (_, i) => edits[i + 1] ?? `Paragraph ${i + 1} of the letter, with its own words.`).join("\n\n");

async function stage(edits: Record<number, string>, n = 14) {
  const k = open();
  const tree = await handlers["files.tree"](k.ctx, {});
  const personal = tree.roots.find((r) => r.key === "personal")?.folderId;
  assert.ok(personal);
  const docs = (await handlers["files.folder.create"](k.ctx, { parentId: personal, name: "Letters", reviewChanges: true })).folder.folderId;
  const letter = (await handlers["files.create"](k.ctx, { folderId: docs, name: "letter.md", content: { text: paragraphs(n) } })).file.fileId;
  const w = await handlers["files.write"](agentOf(k.ctx), { fileId: letter, content: { text: paragraphs(n, edits) }, baseVersion: 1 });
  assert.match(w.changesetId ?? "", /^chg_/);
  return { ctx: k.ctx, letter, cs: w.changesetId as string };
}

test("changesets.diff with context full returns every paragraph of the base and the staged text, and the same hunks as without it", async () => {
  const { ctx, cs } = await stage({ 2: "Paragraph 2 of the letter, with new words.", 12: "Paragraph 12 of the letter, now rewritten completely and differently." });
  const near = await handlers["changesets.diff"](ctx, { changesetId: cs, path: "letter.md" });
  const full = await handlers["changesets.diff"](ctx, { changesetId: cs, path: "letter.md", context: "full" });
  assert.equal(full.kind, "paragraph");
  assert.deepEqual(full.hunks.map((h) => h.hunkId), near.hunks.map((h) => h.hunkId), "the changes keep their ids");
  const lines = full.hunks.flatMap((h) => h.lines);
  const base = lines.filter((l) => l.op !== "add").map((l) => l.text);
  const staged = lines.filter((l) => l.op !== "del").map((l) => l.text);
  assert.deepEqual(base, Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1} of the letter, with its own words.`), "every paragraph of the base, once");
  assert.equal(staged.length, 14, "every paragraph of the staged text, once");
  assert.equal(staged[1], "Paragraph 2 of the letter, with new words.");
  assert.equal(staged[11], "Paragraph 12 of the letter, now rewritten completely and differently.");
  assert.ok(near.hunks.flatMap((h) => h.lines).length < lines.length, "without full the context is a few paragraphs");
  assert.ok(lines.some((l) => l.op === "add" && l.marks !== undefined), "the changed pair carries its marks");
  assert.equal(full.hunks[0]?.newStart, 1, "the first hunk starts at the top");
  const last = full.hunks[full.hunks.length - 1];
  assert.equal(last?.lines[last.lines.length - 1]?.text, "Paragraph 14 of the letter, with its own words.", "the last hunk runs to the end");
  assert.deepEqual([full.added, full.removed], [near.added, near.removed], "the counts do not change");
});

test("changesets.get names the file of a staged change; context only takes hunks or full", async () => {
  const { ctx, letter, cs } = await stage({ 3: "Paragraph 3, changed." });
  const got = await handlers["changesets.get"](ctx, { changesetId: cs });
  assert.deepEqual(got.files.map((f) => [f.path, f.fileId, f.status]), [["letter.md", letter, "modified"]]);
  const hunks = await handlers["changesets.diff"](ctx, { changesetId: cs, path: "letter.md", context: "hunks" });
  assert.equal(hunks.hunks.length, 1);
  await expectCode("validation.bad_input", () => handlers["changesets.diff"](ctx, { changesetId: cs, path: "letter.md", context: "everything" }));
});

test("a text file with full context is every line, and a change in the middle keeps the lines on both sides", async () => {
  const k = open();
  const tree = await handlers["files.tree"](k.ctx, {});
  const personal = tree.roots.find((r) => r.key === "personal")?.folderId;
  assert.ok(personal);
  const docs = (await handlers["files.folder.create"](k.ctx, { parentId: personal, name: "Notes", reviewChanges: true })).folder.folderId;
  const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const file = (await handlers["files.create"](k.ctx, { folderId: docs, name: "plan.txt", content: { text: base.join("\n") } })).file.fileId;
  const edited = base.map((l, i) => (i === 14 ? "line 15 changed" : l));
  const w = await handlers["files.write"](agentOf(k.ctx), { fileId: file, content: { text: edited.join("\n") }, baseVersion: 1 });
  const full = await handlers["changesets.diff"](k.ctx, { changesetId: w.changesetId as string, path: "plan.txt", context: "full" });
  assert.equal(full.kind, "text");
  assert.deepEqual(full.hunks.flatMap((h) => h.lines).filter((l) => l.op !== "add").map((l) => l.text), base);
  assert.deepEqual(full.hunks.flatMap((h) => h.lines).filter((l) => l.op !== "del").map((l) => l.text), edited);
});
