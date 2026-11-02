// A person is bound to a provider identity by verified identity, never by display name, and an address changing at the provider cannot take over another account.
import test from "node:test";
import assert from "node:assert/strict";
import { createPeopleExtras, hasRecovery, hasSsoLink, linkSso, personForSso } from "../src/seams/people.ts";
import { createSsoTickets } from "../src/routes/sso-signin.ts";

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

test("a finished sign-in matches the person to the address it proved, as the host, through the company connection; nobody signed in matches nothing", async () => {
  const { db } = world();
  const calls: { name: string; input: unknown; as: unknown }[] = [];
  const tickets = createSsoTickets();
  const extras = createPeopleExtras({ access: () => ({ principal: () => ({ status: "active" }), allResources: () => [] }) as never, db, call: async (name, input, as) => { calls.push({ name, input, as }); return {}; }, sso: { tickets } });
  const sso = extras("identity", {})!["sso"] as { resolve(key: string, ticket: string): string | null; prove(key: string, invite: string): { bind(person: string): void } | null };
  assert.equal(sso.resolve("google", tickets.make("google", "alice@firm.test", { tenant: "firm.test", subject: "sub-a" })), "usr_alice");
  assert.equal(sso.resolve("microsoft", tickets.make("microsoft", "bob@firm.test", { tenant: "t1", subject: "oid-b" })), "usr_bob");
  assert.deepEqual(calls, [
    { name: "google.match_proven", input: { person: "usr_alice", email: "alice@firm.test" }, as: undefined },
    { name: "microsoft.match_proven", input: { person: "usr_bob", email: "bob@firm.test", tenant: "t1" }, as: undefined },
  ], "run as the host (no person named), with the address the provider proved");
  calls.length = 0;
  assert.equal(sso.resolve("google", tickets.make("google", "stranger@firm.test", { tenant: "firm.test", subject: "sub-x" })), null);
  assert.equal(sso.resolve("okta", tickets.make("okta", "alice@firm.test", { tenant: "okta.firm.test", subject: "o-a" })), "usr_alice");
  assert.deepEqual(calls, [], "nobody signed in matches nothing, and Okta carries no company mail");
  // joining by invitation: the proof is bound once the person exists, and matched then
  tickets.hold("invite:inv_1", "google", { email: "new@firm.test", link: { tenant: "firm.test", subject: "sub-new" } });
  sso.prove("google", "invite:inv_1")!.bind("usr_new");
  assert.deepEqual(calls, [{ name: "google.match_proven", input: { person: "usr_new", email: "new@firm.test" }, as: undefined }]);
});
