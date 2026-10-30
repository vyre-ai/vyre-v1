// Members' calendars come into Calendar with their mail: setup connects each included member's primary calendar (never an excluded or outside address), excluding a member removes it and
// including them again brings it back, and the mailbox pass asks Calendar to sync the calendar. A Calendar failure never fails the setup or the mailbox pass.
import test from "node:test";
import assert from "node:assert/strict";
import { dwdMapMember, dwdSetExcluded, dwdSetup, receivePush } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { CONN, codeOf, harness, NOW, seedDelegation } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const SAM = "sam@vyre.test";
const members = [{ userId: "usr_maya01", email: MAYA }, { userId: "usr_sam01", email: SAM }, { userId: "usr_kim01", email: "kim@vyre.test" }, { userId: "usr_out01", email: "ext@other.test" }];

function admin(): Harness {
  const h = harness({ admin: true, members });
  ensure(h.ctx);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", { body: { emailAddress: "admin@vyre.test", historyId: "1000" } });
  return h;
}

test("setup connects each included member's primary calendar, owned by them, and never an excluded or outside address", async () => {
  const h = admin();
  h.ctx.db.run(`INSERT INTO google_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, "kim@vyre.test", "usr_kim01", 1, 1, null, NOW);
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  assert.deepEqual(h.calls("calendar.connect_provider").map((c) => c.input), [
    { provider: "google", ownerId: "usr_maya01", account: MAYA, connectionId: CONN, remoteId: "primary" },
    { provider: "google", ownerId: "usr_sam01", account: SAM, connectionId: CONN, remoteId: "primary" },
  ]);
});

test("excluding a member removes their calendar; including them again connects a fresh one", async () => {
  const h = admin();
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  const before = h.calls("calendar.connect_provider").length;
  await dwdSetExcluded(h.ctx, { email: MAYA, excluded: true });
  const off = h.calls("calendar.connect_provider").slice(before);
  assert.deepEqual(off.map((c) => c.input), [{ provider: "google", ownerId: "usr_maya01", account: MAYA, connectionId: CONN, remoteId: "primary", connected: false }]);
  await dwdSetExcluded(h.ctx, { email: MAYA, excluded: false });
  assert.deepEqual(h.calls("calendar.connect_provider").slice(before + 1).map((c) => c.input), [{ provider: "google", ownerId: "usr_maya01", account: MAYA, connectionId: CONN, remoteId: "primary" }]);
  // an address that was never mapped has no calendar to touch
  const n = h.calls("calendar.connect_provider").length;
  await dwdSetExcluded(h.ctx, { email: "stranger@vyre.test", excluded: true });
  assert.equal(h.calls("calendar.connect_provider").length, n);
});

test("a Gmail push also asks Calendar to sync that member's calendar, never connects one, and an excluded member's is never synced", async () => {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01", excluded: true }] });
  for (const e of [MAYA, SAM]) h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, e, CONN, "1000", null, null, null, null, null);
  h.ctx.db.run(`INSERT INTO google_calendar (email, "calendarId") VALUES (?, ?)`, MAYA, "cld_maya0001");
  h.ctx.db.run(`INSERT INTO google_calendar (email, "calendarId") VALUES (?, ?)`, SAM, "cld_sam00001");
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history", { body: { history: [], historyId: "1001" } });
  await receivePush(h.ctx, { kind: "gmail", messageId: "p1", mailbox: MAYA, historyId: "1500" });
  assert.deepEqual(h.calls("calendar.sync_now").map((c) => c.input), [{ calendarId: "cld_maya0001" }]);
  assert.equal(h.calls("calendar.connect_provider").length, 0, "connecting takes an admin, so a mailbox pass never does it");
  await receivePush(h.ctx, { kind: "gmail", messageId: "p2", mailbox: SAM, historyId: "1500" });
  assert.equal(h.calls("calendar.sync_now").length, 1);
});

test("a member who has no calendar connected (they came after setup) has nothing to sync", async () => {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedDelegation(h);
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, MAYA, CONN, "1000", null, null, null, null, null);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history", { body: { history: [], historyId: "1001" } });
  await receivePush(h.ctx, { kind: "gmail", messageId: "p9", mailbox: MAYA, historyId: "1" });
  assert.equal(h.calls("calendar.sync_now").length, 0);
});

test("setup remembers which Calendar calendar each member's is, and excluding a member forgets theirs", async () => {
  const h = admin();
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  assert.deepEqual(h.rows(`SELECT email FROM google_calendar`).map((r) => String(r.email)).sort(), ["kim@vyre.test", MAYA, SAM]);
  await dwdSetExcluded(h.ctx, { email: MAYA, excluded: true });
  assert.deepEqual(h.rows(`SELECT email FROM google_calendar`).map((r) => String(r.email)).sort(), ["kim@vyre.test", SAM]);
  await dwdSetExcluded(h.ctx, { email: MAYA, excluded: false });
  assert.deepEqual(h.rows(`SELECT email FROM google_calendar`).map((r) => String(r.email)).sort(), ["kim@vyre.test", MAYA, SAM]);
});

test("a Calendar failure never fails the setup or the mailbox pass", async () => {
  const h = admin();
  const real = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => { if (cap.startsWith("calendar.")) throw new Error("calendar is down"); return real(cap, input); };
  const out = await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  assert.equal(out.configured, true);
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, MAYA, CONN, "1000", null, null, null, null, null);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history", { body: { history: [], historyId: "1001" } });
  assert.deepEqual(await receivePush(h.ctx, { kind: "gmail", messageId: "p3", mailbox: MAYA, historyId: "1" }), { accepted: true });
  assert.equal(h.scheduled.length, 1);
});

test("the admin who sets up is matched to the admin address even though no invitation holds it, and never taken over another person's address", async () => {
  const h = harness({ admin: true, members, principal: { kind: "person", id: "usr_admin01" } });
  ensure(h.ctx);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", { body: { emailAddress: "admin@vyre.test", historyId: "1000" } });
  const out = await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  assert.equal(out.mappedMembers, 4);
  assert.deepEqual(h.rows(`SELECT "userId", mapped FROM google_member WHERE email = ?`, "admin@vyre.test"), [{ userId: "usr_admin01", mapped: 1 }]);
  assert.ok(h.calls("mail.auto_connect_members")[0]!.input.members instanceof Array);
  assert.ok((h.calls("mail.auto_connect_members")[0]!.input.members as { email: string }[]).some((m) => m.email === "admin@vyre.test"));
  // an address an invitation already gave to someone else is theirs
  const h2 = harness({ admin: true, members: [...members, { userId: "usr_other01", email: "admin@vyre.test" }], principal: { kind: "person", id: "usr_admin01" } });
  ensure(h2.ctx);
  h2.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", { body: { emailAddress: "admin@vyre.test", historyId: "1000" } });
  await dwdSetup(h2.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  assert.deepEqual(h2.rows(`SELECT "userId" FROM google_member WHERE email = ?`, "admin@vyre.test"), [{ userId: "usr_other01" }]);
});

test("an admin matches an address to a person, whose mail and calendar then come in; a clash is refused until the first match is taken away", async () => {
  const h = admin();
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  const before = h.calls("mail.auto_connect_members").length;
  const out = await dwdMapMember(h.ctx, { email: "New.Person@Vyre.test", userId: "usr_new001", idempotencyKey: "m1" });
  assert.deepEqual(out, { email: "new.person@vyre.test", userId: "usr_new001", mapped: true, connected: true });
  assert.equal(h.calls("mail.auto_connect_members").length, before + 1);
  assert.deepEqual(h.calls("mail.auto_connect_members").at(-1)!.input.members, [{ userId: "usr_new001", email: "new.person@vyre.test" }]);
  assert.ok(h.calls("calendar.connect_provider").some((c) => c.input.account === "new.person@vyre.test"));
  await assert.rejects(() => dwdMapMember(h.ctx, { email: "new.person@vyre.test", userId: "usr_other01", idempotencyKey: "m2" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(() => dwdMapMember(h.ctx, { email: "second@vyre.test", userId: "usr_new001", idempotencyKey: "m3" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(() => dwdMapMember(h.ctx, { email: "x@elsewhere.test", userId: "usr_new002", idempotencyKey: "m4" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => dwdMapMember(h.ctx, { email: "x@vyre.test", userId: "maya", idempotencyKey: "m5" }), (e) => codeOf(e) === "validation.bad_input");
  const off = await dwdMapMember(h.ctx, { email: "new.person@vyre.test", idempotencyKey: "m6" });
  assert.deepEqual(off, { email: "new.person@vyre.test", mapped: false, connected: false });
  assert.deepEqual(h.rows(`SELECT mapped, "userId" FROM google_member WHERE email = ?`, "new.person@vyre.test"), [{ mapped: 0, userId: null }]);
  assert.equal((await dwdMapMember(h.ctx, { email: "second@vyre.test", userId: "usr_new001", idempotencyKey: "m7" })).mapped, true);
});

test("a person who is excluded stays unconnected when matched", async () => {
  const h = admin();
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  await dwdSetExcluded(h.ctx, { email: "ex@vyre.test", excluded: true });
  const before = h.calls("mail.auto_connect_members").length;
  const out = await dwdMapMember(h.ctx, { email: "ex@vyre.test", userId: "usr_ex0001", idempotencyKey: "m1" });
  assert.deepEqual([out.mapped, out.connected], [true, false]);
  assert.equal(h.calls("mail.auto_connect_members").length, before);
});
