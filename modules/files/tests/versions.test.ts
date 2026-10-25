// files versions: diff modes, the restore path and the binary collision rule (spec 2.16, 4.11; golden 4 extension).
// @reads /modules/files/migrations/0001_files_tree.sql
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


const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A stored (method 0) zip holding one entry. The reader does not check CRCs. */
function zipOf(name: string, content: string): Uint8Array {
  const n = utf8(name);
  const data = utf8(content);
  const le = (v: number, len: number): number[] => Array.from({ length: len }, (_, i) => Math.floor(v / 2 ** (8 * i)) & 0xff);
  const local = [...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(n.length, 2), ...le(0, 2), ...n, ...data];
  const central = [...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(n.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(0, 4), ...n];
  const end = [...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(1, 2), ...le(1, 2), ...le(central.length, 4), ...le(local.length, 4), ...le(0, 2)];
  return Uint8Array.from([...local, ...central, ...end]);
}
const docx = (paragraphs: string[]): Uint8Array =>
  zipOf("word/document.xml", `<w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);

async function setup(): Promise<{ ctx: Ctx; events: { name: string; payload: unknown }[]; folderId: string }> {
  const { ctx, events } = open();
  const tree = await handlers["files.tree"](ctx, {});
  const folderId = idOf(tree.roots.find((root) => root.key === "personal")?.folderId, "personal");
  return { ctx, events, folderId };
}

test("text diff: default compares the current version with the one before, with counts and context hunks", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["files.create"](ctx, { folderId, name: "notes.txt", content: { text: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj" } });
  const fileId = made.file.fileId;
  await handlers["files.write"](ctx, { fileId, content: { text: "a\nb\nC\nd\ne\nf\ng\nh\ni\nj\nk" }, baseVersion: 1 });
  const d = await handlers["files.diff"](ctx, { fileId });
  assert.equal(d.kind, "text");
  assert.equal(d.identical, false);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.equal(d.hunks.length, 2);
  const first = d.hunks[0]!;
  assert.equal(first.hunkId, "h1");
  assert.deepEqual(first.lines.filter((l) => l.op !== "ctx").map((l) => `${l.op}:${l.text}`), ["del:c", "add:C"]);
  assert.equal(first.oldStart, 1);
  assert.equal(first.oldLines, 6);
  assert.equal(first.newLines, 6);
  const last = d.hunks[1]!;
  assert.deepEqual(last.lines.filter((l) => l.op === "add").map((l) => l.text), ["k"]);
  assert.ok(first.lines.every((l) => l.marks === undefined), "unified mode carries no word marks");
});

test("word mode marks the changed words on both sides of a changed line", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["files.create"](ctx, { folderId, name: "w.txt", content: { text: "the quick brown fox" } });
  const fileId = made.file.fileId;
  await handlers["files.write"](ctx, { fileId, content: { text: "the slow brown cat" }, baseVersion: 1 });
  const d = await handlers["files.diff"](ctx, { fileId, mode: "words" });
  const lines = d.hunks[0]!.lines;
  const del = lines.find((l) => l.op === "del")!;
  const add = lines.find((l) => l.op === "add")!;
  assert.deepEqual(del.marks, [{ from: 4, to: 9 }, { from: 16, to: 19 }]);
  assert.deepEqual(add.marks, [{ from: 4, to: 8 }, { from: 15, to: 18 }]);
});

test("markdown defaults to a paragraph diff; unified is still available", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["files.create"](ctx, { folderId, name: "doc.md", content: { text: "# T\n\nOne para.\n\nTwo para." } });
  const fileId = made.file.fileId;
  await handlers["files.write"](ctx, { fileId, content: { text: "# T\n\nOne para changed.\n\nTwo para." }, baseVersion: 1 });
  const p = await handlers["files.diff"](ctx, { fileId });
  assert.equal(p.kind, "paragraph");
  assert.equal(p.added, 1);
  assert.equal(p.removed, 1);
  assert.deepEqual(p.hunks[0]!.lines.find((l) => l.op === "add")?.text, "One para changed.");
  const u = await handlers["files.diff"](ctx, { fileId, mode: "unified" });
  assert.equal(u.kind, "text");
});

test("docx diff reads paragraphs from the document part; a Google-native export snapshot diffs the same way", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["files.create"](ctx, { folderId, name: "letter.docx", content: { base64: b64(docx(["Dear Ana", "Body one", "Regards"])) } });
  const fileId = made.file.fileId;
  await handlers["files.write"](ctx, { fileId, content: { base64: b64(docx(["Dear Ana", "Body two", "Regards"])) }, baseVersion: 1 });
  const d = await handlers["files.diff"](ctx, { fileId });
  assert.equal(d.kind, "paragraph");
  assert.deepEqual([d.added, d.removed], [1, 1]);
  assert.deepEqual(d.hunks[0]!.lines.filter((l) => l.op !== "ctx").map((l) => `${l.op}:${l.text}`), ["del:Body one", "add:Body two"]);

  const snap = await handlers["files.create"](ctx, { folderId, name: "Brief", kind: "google_native", content: { base64: b64(docx(["Intro", "Plan A"])) }, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  await handlers["files.write"](ctx, { fileId: snap.file.fileId, content: { base64: b64(docx(["Intro", "Plan B"])) }, baseVersion: 1 });
  const s = await handlers["files.diff"](ctx, { fileId: snap.file.fileId });
  assert.equal(s.kind, "paragraph");
  assert.deepEqual([s.added, s.removed], [1, 1]);
});

test("images return both blob ids for the slider; other binaries report identical or not", async () => {
  const { ctx, folderId } = await setup();
  const img = await handlers["files.create"](ctx, { folderId, name: "p.png", content: { base64: b64(Uint8Array.from([1, 2, 3])) } });
  await handlers["files.write"](ctx, { fileId: img.file.fileId, content: { base64: b64(Uint8Array.from([1, 2, 4])) }, baseVersion: 1 });
  const i = await handlers["files.diff"](ctx, { fileId: img.file.fileId });
  assert.equal(i.kind, "image");
  assert.equal(i.identical, false);
  assert.ok(i.images?.left && i.images.right && i.images.left !== i.images.right);
  assert.equal(i.hunks.length, 0);

  const pdf = await handlers["files.create"](ctx, { folderId, name: "a.pdf", content: { base64: b64(Uint8Array.from([9, 9, 9])) } });
  await handlers["files.write"](ctx, { fileId: pdf.file.fileId, content: { base64: b64(Uint8Array.from([9, 9, 9])) }, baseVersion: 1 });
  const same = await handlers["files.diff"](ctx, { fileId: pdf.file.fileId });
  assert.equal(same.kind, "binary");
  assert.equal(same.identical, true);
});

test("explicit from and to, restore adds an identical version, a version of another file is refused", async () => {
  const { ctx, folderId } = await setup();
  const made = await handlers["files.create"](ctx, { folderId, name: "r.txt", content: { text: "one" } });
  const fileId = made.file.fileId;
  await handlers["files.write"](ctx, { fileId, content: { text: "two" }, baseVersion: 1 });
  await handlers["files.write"](ctx, { fileId, content: { text: "three" }, baseVersion: 2 });
  const { versions } = await handlers["files.versions"](ctx, { fileId });
  const at = (n: number): string => idOf(versions.find((v) => v.n === n)?.versionId, `v${n}`);
  const wide = await handlers["files.diff"](ctx, { fileId, from: at(1), to: at(3) });
  assert.deepEqual([wide.added, wide.removed], [1, 1]);
  const restored = await handlers["files.restore_version"](ctx, { fileId, versionId: at(1) });
  const back = await handlers["files.diff"](ctx, { fileId, from: at(1), to: restored.versionId });
  assert.equal(back.identical, true);
  assert.equal(back.hunks.length, 0);
  const other = await handlers["files.create"](ctx, { folderId, name: "o.txt", content: { text: "x" } });
  const foreign = (await handlers["files.versions"](ctx, { fileId: other.file.fileId })).versions[0]!.versionId;
  await expectCode("validation.not_found", () => handlers["files.diff"](ctx, { fileId, from: foreign }));
  await expectCode("validation.not_found", () => handlers["files.diff"](ctx, { fileId: "fil_missing" }));
  await expectCode("validation.bad_input", () => handlers["files.diff"](ctx, { fileId, mode: "sideways" }));
  const first = await handlers["files.diff"](ctx, { fileId: other.file.fileId });
  assert.deepEqual([first.added, first.removed], [1, 0]);
});

test("binary conflict: the newest save is current and the other stays as a labelled version", async () => {
  const { ctx, events, folderId } = await setup();
  const made = await handlers["files.create"](ctx, { folderId, name: "scan.pdf", content: { base64: b64(Uint8Array.from([1])) } });
  const fileId = made.file.fileId;
  await handlers["files.write"](ctx, { fileId, content: { base64: b64(Uint8Array.from([2])) }, baseVersion: 1 });
  const saved = await handlers["files.write"](ctx, { fileId, content: { base64: b64(Uint8Array.from([3])) }, baseVersion: 1 });
  assert.equal(saved.file.version, 3);
  const current = await handlers["files.read"](ctx, { fileId });
  assert.equal(current.base64, b64(Uint8Array.from([3])));

  const { versions } = await handlers["files.versions"](ctx, { fileId });
  assert.equal(versions.length, 3);
  const kept = versions.find((v) => v.n === 2)!;
  assert.equal(kept.reason, "conflict");
  assert.match(kept.name ?? "", /^Conflict: kept \(saved by per_maya\)$/);
  assert.equal(versions.find((v) => v.n === 1)?.reason, undefined);
  const keptRead = await handlers["files.read"](ctx, { fileId, versionId: kept.versionId });
  assert.equal(keptRead.base64, b64(Uint8Array.from([2])));

  const ev = events.filter((e) => e.name === "file.conflict_kept");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0]!.payload, { fileId, keptVersionId: kept.versionId, currentVersionId: saved.versionId });

  // A matching baseVersion is an ordinary save, with no conflict event.
  await handlers["files.write"](ctx, { fileId, content: { base64: b64(Uint8Array.from([4])) }, baseVersion: 3 });
  assert.equal(events.filter((e) => e.name === "file.conflict_kept").length, 1);
});

test("text and Google-native writes keep the version_conflict refusal", async () => {
  const { ctx, events, folderId } = await setup();
  const t = await handlers["files.create"](ctx, { folderId, name: "t.txt", content: { text: "a" } });
  await handlers["files.write"](ctx, { fileId: t.file.fileId, content: { text: "b" }, baseVersion: 1 });
  await expectCode("validation.version_conflict", () => handlers["files.write"](ctx, { fileId: t.file.fileId, content: { text: "c" }, baseVersion: 1 }));
  const g = await handlers["files.create"](ctx, { folderId, name: "G", kind: "google_native", content: { text: "snap" } });
  await handlers["files.write"](ctx, { fileId: g.file.fileId, content: { text: "snap2" }, baseVersion: 1 });
  await expectCode("validation.version_conflict", () => handlers["files.write"](ctx, { fileId: g.file.fileId, content: { text: "snap3" }, baseVersion: 1 }));
  assert.equal(events.filter((e) => e.name === "file.conflict_kept").length, 0);
});
