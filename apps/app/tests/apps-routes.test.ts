import test from "node:test";
import assert from "node:assert/strict";
import { appsRoute } from "../src/places/apps/shell/routes.ts";
import { mutate } from "../src/places/apps/shell/mutations.ts";
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";

test("Apps routes retain subject ids and create requests after reload", () => {
  assert.deepEqual(appsRoute({ screen: "apps.form-settings", subject: { type: "form", id: "frm_example" }, args: {} }), { kind: "detail", group: "forms", id: "frm_example" });
  assert.deepEqual(appsRoute({ screen: "apps.campaign-builder", args: { create: "true" } }), { kind: "create", group: "campaigns" });
  assert.deepEqual(appsRoute({ screen: "apps.templates", args: {} }), { kind: "list", group: "templates" });
});
test("Apps creates pass contract-required keys and offline clicks never write", async () => {
  const calls: unknown[] = [];
  const d = { connection: { get: () => "online" }, call: async (cap: string, input: unknown) => { calls.push(input); const def = registry.capabilities.find((c) => c.name === cap)!; assert.deepEqual(validate(def.input, input, "", registry.$defs), []); return {}; } };
  await mutate(d as never, "forms.create", { name: "Fixture", recordType: "contact", kind: "public" }, "retry-key");
  assert.equal((calls[0] as { idempotencyKey: string }).idempotencyKey, "retry-key");
  await assert.rejects(mutate({ ...d, connection: { get: () => "offline" } } as never, "forms.create", {}, "key"), /Reconnect/);
  assert.equal(calls.length, 1);
});


test("all Apps create and outward contracts require the same key on retries", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["bookings.page_create", { name: "Consult", hostIds: ["usr_owner"], lengthMinutes: 30, recordType: "contact" }],
    ["campaigns.create", { name: "Fixture", kind: "one_time" }],
    ["campaigns.launch", { campaignId: "cmp_fixture" }],
    ["templates.save", { kind: "agent", ref: "agt_fixture", title: "Fixture" }],
    ["mail.domain.add", { name: "mail.example.com", provider: "resend" }],
    ["email_builder.create", { name: "Fixture", mode: "plain" }],
    ["email_builder.send_test", { emailId: "eml_fixture", to: "owner@example.com" }],
  ];
  for (const [cap, input] of cases) {
    const bodies: unknown[] = [];
    const d = { call: async (_cap: string, body: unknown) => { bodies.push(body); return {}; } };
    await mutate(d as never, cap, input, "retry-stable"); await mutate(d as never, cap, input, "retry-stable");
    assert.deepEqual(bodies[0], bodies[1]);
    const def = registry.capabilities.find((c) => c.name === cap)!;
    assert.deepEqual(validate(def.input, bodies[0], "", registry.$defs), [], cap);
  }
});
