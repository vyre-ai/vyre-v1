// Golden flow 12: the permission matrix (spec 2.3, 4.12, 4.13). Every built-in role against the permission catalogue; View as; a folder share, an item placed into then taken out of the shared
// folder, a revoke, and an Ask for access that is approved and then retried. Through the gateway, real tokens, on the frozen `core` seed (Tess holds nothing except her view of one folder).
import assert from "node:assert/strict";
import { PERMISSIONS } from "../../manifests/permissions.ts";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_MATRIX = ["access", "members", "files", "devices", "spaces", "tasks"];

const TESS = { kind: "person", id: "usr_tess" } as const;
const CHANNEL = { type: "channel", id: "chn_general" } as const;

/** Why this flow is a todo today (ruling 53). */
export const GAPS: Gap[] = [
  { packet: "CONTRACT-CHANGE", lane: "L7", what: "access.request needs level view on the resource being asked for, so a person who cannot see it gets 403 instead of asking" },
];

export async function runMatrix(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const tess = s.signedIn("usr_tess");
    const allowed = async (what: string): Promise<boolean> =>
      expectStatus(await s.call("access.check", admin, { principal: TESS, action: { level: "view" }, resource: CHANNEL }), 200, `access.check ${what}`).decision.allow === true;

    await trail.step("every built-in role holds exactly the catalogue's permissions", async () => {
      const roles = expectStatus(await s.call("access.roles.list", admin, {}), 200, "access.roles.list").roles as { name: string; permissions: string[] }[];
      for (const name of ["owner", "admin", "developer", "member", "guest"] as const) {
        const role = roles.find((r) => r.name.toLowerCase() === name);
        assert.ok(role, `access.roles.list has ${name}`);
        const want = PERMISSIONS.filter((p) => p.defaults[name]).map((p) => p.key).sort();
        assert.deepEqual([...role.permissions].sort(), want, `${name}: role permissions equal the catalogue column`);
      }
    });
    await trail.step("View as previews a member and is audited", async () => {
      const v = expectStatus(await s.call("access.view_as", admin, { person: "usr_noah" }), 200, "access.view_as");
      assert.ok(v.previewToken && v.expiresAt > Date.now(), `preview ${short(v)}`);
    });
    await trail.step("refusal: Tess cannot open View as", async () => {
      const r = await s.call("access.view_as", tess, { person: "usr_noah" });
      assert.equal(r.status, 403, `access.view_as as a temp: ${r.status} ${short(r.body?.error ?? r.body)}`);
    });
    await trail.step("the General channel is not visible to Tess", async () => { assert.equal(await allowed("before"), false); });
    const folder = await trail.step("a Clients folder is made", async () =>
      expectStatus(await s.call("folders.create", admin, { idempotencyKey: "golden-12-folder", type: "channel", name: "Clients", scope: "space" }), 200, "folders.create").folder.id as string);
    const grant = await trail.step("the Clients folder is shared with Tess", async () =>
      expectStatus(await s.call("access.share", admin, { idempotencyKey: "golden-12-share", resource: { type: "folder", id: folder! }, subject: TESS, level: "view" }), 200, "access.share").grant.id as string,
    ["a Clients folder is made"]);
    await trail.step("an item placed in the shared folder is visible to Tess", async () => {
      expectStatus(await s.call("folders.place", admin, { resource: CHANNEL, folderId: folder! }), 200, "folders.place");
      assert.equal(await allowed("placed"), true);
    }, ["the Clients folder is shared with Tess"]);
    await trail.step("moved out of the shared folder it is hidden again", async () => {
      expectStatus(await s.call("folders.unplace", admin, { resource: CHANNEL }), 200, "folders.unplace");
      assert.equal(await allowed("moved out"), false);
    }, ["an item placed in the shared folder is visible to Tess"]);
    await trail.step("the share is revoked", async () => {
      const out = expectStatus(await s.call("access.unshare", admin, { grantId: grant! }), 200, "access.unshare");
      assert.equal(out.revoked, 1);
    }, ["the Clients folder is shared with Tess"]);
    const request = await trail.step("Tess asks for access", async () =>
      expectStatus(await s.call("access.request", tess, { idempotencyKey: "golden-12-ask", resource: CHANNEL, level: "view", note: "I need the general channel" }), 200, "access.request").request.id as string);
    await trail.step("the admin approves and Tess's retry succeeds", async () => {
      expectStatus(await s.call("access.requests.approve", admin, { requestId: request!, level: "view" }), 200, "access.requests.approve");
      assert.equal(await allowed("after approval"), true);
    }, ["Tess asks for access"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runMatrix([]);
  if (trail.failures.length) throw new Error(`flow 12 failed:\n${trail.report()}`);
  return events;
}
