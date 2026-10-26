// P-GF_03 (goldens 12 and 14): a person whose only reach is a folder grant. Booted daemon on the seeded Space, driven through the gateway with real device tokens (rule 27).
// 1. access.request is bound to level 'member' (ruling 69): a guest reaches the handler and gets its designed refusal (guests cannot ask), a member can ask for a channel she cannot see.
// 2. sync.pull gives such a guest exactly the rows under the granted folder (ruling 69: member level, rows filtered per resource) and none from anywhere else.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short } from "./02-space.ts";
import { loadCatalog } from "../../sync/src/server/pull/index.ts";

type Change = { entity: string; id: string };
const keyOf = (c: Change): string => `${c.entity}/${c.id}`;

test("guest: Tess (a guest) gets the designed refusal, not a generic 403, and a member asks for something she cannot see", async () => {
  const s = await bootFlowSpace(["access", "members", "files", "devices", "spaces", "tasks"]);
  try {
    const ask = (token: string, key: string) => s.call("access.request", token, { idempotencyKey: key, resource: { type: "channel", id: "chn_general" }, level: "view", note: "I need the general channel" });
    const tess = await ask(s.signedIn("usr_tess"), "guest-ask");
    assert.equal(tess.status, 403, short(tess.body));
    assert.equal(tess.body?.error?.code, "permission.guest_cannot_request", "level member lets her reach the handler, which says guests cannot ask");
    const noah = expectStatus(await ask(s.signedIn("usr_noah"), "member-ask"), 200, "access.request as a member");
    assert.equal(noah.request.state, "waiting", short(noah));
    assert.equal(noah.request.requester, "usr_noah");
    const anon = await s.call("access.request", null, { idempotencyKey: "guest-anon", resource: { type: "channel", id: "chn_general" }, level: "view" });
    assert.ok(anon.status === 401 || anon.status === 403, `an anonymous caller is refused: ${anon.status}`);
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

    const rt = catalog.get(inside.entity).resource;
    const folder = expectStatus(await s.call("folders.create", admin, { idempotencyKey: "guest-folder", type: rt, name: "Guest folder", scope: "space" }), 200, "folders.create").folder.id as string;
    expectStatus(await s.call("folders.place", admin, { resource: { type: rt, id: inside.id }, folderId: folder }), 200, "folders.place into the new folder");
    expectStatus(await s.call("access.share", admin, { idempotencyKey: "guest-share", resource: { type: "folder", id: folder }, subject: { kind: "person", id: "usr_tess" }, level: "view" }), 200, "access.share");

    const after = (await pull(tess)).changes.map(keyOf);
    assert.ok(after.includes(keyOf(inside)), `the guest pulls the row in the granted folder: ${short(after.slice(0, 5))}`);
    assert.ok(!after.includes(keyOf(outside)), "and not a row outside it");
    assert.ok(after.length < all.length, `the guest pulls ${after.length} of ${all.length}, not everything`);
  } finally { await s.stop(); }
});
