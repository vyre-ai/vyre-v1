// Members' Outlook calendars come into Calendar with their mail: consent setup connects each included member's default calendar (never an excluded or outside address), excluding a
// member removes it and including them again brings it back, and a notice asks Calendar to sync the calendar. A Calendar failure never fails the setup or the notice.
import test from "node:test";
import assert from "node:assert/strict";
import { consentExclude, consentSetup, receiveNotification } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { CONN, fixture, harness, NOW, seedConsent } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const SAM = "sam@vyre.test";
const G = "https://graph.microsoft.com/v1.0";
const members = [{ userId: "usr_maya01", email: MAYA }, { userId: "usr_sam01", email: SAM }, { userId: "usr_kim01", email: "kim@vyre.test" }, { userId: "usr_out01", email: "ext@other.test" }];
const setup = { vaultItem: "#Microsoft_App", tenantId: "tenant-guid", domain: "vyre.test", idempotencyKey: "s1" };

function admin(): Harness {
  const h = harness({ admin: true, members });
  ensure(h.ctx);
  h.on("GET", `${G}/organization`, { body: fixture("graph/organization.json") });
  return h;
}

test("consent setup connects each included member's default calendar, owned by them, and never an excluded or outside address", async () => {
  const h = admin();
  h.ctx.db.run(`INSERT INTO microsoft_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, "kim@vyre.test", "usr_kim01", 1, 1, null, NOW);
  await consentSetup(h.ctx, setup);
  assert.deepEqual(h.calls("calendar.connect_provider").map((c) => c.input), [
    { provider: "microsoft", ownerId: "usr_maya01", account: MAYA, connectionId: CONN, remoteId: "default" },
    { provider: "microsoft", ownerId: "usr_sam01", account: SAM, connectionId: CONN, remoteId: "default" },
  ]);
});

test("excluding a member removes their calendar; including them again connects a fresh one", async () => {
  const h = admin();
  await consentSetup(h.ctx, setup);
  const before = h.calls("calendar.connect_provider").length;
  await consentExclude(h.ctx, { email: MAYA, excluded: true });
  assert.deepEqual(h.calls("calendar.connect_provider").slice(before).map((c) => c.input), [{ provider: "microsoft", ownerId: "usr_maya01", account: MAYA, connectionId: CONN, remoteId: "default", connected: false }]);
  await consentExclude(h.ctx, { email: MAYA, excluded: false });
  assert.deepEqual(h.calls("calendar.connect_provider").slice(before + 1).map((c) => c.input), [{ provider: "microsoft", ownerId: "usr_maya01", account: MAYA, connectionId: CONN, remoteId: "default" }]);
  const n = h.calls("calendar.connect_provider").length;
  await consentExclude(h.ctx, { email: "stranger@vyre.test", excluded: true });
  assert.equal(h.calls("calendar.connect_provider").length, n);
});

function notified(excluded = false): Harness {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedConsent(h, { members: [{ email: MAYA, userId: "usr_maya01", ...(excluded ? { excluded: true } : {}) }] });
  h.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "sub1", "mail", `users/${MAYA}/messages`, MAYA, CONN, "https://x.test/hooks/microsoft", "cs", NOW + 3_600_000, 4230, "created");
  for (const f of ["inbox", "sentitems"]) h.on("GET", `${G}/users/${encodeURIComponent(MAYA)}/mailFolders/${f}/messages/delta`, { body: { value: [], "@odata.deltaLink": `${G}/delta?token=${f}` } });
  return h;
}

test("a notice also asks Calendar to sync that member's calendar, and an excluded member's is never synced", async () => {
  const h = notified();
  await receiveNotification(h.ctx, { notificationId: "n1", subscriptionId: "sub1", resource: `users/${MAYA}/messages/A`, changeType: "created", clientStateOk: true });
  assert.equal(h.calls("calendar.sync_now").length, 1);
  const x = notified(true);
  await receiveNotification(x.ctx, { notificationId: "n2", subscriptionId: "sub1", resource: `users/${MAYA}/messages/A`, changeType: "created", clientStateOk: true });
  assert.equal(x.calls("calendar.sync_now").length, 0);
});

test("a Calendar failure never fails the setup or the notice", async () => {
  const h = admin();
  const real = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => { if (cap.startsWith("calendar.")) throw new Error("calendar is down"); return real(cap, input); };
  assert.equal((await consentSetup(h.ctx, setup)).configured, true);
  const n = notified();
  const r2 = n.ctx.call.bind(n.ctx);
  n.ctx.call = async (cap, input) => { if (cap.startsWith("calendar.")) throw new Error("calendar is down"); return r2(cap, input); };
  assert.deepEqual(await receiveNotification(n.ctx, { notificationId: "n3", subscriptionId: "sub1", resource: `users/${MAYA}/messages/A`, changeType: "created", clientStateOk: true }), { accepted: true });
});
