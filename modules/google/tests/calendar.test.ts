// Members' calendars come into Calendar with their mail: setup connects each included member's primary calendar (never an excluded or outside address), excluding a member removes it and
// including them again brings it back, and the mailbox pass asks Calendar to sync the calendar. A Calendar failure never fails the setup or the mailbox pass.
import test from "node:test";
import assert from "node:assert/strict";
import { dwdSetExcluded, dwdSetup, receivePush } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { CONN, harness, NOW, seedDelegation } from "../fixtures/harness.ts";
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

test("a Gmail push also asks Calendar to sync that member's calendar, and an excluded member's is never synced", async () => {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01", excluded: true }] });
  for (const e of [MAYA, SAM]) h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, e, CONN, "1000", null, null, null, null, null);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history", { body: { history: [], historyId: "1001" } });
  await receivePush(h.ctx, { kind: "gmail", messageId: "p1", mailbox: MAYA, historyId: "1500" });
  assert.equal(h.calls("calendar.sync_now").length, 1);
  assert.equal(h.calls("calendar.connect_provider")[0]!.input.account, MAYA);
  await receivePush(h.ctx, { kind: "gmail", messageId: "p2", mailbox: SAM, historyId: "1500" });
  assert.equal(h.calls("calendar.sync_now").length, 1);
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
