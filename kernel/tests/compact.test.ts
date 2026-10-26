// events.compact (P-CC_41) on a real events.db file: an erased person leaves no payload text anywhere in the database file or its WAL, the chain still verifies, an unrelated person's events keep their
// payloads, a second call changes nothing, and the tombstone is recorded for a restore.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LogStore } from "../src/log/index.ts";
import type { NewEvent } from "../src/log/index.ts";
import { compact, compactSeqs, isErased, subjectKey } from "../src/events/compact.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const EMAIL = "harlow.dana@example.test";
const PHONE = "+14155550123";
const NAME = "Dana Harlow-Reyes";
const OTHER = "maya.other@example.test";

const ev = (over: Partial<NewEvent>): NewEvent => ({ type: "record.updated", sv: 1, trace_id: TRACE, actor: "usr_admin", vis: "space", payload: {}, ...over });

function world() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-compact-")), "events.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  const store = new LogStore({ db, space: "sp_1", clock: () => 1_760_000_000_000 });
  store.appendBatch([
    ev({ type: "record.created", entity: "record", entity_id: "rec_dana", payload: { recordId: "rec_dana", fields: { name: NAME, email: EMAIL, phone: PHONE } } }),
    ev({ type: "record.updated", entity: "record", entity_id: "rec_dana", fields: ["note"], payload: { recordId: "rec_dana", fields: { note: `called ${PHONE} about the trust` } } }),
    ev({ type: "message.received", actor: "usr_dana", entity: "thread", entity_id: "thr_1", payload: { threadId: "thr_1", body: "please send the deed to me" } }),
    ev({ type: "message.received", actor: "agt_helper", on_behalf: "usr_dana", entity: "thread", entity_id: "thr_1", payload: { threadId: "thr_1", body: "drafting the deed for Dana" } }),
    ev({ type: "mail.received", actor: "svc_mail", entity: "thread", entity_id: "thr_2", payload: { from: EMAIL, subject: "my deed" } }),
    ev({ type: "record.created", entity: "record", entity_id: "rec_maya", payload: { recordId: "rec_maya", fields: { name: "Maya Other", email: OTHER } } }),
    ev({ type: "message.received", actor: "usr_maya", entity: "thread", entity_id: "thr_3", payload: { threadId: "thr_3", body: "unrelated words from maya" } }),
  ]);
  return { file, db, store };
}

/** Every byte of the database file and its WAL, as latin1 text, so a search finds a string wherever it sits in a page. */
function bytesOf(file: string): string {
  return [file, `${file}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f).toString("latin1")).join("\n");
}

test("an erased person leaves no payload text in events.db or its WAL, and the chain still verifies", async () => {
  const w = world();
  for (const s of [NAME, EMAIL, PHONE, "the deed to me", "drafting the deed", "trust"]) assert.ok(bytesOf(w.file).includes(s), `before: ${s} is in the file`);
  const out = await compact(w.store, { person: "usr_dana", entities: [{ type: "record", id: "rec_dana" }], identifiers: [EMAIL, PHONE, NAME] }, { db: w.db });
  assert.deepEqual(out.erased, [1, 2, 3, 4, 5]);
  assert.equal(out.already, 0);
  const left = bytesOf(w.file);
  for (const s of [NAME, EMAIL, PHONE, "the deed to me", "drafting the deed", "about the trust", "my deed", "Harlow"]) assert.equal(left.includes(s), false, `${s} is not anywhere in the database file or its WAL`);
  const v = w.store.verify();
  assert.equal(v.ok, true, "the chain verifies over the tombstoned payloads");
  for (const seq of [1, 2, 3, 4, 5]) {
    const e = w.store.get(seq)!;
    assert.equal(isErased(e), true, `event ${seq} reads as a tombstone`);
    assert.equal(w.store.proves(seq), false, `event ${seq} no longer proves a payload`);
  }
});

test("an unrelated person's events keep their payloads, and only matching events are touched", async () => {
  const w = world();
  await compact(w.store, { person: "usr_dana", entities: [{ type: "record", id: "rec_dana" }], identifiers: [EMAIL, PHONE, NAME] }, { db: w.db });
  for (const seq of [6, 7]) {
    assert.equal(isErased(w.store.get(seq)!), false, `event ${seq} is untouched`);
    assert.equal(w.store.proves(seq), true, `event ${seq} still proves its payload`);
  }
  assert.ok(bytesOf(w.file).includes(OTHER));
  assert.ok(bytesOf(w.file).includes("unrelated words from maya"));
});

test("compacting twice changes nothing, and the tombstone is recorded once for a restore to replay", async () => {
  const w = world();
  const subject = { person: "usr_dana", identifiers: [EMAIL] };
  const first = await compact(w.store, subject, { db: w.db, now: () => 42 });
  const headBefore = w.store.head;
  const second = await compact(w.store, subject, { db: w.db, now: () => 99 });
  assert.deepEqual(second.erased, []);
  assert.equal(second.already, first.erased.length);
  assert.deepEqual(w.store.head, headBefore);
  assert.deepEqual(w.db.prepare("SELECT kind, subject, at FROM tombstones").all().map((r) => ({ ...r })), [{ kind: "events", subject: subjectKey(subject), at: 42 }]);
});

test("a subject that names nothing is refused, and an identifier is also found where JSON escapes it (a quote)", async () => {
  const w = world();
  await assert.rejects(compact(w.store, {}, { db: w.db }), /name what to erase/);
  w.store.appendBatch([ev({ type: "note.saved", entity: "note", entity_id: "not_1", payload: { text: 'she said "Zoe Quill" twice' } })]);
  const out = await compact(w.store, { identifiers: ['"Zoe Quill"'] }, { db: w.db });
  assert.equal(out.erased.length, 1);
  assert.equal(bytesOf(w.file).includes("Quill"), false);
});

test("the tombstone key holds ids and hashes, never the erased text; compactSeqs replays by seq", async () => {
  const w = world();
  const subject = { person: "usr_dana", identifiers: [EMAIL, NAME] };
  const first = await compact(w.store, subject, { db: w.db });
  assert.equal(subjectKey(subject).includes("example.test"), false);
  assert.equal(subjectKey(subject).includes("Harlow"), false);
  assert.equal(bytesOf(w.file).includes(EMAIL), false, "the tombstones row in events.db does not hold the email");
  // a restore brings an older copy of the file back: replay the seqs the tombstone remembered and the payloads leave again
  const copy = world();
  assert.ok(bytesOf(copy.file).includes(EMAIL));
  const replay = await compactSeqs(copy.store, first.erased, { db: copy.db });
  assert.deepEqual(replay.erased, first.erased);
  assert.equal(bytesOf(copy.file).includes(EMAIL), false);
  assert.deepEqual((await compactSeqs(copy.store, [...first.erased, 999], { db: copy.db })).erased, [], "a second replay, and a seq that is not there, change nothing");
});

test("an entity is found by its id in other events' payloads, and by entity type when one is given", async () => {
  const w = world();
  w.store.appendBatch([ev({ type: "sync.row", payload: { entity: "record", id: "rec_dana", fields: { name: { v: NAME } } } })]);
  const out = await compact(w.store, { entities: [{ id: "rec_dana" }] }, { db: w.db });
  assert.ok(out.erased.includes(8), "the sync.row event that carries the id in its payload goes too");
  const typed = world();
  const none = await compact(typed.store, { entities: [{ type: "thread", id: "rec_dana" }] }, { db: typed.db });
  assert.ok(!none.erased.includes(1), "a different entity type does not match the record events by envelope");
});
