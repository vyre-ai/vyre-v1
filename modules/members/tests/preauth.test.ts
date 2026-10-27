// The pending kind of signed-out caller (host/src/daemon/preauth.ts) still reaches the join: members.invites.preview answers it, because the code is the credential, not the principal.
// @reads ../migrations/0001_members.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/db.ts";
import { preAuthSession } from "../../../host/src/daemon/preauth.ts";

test("an invite preview exposes only public routing data to pending and anonymous callers", async () => {
  const h = harness();
  const made = await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "pre-1" });
  const code = /\/join\/([A-Z0-9-]+)#fp=/.exec(made.link)![1]!;
  for (const caller of ["pending", "anonymous"] as const) {
    const who = preAuthSession("spc_x", caller, { "x-vyre-remote": "203.0.113.9" }).principal;
    const view = await handlers["members.invites.preview"]({ ...h.anon, principal: who } as never, { code });
    assert.equal(view.spaceName, "Maya Studio", caller);
    assert.equal(view.spaceId, "spc_test", `${caller} receives only the public Space routing id`);
    assert.equal("code" in view, false, `${caller} never receives the one-time invite code back`);
  }
});
