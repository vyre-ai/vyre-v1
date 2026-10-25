// Golden flow 14: a revoked grant purges a replica (spec 4.11; ARCH 5.7). A person's device pulls a record they may see; the grant is revoked; the next pull hides the row and the scope
// changes; revoking the device bumps the epoch and its next pull answers purge. Through the gateway with real device tokens.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_PURGE = ["sync", "access", "search", "records", "schema", "devices", "spaces"];
export const GAPS: Gap[] = [];

export async function runPurge(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.d.token;
    const tess = s.signedIn("usr_tess", "dev_tessone1");
    const pull = async (cursor: number) => expectStatus(await s.call("sync.pull", tess, { cursor, epoch: 0 }), 200, "sync.pull");
    const grant = await trail.step("Tess is shared a folder", async () =>
      expectStatus(await s.call("access.share", admin, { idempotencyKey: "golden-14-share", resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "usr_tess" }, level: "view" }), 200, "access.share").grant.id as string);
    const before = await trail.step("her device pulls and holds rows from it", async () => {
      const out = await pull(0);
      assert.ok(out.changes.length >= 1, `Tess pulled nothing: ${short(out)}`);
      return out.next as number;
    }, ["Tess is shared a folder"]);
    await trail.step("the grant is revoked and her next pull hides the rows", async () => {
      expectStatus(await s.call("access.unshare", admin, { grantId: grant! }), 200, "access.unshare");
      const out = await pull(before!);
      assert.ok(out.hide.length >= 1, `no hide rows: ${short(out)}`);
    }, ["her device pulls and holds rows from it"]);
    await trail.step("the revoked device's next pull answers purge", async () => {
      expectStatus(await s.call("devices.revoke", admin, { deviceId: "dev_tessone1" }), 200, "devices.revoke");
      const r = await s.call("sync.pull", tess, { cursor: 0, epoch: 0 });
      assert.ok(r.status === 401 || r.body?.data?.reset === "purge", `after revoke: ${r.status} ${short(r.body)}`);
    }, ["the grant is revoked and her next pull hides the rows"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runPurge([]);
  if (trail.failures.length) throw new Error(`flow 14 failed:\n${trail.report()}`);
  return events;
}
