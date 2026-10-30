// The directory: list the Workspace people for an admin (as the admin, with the directory scope), invite the chosen ones, and match the people who joined since.
import test from "node:test";
import assert from "node:assert/strict";
import { directoryImport, directoryList, dwdSetup, syncMembers } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const D = "https://admin.googleapis.com/admin/directory/v1/users";
const members = [{ userId: "usr_maya01", email: "maya@vyre.test" }];

function ready(): Harness {
  const h = harness({ admin: true, members });
  ensure(h.ctx);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", { body: { emailAddress: "admin@vyre.test", historyId: "1" } });
  return h;
}

test("the directory lists the domain's people as the admin with the directory scope, and shows who is already matched", async () => {
  const h = ready();
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  h.on("GET", D, { body: { users: [
    { primaryEmail: "Maya@Vyre.test", name: { fullName: "Maya Rivera" }, suspended: false }, { primaryEmail: "new@vyre.test", name: { fullName: "New Person" } },
    { primaryEmail: "gone@vyre.test", suspended: true }, { primaryEmail: "not-an-email" },
  ], nextPageToken: "p2" } });
  const out = await directoryList(h.ctx, {});
  assert.deepEqual(out, { people: [
    { email: "maya@vyre.test", suspended: false, name: "Maya Rivera", userId: "usr_maya01" }, { email: "new@vyre.test", suspended: false, name: "New Person" }, { email: "gone@vyre.test", suspended: true },
  ], nextPageToken: "p2" });
  const req = h.hits(D)[0]!;
  assert.match(req.url, /domain=vyre\.test/);
  assert.ok(h.minted.some((m) => m.sub === "admin@vyre.test" && m.scopes[0] === "https://www.googleapis.com/auth/admin.directory.user.readonly"));
});

test("the directory needs delegation to be set up", async () => {
  const h = ready();
  await assert.rejects(() => directoryList(h.ctx, {}), (e) => codeOf(e) === "validation.precondition_failed");
});

test("importing invites each chosen person once with their role and returns the links; the rest are skipped with a reason", async () => {
  const h = ready();
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  const out = await directoryImport(h.ctx, { idempotencyKey: "imp1", people: [
    { email: "New@Vyre.test", role: "rol_member" }, { email: "new@vyre.test", role: "rol_member" }, { email: "maya@vyre.test", role: "rol_member" },
    { email: "x@elsewhere.test", role: "rol_member" }, { email: "bad@vyre.test", role: "rol_member" },
  ] });
  assert.deepEqual(out.invited, [{ email: "new@vyre.test", inviteId: "inv_newvyretest", link: "https://space.test/join/new" }]);
  assert.deepEqual(out.skipped.map((s) => [s.email, s.reason]), [["maya@vyre.test", "Already in the Space."], ["x@elsewhere.test", "Only addresses at vyre.test can be invited."], ["bad@vyre.test", "That invitation could not be made."]]);
  assert.deepEqual(h.calls("members.invites.create")[0]!.input, { role: "rol_member", email: "new@vyre.test", idempotencyKey: "imp1:new@vyre.test" });
  await assert.rejects(() => directoryImport(h.ctx, { idempotencyKey: "imp2", people: [] }), (e) => codeOf(e) === "validation.bad_input");
});

test("sync matches the people who joined since setup by their invitation email, once, and connects their mail", async () => {
  const h = harness({ admin: true, members });
  ensure(h.ctx);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", { body: { emailAddress: "admin@vyre.test", historyId: "1" } });
  await dwdSetup(h.ctx, { vaultItem: "#Google_DWD", adminEmail: "admin@vyre.test", idempotencyKey: "s1" });
  assert.deepEqual(await syncMembers(h.ctx, {}), { matched: 0, connected: 0 });
  members.push({ userId: "usr_late001", email: "late@vyre.test" }, { userId: "usr_out0001", email: "x@elsewhere.test" });
  const out = await syncMembers(h.ctx, {});
  members.length = 1;
  assert.deepEqual(out, { matched: 1, connected: 1 });
  assert.deepEqual(h.rows(`SELECT mapped, "userId" FROM google_member WHERE email = ?`, "late@vyre.test"), [{ mapped: 1, userId: "usr_late001" }]);
  assert.deepEqual(await syncMembers(h.ctx, {}), { matched: 0, connected: 0 });
});
