// What a site's own action may ask the host to do as itself: the four Vault calls of its webhook secret and the owner's task, and nothing else (host/src/seams/sites-as-host.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { SITES_AS_HOST, sitesAsHost } from "../src/seams/sites-as-host.ts";

test("the host does for a site's own action only the Vault calls of its webhook secret and the owner's task: any other capability is refused and never runs", async () => {
  const ran: string[] = [];
  const asHost = sitesAsHost(async (cap) => (ran.push(cap), { status: "ok", output: { cap } }));
  assert.deepEqual([...SITES_AS_HOST].sort(), [
    "tasks.create",
    "vault.folders.create",
    "vault.item.put",
    "vault.item.update",
    "vault.share",
  ]);
  for (const cap of SITES_AS_HOST) assert.deepEqual(await asHost(cap, {}), { cap });
  for (const cap of [
    "access.roles.create",
    "vault.item.reveal",
    "vault.item.delete",
    "mail.send",
    "sites.deploy",
    "settings.set_space",
    "gate.release",
  ])
    await assert.rejects(() => asHost(cap, {}), /not something a site's own action may ask the host to do/, cap);
  assert.deepEqual(ran.sort(), [...SITES_AS_HOST].sort(), "nothing else ran");
  // an answer that is not ok is an error, not a value
  const held = sitesAsHost(async () => ({ status: "held" }));
  await assert.rejects(() => held("vault.share", {}), /held/);
});
