// The phone-address relay is offered the earlier code of a replayed invite as well as the current one, only while the invite is open and unexpired (review Pass 7).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openInviteHashes } from "./invite-hashes.ts";

function space(withEarlier = true): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE members_invites (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, state TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
  if (withEarlier) db.exec(`CREATE TABLE members_invite_codes (code_hash TEXT PRIMARY KEY, invite TEXT NOT NULL)`);
  const add = db.prepare("INSERT INTO members_invites (id, code_hash, state, expires_at, created_at) VALUES (?, ?, ?, ?, ?)");
  add.run("inv_open", "now-open", "open", 10_000, 30);
  add.run("inv_used", "now-used", "accepted", 10_000, 20);
  add.run("inv_old", "now-old", "open", 50, 10);
  if (withEarlier) {
    const early = db.prepare("INSERT INTO members_invite_codes (code_hash, invite) VALUES (?, ?)");
    early.run("first-open", "inv_open"); early.run("first-used", "inv_used"); early.run("first-old", "inv_old");
  }
  return db;
}
const of = (db: DatabaseSync) => ({ all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as unknown[] });

test("an open invite's earlier code is offered beside its current one; a used or expired invite offers neither", () => {
  assert.deepEqual(openInviteHashes(of(space()), 100, 200), ["now-open", "first-open"]);
});

test("the limit holds across both, and a Space without the earlier-codes table still offers its current codes", () => {
  assert.deepEqual(openInviteHashes(of(space()), 100, 1), ["now-open"]);
  assert.deepEqual(openInviteHashes(of(space(false)), 100, 200), ["now-open"]);
  assert.deepEqual(openInviteHashes(null, 100, 200), []);
});
