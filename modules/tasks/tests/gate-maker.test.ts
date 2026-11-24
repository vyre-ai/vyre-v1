// Who may make a held act (the Gate's task): only a service the host itself runs (the allow-list HOST_OWN_SERVICES) or a call a gate capability made (callerCap gate.*). A tenant's service, a form's, an unknown
// one, a person and an agent are refused, and a refused create writes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, newTask } from "../fixtures/seed.ts";
import { mayMakeGateTask } from "../handlers/state.ts";

const as = (kind: "service" | "person" | "agent", id: string, callerCap?: string) =>
  ({ principal: { kind, id }, ...(callerCap ? { callerCap } : {}) }) as never;

test("mayMakeGateTask accepts the host's own services and a nested gate.* call, and refuses every other caller", () => {
  for (const id of ["svc_host", "svc_engine", "svc_sync"]) assert.equal(mayMakeGateTask(as("service", id)), true, id);
  assert.equal(mayMakeGateTask(as("person", alice.id, "gate.hold")), true, "a call the Gate's own capability made");
  assert.equal(mayMakeGateTask(as("agent", "agt_bot", "gate.release")), true);
  for (const id of ["svc_site_x", "svc_form_x", "svc_gate", "svc_unknown_9", `svc_${"a1".repeat(16)}`, "aut_9"])
    assert.equal(mayMakeGateTask(as("service", id)), false, `${id} is not the host`);
  assert.equal(mayMakeGateTask(as("person", alice.id)), false);
  assert.equal(mayMakeGateTask(as("agent", "agt_bot")), false);
  assert.equal(mayMakeGateTask(as("person", alice.id, "tasks.create")), false, "a capability that is not the Gate's");
});

test("a held act made by a tenant, a form or an unknown service is refused and nothing is written; the host's service makes it", async () => {
  const h = harness();
  for (const id of ["svc_site_x", "svc_form_x", "svc_unknown_9"]) {
    await assert.rejects(
      h.call("tasks.create", newTask({ kind: "approve", source: { kind: "gate", id: "dec_x" } }), {
        id,
        kind: "service",
      }),
      (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.field_locked",
      id,
    );
  }
  assert.equal(h.db.all("SELECT 1 FROM tasks_core").length, 0, "no task was written");
  const made = await h.call("tasks.create", newTask({ kind: "approve", source: { kind: "gate", id: "dec_y" } }), {
    id: "svc_host",
    kind: "service",
  });
  assert.ok(made.task.id);
});
