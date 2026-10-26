// A signed-out caller is an actor principal that is no one (neither a person nor a service) (host/src/daemon/preauth.ts): a handler that needs a person (me()) refuses it.
// @reads /modules/identity/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import { preAuthSession } from "../../../host/src/daemon/preauth.ts";
import { me } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";

test("me() refuses the pre-auth principal, anonymous or pending, with auth.unauthenticated", () => {
  for (const caller of ["anonymous", "pending"] as const) {
    const principal = preAuthSession("spc_x", caller, { "x-vyre-remote": "203.0.113.9" }).principal;
    assert.equal(principal.kind, "actor");
    const ctx = { space: "spc_x", principal, trace: { traceId: "0".repeat(32) }, db: { all: () => [], run: () => ({ changes: 0 }) }, now: () => 0, emit: () => undefined } as unknown as IdentityCtx;
    assert.throws(() => me(ctx), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "auth.unauthenticated", caller);
  }
});
