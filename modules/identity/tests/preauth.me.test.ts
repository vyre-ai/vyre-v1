// A signed-out caller is a service principal that is no one (host/src/daemon/preauth.ts): a handler that needs a person (me()) refuses it.
// @reads /modules/identity/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import { preAuthSession } from "../../../host/src/daemon/preauth.ts";
import { me } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";

test("me() refuses the pre-auth principal with auth.unauthenticated", () => {
  const principal = preAuthSession("spc_x", "anonymous", { "x-vyre-remote": "203.0.113.9" }).principal;
  const ctx = { space: "spc_x", principal, trace: { traceId: "0".repeat(32) }, db: { all: () => [], run: () => ({ changes: 0 }) }, now: () => 0, emit: () => undefined } as unknown as IdentityCtx;
  assert.throws(() => me(ctx), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "auth.unauthenticated");
});
