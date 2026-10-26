// A signed-out caller is an `actor`, never a service (host/src/daemon/preauth.ts): where Tasks lets a service act for every slot (holds), this principal stands behind none.
// @reads /modules/tasks/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import { preAuthSession } from "../../../host/src/daemon/preauth.ts";
import { holds } from "../projections.ts";
import type { Task } from "../projections.ts";

const task = { responsible: { kind: "person", id: "usr_a" }, reviewer: { kind: "person", id: "usr_b" }, approver: { kind: "person", id: "usr_c" } } as unknown as Task;

test("a service stands behind every slot of a task, and a signed-out caller of either kind behind none", () => {
  for (const slot of ["responsible", "reviewer", "approver"] as const) {
    assert.equal(holds(task, slot, { kind: "service", id: "svc_host" } as never), true, `the control: a service holds ${slot}`);
    for (const caller of ["anonymous", "pending"] as const) {
      const who = preAuthSession("spc_x", caller, { "x-vyre-remote": "203.0.113.9" }).principal;
      assert.equal(holds(task, slot, who as never), false, `${caller} ${slot}`);
    }
  }
});
