// devices.register is host-only (P-SEC_08): a member, an admin, an agent and another service are refused with permission.no_grant and nothing is written; svc_host can register.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";

const input = { person: "usr_victim", name: "Attacker's laptop", class: "desktop" as const };
const count = (h: ReturnType<typeof harness>, table: string): number => h.rows(`SELECT * FROM ${table}`).length;

test("a member, an admin and an agent cannot register a device or get a session for anyone", async () => {
  const h = harness();
  for (const ctx of [h.as("usr_maya"), h.as("usr_admin", { admin: true }), { ...h.as("usr_maya"), principal: { kind: "agent" as const, id: "agt_helper" } }]) {
    await assert.rejects(handlers["devices.register"](ctx, input), (e) => codeOf(e) === "permission.no_grant");
  }
  assert.equal(count(h, "devices_device"), 0, "no device row");
  assert.equal(count(h, "devices_session"), 0, "no session row");
  assert.equal(h.events.length, 0, "no event");
});

test("another service, including the sync service and a service named like the host, is refused", async () => {
  const h = harness();
  await assert.rejects(handlers["devices.register"](h.system(), input), (e) => codeOf(e) === "permission.no_grant");
  const lookalike = { ...h.host(), principal: { kind: "service" as const, id: "svc_host2" } };
  await assert.rejects(handlers["devices.register"](lookalike, input), (e) => codeOf(e) === "permission.no_grant");
  const personNamedHost = { ...h.host(), principal: { kind: "person" as const, id: "svc_host" } };
  await assert.rejects(handlers["devices.register"](personNamedHost, input), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(count(h, "devices_device"), 0);
});

test("the host itself (svc_host) registers a device and its session", async () => {
  const h = harness();
  const out = await handlers["devices.register"](h.host(), input);
  assert.equal(out.device.person, "usr_victim");
  assert.match(out.sessionId, /^ses_/);
  assert.equal(count(h, "devices_device"), 1);
  assert.equal(count(h, "devices_session"), 1);
});
