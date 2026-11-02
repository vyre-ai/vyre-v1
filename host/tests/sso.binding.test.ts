// A person is bound to a provider identity by verified identity, never by display name, and an address changing at the provider cannot take over another account.
import test from "node:test";
import assert from "node:assert/strict";
import { hasRecovery, hasSsoLink, linkSso, personForSso } from "../src/seams/people.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
function world() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE members_policy (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER, updated_by TEXT);
    CREATE TABLE members_invites (state TEXT, email TEXT, accepted_by TEXT);
    CREATE TABLE identity_accounts (person_id TEXT, keys_json TEXT);
    INSERT INTO members_invites VALUES ('accepted', 'alice@firm.test', 'usr_alice'), ('accepted', 'bob@firm.test', 'usr_bob');`);
  const db = { all: (sql: string, ...a: unknown[]) => raw.prepare(sql).all(...(a as never[])) as unknown[], run: (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[])) as unknown };
  return { db: db as never, raw };
}
const active = (): boolean => true;
const google = (email: string, subject: string) => ({ email, link: { tenant: "firm.test", subject } });

test("the first sign-in links the provider id to the person the address matches; after that the id is who they are", () => {
  const { db } = world();
  assert.equal(personForSso(db, active, "google", google("alice@firm.test", "sub-a")), "usr_alice");
  assert.equal(personForSso(db, active, "google", google("alice.smith@firm.test", "sub-a")), "usr_alice", "a new address at the provider is the same person");
});

test("an address that moved to someone else cannot take over the account it used to name", () => {
  const { db } = world();
  personForSso(db, active, "google", google("alice@firm.test", "sub-a"));
  personForSso(db, active, "google", google("bob@firm.test", "sub-b"));
  assert.equal(personForSso(db, active, "google", google("alice@firm.test", "sub-new-hire")), null, "the address was given to a new person; Alice stays Alice's");
  assert.equal(personForSso(db, active, "google", google("alice@firm.test", "sub-b")), "usr_bob", "Bob renamed to Alice's address is still Bob");
});

test("an identity from another organization links nothing, and a sign-in with no identity signs nobody in", () => {
  const { db } = world();
  personForSso(db, active, "microsoft", { email: "alice@firm.test", link: { tenant: "t1", subject: "oid-a" } });
  assert.equal(personForSso(db, active, "microsoft", { email: "alice@firm.test", link: { tenant: "t1", subject: "oid-other" } }), null);
  assert.equal(personForSso(db, active, "google", { email: "alice@firm.test" }), null, "an address alone is never enough");
  assert.equal(personForSso(db, active, "microsoft", { email: "alice@firm.test" }), null);
});

test("nothing about a display name is read: two Alices are two people", () => {
  const { db } = world();
  assert.equal(personForSso(db, active, "google", { email: "stranger@firm.test", link: { tenant: "firm.test", subject: "sub-x" } }), null);
});

test("a suspended person's link signs them in nowhere", () => {
  const { db } = world();
  personForSso(db, active, "google", google("alice@firm.test", "sub-a"));
  assert.equal(personForSso(db, () => false, "google", google("alice@firm.test", "sub-a")), null);
});

test("a signed-in person proves their own identity; one already linked to someone else stays theirs", () => {
  const { db, raw } = world();
  assert.equal(linkSso(db, "google", google("owner@firm.test", "sub-o"), "usr_owner"), true);
  assert.equal(hasSsoLink(db, "usr_owner"), true);
  assert.equal(linkSso(db, "google", google("owner@firm.test", "sub-o"), "usr_alice"), false, "that id is the owner's");
  assert.equal(linkSso(db, "google", google("second@firm.test", "sub-2"), "usr_owner"), false, "one person, one id per organization");
  assert.equal(linkSso(db, "google", { email: "x@firm.test" }, "usr_alice"), false);
  assert.equal(hasRecovery(db, "usr_owner"), false);
  raw.prepare("INSERT INTO identity_accounts VALUES (?, ?)").run("usr_owner", JSON.stringify({ personKeyByRecovery: "abc" }));
  assert.equal(hasRecovery(db, "usr_owner"), true);
});
