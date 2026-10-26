// P-GF_03 (goldens 12 and 14): a person whose only reach is a folder grant. Booted daemon on the seeded Space, driven through the gateway with real device tokens (rule 27).
// 1. access.request is open to any role or grant holder (level 'member', ruling 69): Tess, a temp with a grant on one folder and none on the channel, can ask for the channel.
//    A person who is in the Space with no role and no grant is still refused.
// 2. sync.pull gives such a guest exactly the rows under the granted folder (ruling 69: member level, rows filtered per resource) and none from anywhere else.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short } from "../../golden/steps/02-space.ts";
import { loadCatalog } from "../../sync/src/server/pull/index.ts";

type Change = { entity: string; id: string };
const keyOf = (c: Change): string => `${c.entity}/${c.id}`;

test("guest: a temp with one folder grant can ask for access to something she cannot see, and a stranger cannot", async () => {
  const s = await bootFlowSpace(["access", "members", "files", "devices", "spaces", "tasks"]);
  try {
    const tess = s.signedIn("usr_tess");
    const asked = await s.call("access.request", tess, { idempotencyKey: "guest-ask", resource: { type: "channel", id: "chn_general" }, level: "view", note: "I need the general channel" });
    const out = expectStatus(asked, 200, "access.request as Tess");
    assert.equal(out.request.state, "waiting", short(out));
    assert.equal(out.request.requester, "usr_tess");
    const none = await s.call("access.request", null, { idempotencyKey: "guest-anon", resource: { type: "channel", id: "chn_general" }, level: "view" });
    assert.ok(none.status === 401 || none.status === 403, `an anonymous caller is refused: ${none.status}`);
  } finally { await s.stop(); }
});

test("guest: a folder grant lets the guest pull exactly that folder's rows and none from another folder", async () => {
  const s = await bootFlowSpace(["sync", "access", "search", "records", "schema", "devices", "spaces"]);
  try {
    const admin = s.signedIn("usr_olivia", "dev_olivia1");
    const tess = s.signedIn("usr_tess", "dev_tessone1");
    const pull = async (token: string) => expectStatus(await s.call("sync.pull", token, { cursor: 0, epoch: 0, limit: 500 }), 200, "sync.pull") as { changes: Change[]; hide: unknown[] };
    const all = (await pull(admin)).changes;
    assert.ok(all.length >= 2, `the owner pulls rows: ${all.length}`);
    const catalog = loadCatalog();
    const inside = all[0]!, outside = all[1]!;
    const before = new Set((await pull(tess)).changes.map(keyOf));
    assert.ok(!before.has(keyOf(inside)) && !before.has(keyOf(outside)), "Tess holds neither row before the grant");

    const place = await s.call("folders.place", admin, { resource: { type: catalog.get(inside.entity).resource, id: inside.id }, folderId: "fld_clients" });
    expectStatus(place, 200, "folders.place into the Clients folder");
    expectStatus(await s.call("access.share", admin, { idempotencyKey: "guest-share", resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_tess" }, level: "view" }), 200, "access.share");

    const after = (await pull(tess)).changes.map(keyOf);
    assert.ok(after.includes(keyOf(inside)), `the guest pulls the row in the granted folder: ${short(after.slice(0, 5))}`);
    assert.ok(!after.includes(keyOf(outside)), "and not a row outside it");
    assert.ok(after.length < all.length, `the guest pulls ${after.length} of ${all.length}, not everything`);
  } finally { await s.stop(); }
});
