// An Automation step that uses Microsoft runs as a tenant service of the person who owns it. That service acts as the owner's own mapped address, can name no one else, and is refused for an
// owner who has been excluded.
import test from "node:test";
import assert from "node:assert/strict";
import { mailFolders } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { codeOf, CONN, harness, seedConsent } from "../fixtures/harness.ts";

const SVC = { kind: "service" as const, id: `svc_${"ab12".repeat(8)}` };
const MAYA = "maya@vyre.test";
const FOLDERS = "https://graph.microsoft.com/v1.0/users/maya%40vyre.test/mailFolders";

test("an Automation service acts as the member it runs for, and as no one else", async () => {
  const h = harness({ principal: SVC, actingFor: "usr_maya01" });
  ensure(h.ctx);
  seedConsent(h, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: "sam@vyre.test", userId: "usr_sam01" }] });
  h.on("GET", FOLDERS, { body: { value: [] } });
  await mailFolders(h.ctx, { connectionId: CONN });
  assert.ok(h.requests.at(-1)!.url.startsWith(FOLDERS));
  await assert.rejects(() => mailFolders(h.ctx, { connectionId: CONN, as: "sam@vyre.test" }), (e) => codeOf(e) === "permission.no_grant");
});

test("an Automation that belongs to an excluded member reads nothing", async () => {
  const h = harness({ principal: SVC, actingFor: "usr_maya01" });
  ensure(h.ctx);
  seedConsent(h, { members: [{ email: MAYA, userId: "usr_maya01", excluded: true }] });
  await assert.rejects(() => mailFolders(h.ctx, { connectionId: CONN }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(h.requests.length, 0);
});
