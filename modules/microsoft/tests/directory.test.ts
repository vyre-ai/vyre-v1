// The directory: list the tenant's people for an admin, invite the chosen ones, and match the people who joined since.
import test from "node:test";
import assert from "node:assert/strict";
import { consentSetup, directoryImport, directoryList, syncMembers } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { codeOf, fixture, harness } from "../fixtures/harness.ts";

const G = "https://graph.microsoft.com/v1.0";
const members = [{ userId: "usr_maya01", email: "maya@vyre.test" }];
const setup = { vaultItem: "#Microsoft_App", tenantId: "tenant-guid", domain: "vyre.test", idempotencyKey: "s1" };

function ready() {
  const h = harness({ admin: true, members });
  ensure(h.ctx);
  h.on("GET", `${G}/organization`, { body: fixture("graph/organization.json") });
  return h;
}

test("the directory lists the tenant's people at the domain, leaves out guests, and shows who is already matched", async () => {
  const h = ready();
  await consentSetup(h.ctx, setup);
  h.on("GET", `${G}/users`, { body: { value: [
    { displayName: "Maya Rivera", mail: "Maya@Vyre.test", accountEnabled: true }, { displayName: "New Person", userPrincipalName: "new@vyre.test", accountEnabled: false },
    { displayName: "A Guest", mail: "guest@vyre.test", userType: "Guest" }, { displayName: "Outside", mail: "o@elsewhere.test" },
  ], "@odata.nextLink": `${G}/users?$skiptoken=abc` } });
  assert.deepEqual(await directoryList(h.ctx, {}), { people: [
    { email: "maya@vyre.test", suspended: false, name: "Maya Rivera", userId: "usr_maya01" }, { email: "new@vyre.test", suspended: true, name: "New Person" },
  ], nextSkipToken: "abc" });
});

test("the directory needs the connection to be set up", async () => {
  await assert.rejects(() => directoryList(ready().ctx, {}), (e) => codeOf(e) === "validation.precondition_failed");
});

test("importing invites each chosen person once and returns the links; the rest are skipped with a reason", async () => {
  const h = ready();
  await consentSetup(h.ctx, setup);
  const out = await directoryImport(h.ctx, { idempotencyKey: "imp1", people: [{ email: "new@vyre.test", role: "rol_member" }, { email: "maya@vyre.test", role: "rol_member" }, { email: "x@elsewhere.test", role: "rol_member" }, { email: "bad@vyre.test", role: "rol_member" }] });
  assert.deepEqual(out.invited, [{ email: "new@vyre.test", inviteId: "inv_newvyretest", link: "https://space.test/join/new" }]);
  assert.deepEqual(out.skipped.map((s) => s.email), ["maya@vyre.test", "x@elsewhere.test", "bad@vyre.test"]);
});

test("sync matches the people who joined since consent, once, and connects their mail", async () => {
  const h = ready();
  await consentSetup(h.ctx, setup);
  assert.deepEqual(await syncMembers(h.ctx, {}), { matched: 0, connected: 0 });
  members.push({ userId: "usr_late001", email: "late@vyre.test" });
  const out = await syncMembers(h.ctx, {});
  members.length = 1;
  assert.deepEqual(out, { matched: 1, connected: 1 });
  assert.deepEqual(await syncMembers(h.ctx, {}), { matched: 0, connected: 0 });
});
