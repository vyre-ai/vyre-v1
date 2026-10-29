// The connectors that ship with the server are connectable. Before: connections.create answered "not found" for Google, Microsoft, HubSpot and every other built-in connector, to
// the owner too, because only a connector someone wrote became a resource in the access projection. Now each built-in connector is registered at boot (once; a restart repeats the same
// event), the owner and anyone holding connectors.manage can connect it, and a member without it is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWorld, MEMBER, OWNER } from "./support/suite-world.ts";

const none = { api: () => undefined, seam: () => undefined, members: [], secrets: {} };

test("the owner connects a built-in connector, a member without connectors.manage cannot, and a restart changes nothing", async () => {
  const w = await bootWorld({ prefix: "builtin", ...none });
  let dir = "";
  try {
    const list = await w.ok(OWNER, "connectors.list", {});
    const keys: string[] = list.connectors.map((c: { key: string }) => c.key);
    assert.ok(["google", "microsoft", "hubspot", "stripe"].every((k) => keys.includes(k)));
    for (const connector of ["google", "microsoft", "hubspot"]) {
      const r = await w.call(OWNER, "connections.create", { connector, title: `${connector} account`, ownerKind: "space", idempotencyKey: w.idem() });
      assert.equal(r.status, 200, `${connector}: ${r.text}`);
      assert.equal(r.data.connection.connector, connector);
    }
    const refused = await w.call(MEMBER, "connections.create", { connector: "google", title: "mine", ownerKind: "space", idempotencyKey: w.idem() });
    assert.equal(refused.status, 403, refused.text);
    dir = w.dir;
  } finally { await w.stop(true); }
  const again = await bootWorld({ prefix: "builtin-again", ...none, dir });
  try {
    const r = await again.call(OWNER, "connections.create", { connector: "stripe", title: "after a restart", ownerKind: "space", idempotencyKey: again.idem() });
    assert.equal(r.status, 200, r.text);
  } finally { await again.stop(); }
});
