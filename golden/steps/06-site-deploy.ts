// Golden flow 6: a site is previewed, promoted and rolled back (spec 2.20; ARCH 4.14). A preview appears on its own staging address, promoting it is held by the Gate and approved, and a rollback
// brings the previous deployment back. Through the gateway.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_SITE = ["sites", "gate", "tasks", "files", "vault", "devices", "access", "spaces"];
export const GAPS: Gap[] = [
<<<<<<< HEAD
  { packet: "PR 476 (P-L8_LIVE)", lane: "L8", what: "DEFERRED SCOPE: sites is deferred and not live in 476; sites.create answers 404 not_found because no Deployments root resource exists for the site to be made under" },
=======
  { packet: "PR 476 (P-L8_LIVE)", lane: "L8", what: "sites is not live in 476 (except sites and portal); sites.create answers 404 not_found because no Deployments root resource exists for the site to be made under" },
>>>>>>> origin/main
];

export async function runSite(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.d.token;
    const site = await trail.step("a site is made", async () =>
      expectStatus(await s.call("sites.create", admin, { idempotencyKey: "golden-6-site", name: "Studio", kind: "site" }), 200, "sites.create").site.id as string);
    const preview = await trail.step("a preview is built on its own address", async () => {
      const out = expectStatus(await s.call("sites.preview_rebuild", admin, { idempotencyKey: "golden-6-prev", siteId: site!, branch: "feature" }), 200, "sites.preview_rebuild").deployment;
      assert.ok(out.url ?? out.id, `preview ${short(out)}`);
      return (out.id ?? out.deploymentId) as string;
    }, ["a site is made"]);
    const held = await trail.step("promoting it is held by the Gate", async () => {
      const r = await s.call("sites.promote", admin, { idempotencyKey: "golden-6-promote", siteId: site!, deploymentId: preview! });
      assert.ok(r.status === 202 && r.body?.data?.status === "held", `sites.promote should be held: ${r.status} ${short(r.body)}`);
      return r.body.data.taskId as string;
    }, ["a preview is built on its own address"]);
    await trail.step("a person approves and the site is promoted", async () => {
      expectStatus(await s.call("tasks.act", admin, { taskId: held!, action: "approve" }), 200, "tasks.act");
      const got = expectStatus(await s.call("sites.get", admin, { siteId: site! }), 200, "sites.get").site;
      assert.ok(JSON.stringify(got).includes(preview!), `the site serves the promoted deployment: ${short(got)}`);
    }, ["promoting it is held by the Gate"]);
    await trail.step("it is rolled back", async () => {
      expectStatus(await s.call("sites.rollback", admin, { idempotencyKey: "golden-6-back", siteId: site! }), 200, "sites.rollback");
    }, ["a person approves and the site is promoted"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runSite([]);
  if (trail.failures.length) throw new Error(`flow 6 failed:\n${trail.report()}`);
  return events;
}
