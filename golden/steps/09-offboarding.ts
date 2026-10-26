// Golden flow 9: offboarding (spec 2.1, 3.10, 2.25; ARCH 7.10). A person who joined by invite has two devices; an admin opens the removal wizard, applies the default plan, and every
// device of the person is ended: tokens answer 401, the devices are revoked, the sign-in is refused, and each device confirms its wipe. Through the gateway, real tokens.
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import { joinPerson, memberRole } from "./02-person-joining.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_OFFBOARDING = ["members", "identity", "devices", "access", "spaces", "tasks", "gate"];

/** Why this flow is a todo today (ruling 53). The join gaps are flow 2's; the rest is specific to offboarding. */
export const GAPS: Gap[] = [];

export async function runOffboarding(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const roleId = await trail.step("the Member role is listed", () => memberRole(s));
    const noel = await joinPerson(s, trail, "Noel", roleId ?? "rol_member");
    const phone = await trail.step("Noel signs in on a second device", async () => {
      const out = expectStatus(await s.call("identity.sign_in", null, { username: noel!.username, password: noel!.password, deviceName: "Noel phone", deviceClass: "phone" }), 200, "identity.sign_in");
      assert.equal(out.status, "ok");
      return out.session.token as string;
    }, ["Noel accepts"]);
    const devices = await trail.step("Noel has two live devices", async () => {
      const out = expectStatus(await s.call("devices.list", admin, { person: noel!.id }), 200, "devices.list").devices as { id: string; revokedAt?: number }[];
      assert.equal(out.filter((d) => !d.revokedAt).length, 2, `devices ${short(out)}`);
      return out.map((d) => d.id);
    }, ["Noel accepts", "Noel signs in on a second device"]);
    await trail.step("the wizard lists every kind with a default and a reassignment target", async () => {
      const p = expectStatus(await s.call("members.remove_preview", admin, { personId: noel!.id }), 200, "members.remove_preview");
      assert.equal(p.items.length, 11, `wizard kinds ${short(p.items.map((i: { kind: string }) => i.kind))}`);
      for (const i of p.items as { kind: string; defaultAction: string; reassignTo?: string; options: string[] }[]) {
        assert.ok(i.defaultAction && i.options.includes(i.defaultAction), `${i.kind} has a default among its options`);
        if (i.options.includes("reassign")) assert.ok(i.reassignTo, `${i.kind} names who it would be reassigned to`);
      }
    }, ["Noel accepts"]);
    await trail.step("refusal: Noel cannot remove anyone", async () => {
      const r = await s.call("members.remove", noel!.token, { personId: noel!.id, plan: [] });
      assert.equal(r.status, 403, `members.remove as a Member: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["Noel accepts"]);
    await trail.step("the admin removes Noel with the default plan", async () => {
      expectStatus(await s.call("members.remove", admin, { personId: noel!.id, plan: [], reason: "left the firm" }), 200, "members.remove");
    }, ["the wizard lists every kind with a default and a reassignment target"]);
    await trail.step("both of Noel's tokens are refused", async () => {
      for (const [name, tok] of [["laptop", noel!.token], ["phone", phone!]] as const) {
        const r = await s.call("identity.whoami", tok, {});
        assert.equal(r.status, 401, `${name} token after removal: ${r.status} ${short(r.body?.error ?? r.body)}`);
      }
    }, ["the admin removes Noel with the default plan"]);
    await trail.step("Noel's devices are revoked", async () => {
      const out = expectStatus(await s.call("devices.list", admin, { person: noel!.id }), 200, "devices.list").devices as { revokedAt?: number }[];
      assert.ok(out.length === 2 && out.every((d) => d.revokedAt), `devices ${short(out)}`);
    }, ["the admin removes Noel with the default plan"]);
    await trail.step("Noel cannot sign in again", async () => {
      const r = await s.call("identity.sign_in", null, { username: noel!.username, password: noel!.password, deviceName: "again", deviceClass: "web" });
      assert.ok(r.status >= 400 && r.status < 500, `a removed person's sign-in is a 4xx, got ${r.status}`);
    }, ["the admin removes Noel with the default plan"]);
    await trail.step("each revoked device confirms its wipe", async () => {
      for (const id of devices!) expectStatus(await s.call("devices.purge_ack", admin, { deviceId: id }), 200, "devices.purge_ack");
    }, ["Noel has two live devices", "the admin removes Noel with the default plan"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runOffboarding([]);
  if (trail.failures.length) throw new Error(`flow 9 failed:\n${trail.report()}`);
  return events;
}
