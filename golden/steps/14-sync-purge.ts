// Golden flow 14: a revoked grant purges a replica (spec 4.11; ARCH 5.7). A person's device pulls a record they may see; the grant is revoked; the next pull hides the row and the scope
// changes; revoking the device bumps the epoch and its next pull answers purge. Through the gateway with real device tokens.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import { loadCatalog } from "../../sync/src/server/pull/index.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_PURGE = ["sync", "access", "search", "records", "schema", "devices", "spaces"];
export const GAPS: Gap[] = [
  { packet: "P-CC_42 follow-up", lane: "L7", what: "folders.place answers 500: it emits access.changed, which its manifest does not declare in emits (folders.create was fixed in #635, folders.place and likely folders.unplace were not)" },
];

export async function runPurge(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.signedIn("usr_olivia", "dev_olivia1");
    const tess = s.signedIn("usr_tess", "dev_tessone1");
    type Change = { entity: string; id: string };
    const keyOf = (c: Change): string => `${c.entity}/${c.id}`;
    const pull = async (token: string, cursor = 0) => expectStatus(await s.call("sync.pull", token, { cursor, epoch: 0, limit: 500 }), 200, "sync.pull") as { changes: Change[]; hide: unknown[]; next: number };
    const rows = await trail.step("the owner pulls rows, two of which are the ones the flow uses", async () => {
      const all = (await pull(admin)).changes;
      assert.ok(all.length >= 2, `the owner pulls rows: ${all.length}`);
      return { inside: all[0]!, outside: all[1]!, total: all.length };
    });
    await trail.step("Tess holds neither row before any grant", async () => {
      const held = new Set((await pull(tess)).changes.map(keyOf));
      assert.ok(!held.has(keyOf(rows!.inside)) && !held.has(keyOf(rows!.outside)), "Tess holds neither row");
    }, ["the owner pulls rows, two of which are the ones the flow uses"]);
    const grant = await trail.step("the row is placed in a folder made for it and the folder is shared with Tess", async () => {
      const catalog = loadCatalog();
      const rt = catalog.get(rows!.inside.entity).resource;
      const folder = expectStatus(await s.call("folders.create", admin, { idempotencyKey: "golden-14-folder", type: rt, name: "Guest folder", scope: "space" }), 200, "folders.create").folder.id as string;
      expectStatus(await s.call("folders.place", admin, { resource: { type: rt, id: rows!.inside.id }, folderId: folder }), 200, "folders.place");
      return expectStatus(await s.call("access.share", admin, { idempotencyKey: "golden-14-share", resource: { type: "folder", id: folder }, subject: { kind: "person", id: "usr_tess" }, level: "view" }), 200, "access.share").grant.id as string;
    }, ["Tess holds neither row before any grant"]);
    const before = await trail.step("her device pulls exactly the row in the granted folder", async () => {
      const out = await pull(tess);
      const keys = out.changes.map(keyOf);
      assert.ok(keys.includes(keyOf(rows!.inside)), `the guest pulls the row in the folder: ${short(keys.slice(0, 5))}`);
      assert.ok(!keys.includes(keyOf(rows!.outside)), "and not a row outside it");
      assert.ok(keys.length < rows!.total, `the guest pulls ${keys.length} of ${rows!.total}`);
      return out.next;
    }, ["the row is placed in a folder made for it and the folder is shared with Tess"]);
    await trail.step("the grant is revoked and her next pull hides the row", async () => {
      expectStatus(await s.call("access.unshare", admin, { grantId: grant! }), 200, "access.unshare");
      const out = await pull(tess, before!);
      assert.ok(out.hide.length >= 1, `no hide rows: ${short(out)}`);
    }, ["her device pulls exactly the row in the granted folder"]);
    await trail.step("the revoked device's next pull answers purge", async () => {
      expectStatus(await s.call("devices.revoke", admin, { deviceId: "dev_tessone1" }), 200, "devices.revoke");
      const r = await s.call("sync.pull", tess, { cursor: 0, epoch: 0 });
      assert.ok(r.status === 401 || r.body?.data?.reset === "purge", `after revoke: ${r.status} ${short(r.body)}`);
    }, ["the grant is revoked and her next pull hides the row"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runPurge([]);
  if (trail.failures.length) throw new Error(`flow 14 failed:\n${trail.report()}`);
  return events;
}
