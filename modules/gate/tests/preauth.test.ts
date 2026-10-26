// A signed-out caller is an `actor` named by source address (host/src/daemon/preauth.ts), never a service: where the Gate trusts a service outright (mayHandle), this principal is refused.
// @reads /modules/gate/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import { preAuthSession } from "../../../host/src/daemon/preauth.ts";
import { mayHandle } from "../projections.ts";
import type { GateCtx, Hold } from "../projections.ts";

const hold = { principal: { kind: "person", id: "usr_a" }, approver: { kind: "person", id: "usr_b" }, taskId: "tsk_1" } as unknown as Hold;
const ctxOf = (principal: { kind: string; id: string }): GateCtx => ({ principal } as unknown as GateCtx);

test("a held call is handled by a service, and not by a signed-out caller of either kind", () => {
  assert.equal(mayHandle(ctxOf({ kind: "service", id: "svc_host" }), hold), true, "the control: a service is trusted");
  for (const caller of ["anonymous", "pending"] as const) {
    const who = preAuthSession("spc_x", caller, { "x-vyre-remote": "203.0.113.9" }).principal;
    assert.equal(who.kind, "actor");
    assert.equal(mayHandle(ctxOf(who), hold), false, caller);
  }
});
