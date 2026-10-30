// An Automation step that uses Google (the fifteen steps google.* and ms.* in the step catalogue) runs as a tenant service of the person who owns it. That service acts as the owner's
// own mapped address, can name no one else, and is refused for an owner who has been excluded.
import test from "node:test";
import assert from "node:assert/strict";
import { calendarList, getProfile } from "../handlers/index.ts";
import { registry } from "../../../generated/registry.ts";
import { codeOf, harness, seedDelegation } from "../fixtures/harness.ts";

const SVC = { kind: "service" as const, id: `svc_${"ab12".repeat(8)}` };
const MAYA = "maya@vyre.test";
const PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

test("an Automation service acts as the member it runs for, and as no one else", async () => {
  const h = harness({ principal: SVC, actingFor: "usr_maya01" });
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: "sam@vyre.test", userId: "usr_sam01" }] });
  h.on("GET", PROFILE, { body: { emailAddress: MAYA, historyId: "1" } });
  await getProfile(h.ctx, { connectionId: "con_google1" });
  assert.equal(h.minted.at(-1)?.sub, MAYA);
  await assert.rejects(() => getProfile(h.ctx, { connectionId: "con_google1", as: "sam@vyre.test" }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => calendarList(h.ctx, { connectionId: "con_google1", as: "sam@vyre.test" }), (e) => codeOf(e) === "permission.no_grant");
});

test("an Automation that belongs to an excluded member reads nothing, and one that belongs to no mapped member has no one to act as", async () => {
  const excluded = harness({ principal: SVC, actingFor: "usr_maya01" });
  seedDelegation(excluded, { members: [{ email: MAYA, userId: "usr_maya01", excluded: true }] });
  await assert.rejects(() => getProfile(excluded.ctx, { connectionId: "con_google1" }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(excluded.requests.length, 0);
  const stranger = harness({ principal: SVC, actingFor: "usr_nobody" });
  seedDelegation(stranger);
  await assert.rejects(() => getProfile(stranger.ctx, { connectionId: "con_google1" }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("the fifteen Google and Microsoft steps are in the catalogue, each over a capability that takes the connection", () => {
  const steps = (registry as unknown as { steps: { key: string; cap?: string }[] }).steps.filter((s) => s.key.startsWith("google.") || s.key.startsWith("ms."));
  assert.equal(steps.length, 15);
  for (const s of steps) {
    const cap = registry.capabilities.filter((c) => c.name === s.cap).sort((a, b) => b.v - a.v)[0];
    assert.ok(cap, `${s.key} has its capability`);
    const raw = cap.input as { $ref?: string; properties?: Record<string, unknown> };
    const defs = registry.$defs as Record<string, { properties?: Record<string, unknown> }>;
    const input = raw.$ref ? defs[raw.$ref.split("/").pop()!]! : raw;
    assert.ok(input.properties && "connectionId" in input.properties, `${s.key} takes a connection`);
  }
});
