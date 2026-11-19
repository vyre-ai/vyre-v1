// Database backups: every transition, the retention rule, when one is due (r42-sites-run, slice 5).
import test from "node:test";
import assert from "node:assert/strict";
import { due, expired, fileName, stepBackup } from "../ops/backups.ts";
import type { Backup, BackupEvent, BackupState } from "../ops/backups.ts";

const DAY = 24 * 3_600_000;
const NOW = 100 * DAY;
const b = (state: BackupState, o: Partial<Backup> = {}): Backup => ({ id: "b1", siteId: "s1", kind: "postgres", state, by: "schedule", at: NOW, ...o });
const EVENTS: [string, BackupEvent][] = [
  ["start", { t: "start", at: 1 }],
  ["done", { t: "done", at: 1, bytes: 10, fileId: "fil_1" }],
  ["fail", { t: "fail", at: 1, note: "x" }],
  ["lost", { t: "lost", at: 1 }],
];
const TABLE: Record<BackupState, Record<string, string>> = {
  queued: { start: "running", done: "-", fail: "failed", lost: "-" },
  running: { start: "=", done: "ready", fail: "failed", lost: "failed" },
  ready: { start: "-", done: "=", fail: "-", lost: "-" },
  failed: { start: "-", done: "-", fail: "=", lost: "=" },
};
for (const [from, row] of Object.entries(TABLE) as [BackupState, Record<string, string>][])
  for (const [name, ev] of EVENTS)
    test(`backup ${from} + ${name}`, () => {
      const r = stepBackup(b(from), ev);
      const want = row[name];
      if (want === "-") assert.equal(r.ok, false);
      else {
        assert.equal(r.ok, true);
        if (r.ok) {
          assert.equal(r.backup.state, want === "=" ? from : want);
          assert.equal(r.same, want === "=");
        }
      }
    });

test("a finished backup carries its size and file; a lost one says to back up again", () => {
  const r = stepBackup(b("running"), { t: "done", at: 9, bytes: 123, fileId: "fil_9" });
  assert.equal(r.ok && r.backup.bytes, 123);
  assert.equal(r.ok && r.backup.fileId, "fil_9");
  const l = stepBackup(b("running"), { t: "lost", at: 9 });
  assert.match(l.ok ? (l.backup.note ?? "") : "", /Back up again/);
});

test("retention keeps the newest seven and anything under two weeks, and never the newest, a pinned one or one in progress", () => {
  const all: Backup[] = [];
  for (let i = 0; i < 12; i++) all.push(b("ready", { id: `d${i}`, at: NOW - i * 5 * DAY })); // 0, 5, 10, ... 55 days old
  all.push(b("ready", { id: "pin", at: NOW - 90 * DAY, pinned: true }));
  all.push(b("running", { id: "go", at: NOW - 90 * DAY }));
  const gone = new Set(expired(all, NOW));
  assert.equal(gone.has("d0"), false);
  assert.equal(gone.has("pin"), false);
  assert.equal(gone.has("go"), false);
  // d0..d6 are the newest seven; d7 (35 days old) and older go
  for (let i = 0; i < 7; i++) assert.equal(gone.has(`d${i}`), false, `d${i}`);
  for (let i = 7; i < 12; i++) assert.equal(gone.has(`d${i}`), true, `d${i}`);
});

test("past the newest seven, a backup under two weeks old stays", () => {
  const all: Backup[] = [];
  for (let i = 0; i < 10; i++) all.push(b("ready", { id: `h${i}`, at: NOW - i * 3_600_000 }));
  assert.deepEqual(expired(all, NOW), []);
});

test("the newest ready backup survives even when it is old", () => {
  assert.deepEqual(expired([b("ready", { id: "only", at: NOW - 400 * DAY })], NOW), []);
});

test("a failed backup goes after a day, unless pinned", () => {
  const all = [b("failed", { id: "f1", at: NOW - 2 * DAY }), b("failed", { id: "f2", at: NOW - 3_600_000 }), b("failed", { id: "f3", at: NOW - 9 * DAY, pinned: true })];
  assert.deepEqual(expired(all, NOW), ["f1"]);
});

test("a scheduled backup is due when none is going and the last ready one is a day old", () => {
  assert.equal(due([], NOW), true);
  assert.equal(due([b("ready", { at: NOW - 23 * 3_600_000 })], NOW), false);
  assert.equal(due([b("ready", { at: NOW - 25 * 3_600_000 })], NOW), true);
  assert.equal(due([b("ready", { at: NOW - 48 * 3_600_000 }), b("running", { id: "x" })], NOW), false);
  assert.equal(due([b("queued")], NOW), false);
  assert.equal(due([b("failed", { at: NOW - 1000 })], NOW), true);
});

test("the file name sorts by time and has no unsafe characters", () => {
  assert.equal(fileName("My Site!", Date.parse("2026-11-19T10:05:07Z")), "My-Site--2026-11-19T10-05-07.sql.gz");
  assert.equal(fileName("", 0).startsWith("site-1970-01-01T00-00-00"), true);
});
