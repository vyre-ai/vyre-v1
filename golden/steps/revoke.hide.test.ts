// P-GF_09 (golden 14): revoking a share hides the rows on the guest's device. Booted daemon, real device tokens through the gateway (rule 27): the owner puts one row in a new folder and shares it,
// Tess pulls it, the owner unshares, and Tess's next pull hides it (the same answer again if the response was lost); a row in another folder was never hers.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short } from "./02-space.ts";
import { loadCatalog } from "../../sync/src/server/pull/index.ts";

type Change = { entity: string; id: string };
const keyOf = (c: Change): string => `${c.entity}/${c.id}`;

test("a share given after the device synced delivers the row, and unshare hides it on the next pull, again on a retry", async () => {
  const s = await bootFlowSpace(["sync", "access", "search", "records", "schema", "devices", "spaces"]);
  try {
    const admin = s.signedIn("usr_olivia", "dev_olivia1");
    const tess = s.signedIn("usr_tess", "dev_tessone1");
    // one pull, followed until the server says there is no more
    const pull = async (token: string, cursor: number) => {
      const acc = { changes: [] as Change[], hide: [] as Change[], next: cursor };
      for (let i = 0; i < 50; i++) {
        const r = expectStatus(await s.call("sync.pull", token, { cursor: acc.next, epoch: 0, limit: 500 }), 200, "sync.pull") as { changes: Change[]; hide: Change[]; next: number; more: boolean };
        acc.changes.push(...r.changes); acc.hide.push(...r.hide); acc.next = r.next;
        if (!r.more) return acc;
      }
      throw new Error("sync.pull never finished");
    };
    const all = (await pull(admin, 0)).changes;
    // rows Tess cannot see on her own: the seed already gives her some
    const hers = new Set((await pull(tess, 0)).changes.map(keyOf));
    const hidden = all.filter((c) => !hers.has(keyOf(c)));
    assert.ok(hidden.length >= 2, `the owner pulls rows Tess does not see: ${hidden.length} of ${all.length}`);
    const [inside, outside] = [hidden[0]!, hidden[1]!];
    const rt = loadCatalog().get(inside.entity).resource;
    const folder = expectStatus(await s.call("folders.create", admin, { idempotencyKey: "hide-folder", type: rt, name: "Shared out", scope: "personal" }), 200, "folders.create").folder.id as string;
    expectStatus(await s.call("folders.place", admin, { resource: { type: rt, id: inside.id }, folderId: folder }), 200, "folders.place");
    // Tess has already synced past every row when the share is given
    const before = await pull(tess, 0);
    assert.ok(!before.changes.map(keyOf).includes(keyOf(inside)), "not hers yet");
    const grant = expectStatus(await s.call("access.share", admin, { idempotencyKey: "hide-share", resource: { type: "folder", id: folder }, subject: { kind: "person", id: "usr_tess" }, level: "view" }), 200, "access.share").grant.id as string;

    const held = await pull(tess, before.next);
    assert.ok(held.changes.map(keyOf).includes(keyOf(inside)), `the next pull delivers the shared row: ${short(held.changes.slice(0, 5))}`);
    assert.ok(!held.changes.map(keyOf).includes(keyOf(outside)), "and not the other one");

    expectStatus(await s.call("access.unshare", admin, { grantId: grant }), 200, "access.unshare");
    const gone = await pull(tess, held.next);
    assert.ok(gone.hide.map(keyOf).includes(keyOf(inside)), `the next pull hides it: ${short(gone)}`);
    const retry = await pull(tess, held.next);
    assert.ok(retry.hide.map(keyOf).includes(keyOf(inside)), "a pull whose response was lost is answered the same way");
    assert.ok(!gone.hide.map(keyOf).includes(keyOf(outside)), "a row she never held is not mentioned");
  } finally { await s.stop(); }
});
