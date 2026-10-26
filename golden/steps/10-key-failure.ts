// Golden flow 10: a key failure falls back to the recovery code (spec 5 b7; ARCH 7.13). A member who joined by invite mistypes the password (signin.failed), had saved a recovery code
// (recovery.saved), and gets back in with it (signin.succeeded). Through the gateway: the member signs in with no token, everything else with the session that comes back.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import { joinPerson, memberRole } from "./02-person-joining.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_KEYFAIL = ["identity", "members", "devices", "tasks", "access", "spaces"];
export const GAPS: Gap[] = [];
const KEYS = { personKeyByPassword: "bmV3d3JhcHBlZA==", publicKey: "cHVibGlj", privateKeyWrapped: "d3JhcHBlZA==", spaceKeys: [{ epoch: 0, wrapped: "d3JhcHBlZA==" }] };

export async function runKeyFail(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const roleId = await trail.step("the Member role is listed", async () => await memberRole(s));
    const kay = await joinPerson(s, trail, "Kay", roleId ?? "rol_member");
    await trail.step("a mistyped password is refused", async () => {
      const r = await s.call("identity.sign_in", null, { username: kay!.username, password: "wrong password", deviceName: "Kay phone", deviceClass: "phone" });
      assert.equal(r.body?.error?.code, "auth.bad_credentials", `wrong password: ${r.status} ${short(r.body)}`);
    }, ["Kay accepts"]);
    const BLOB = "cmVjb3Zlcnk=";   // what her device wrapped her key with the recovery code into; the server keeps only its digest
    await trail.step("she saved a recovery code earlier", async () => {
      expectStatus(await s.call("identity.recovery_save", kay!.token, { idempotencyKey: "golden-10-recovery", personKeyByRecovery: BLOB }), 200, "identity.recovery_save");
    }, ["Kay accepts"]);
    await trail.step("a made-up recovery proof is refused", async () => {
      const r = await s.call("identity.recovery_restore", null, { username: kay!.username, recoveryProof: "recovery-proof", newPassword: "a brand new password", keys: KEYS, deviceName: "Kay phone", deviceClass: "phone" });
      assert.equal(r.status, 401, `a wrong proof: ${r.status} ${short(r.body?.error ?? r.body)}`);
      assert.equal(r.body?.error?.code, "auth.invalid_code");
    }, ["she saved a recovery code earlier"]);
    await trail.step("the recovery code gets her back in with a new password", async () => {
      const proof = Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(BLOB))).toString("base64url");   // the digest the server stored when she saved the code
      const out = expectStatus(await s.call("identity.recovery_restore", null, { username: kay!.username, recoveryProof: proof, newPassword: "a brand new password", keys: KEYS, deviceName: "Kay phone", deviceClass: "phone" }), 200, "identity.recovery_restore");
      assert.equal(out.status, "ok", `restore ${short(out)}`);
    }, ["a made-up recovery proof is refused"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runKeyFail([]);
  if (trail.failures.length) throw new Error(`flow 10 failed:\n${trail.report()}`);
  return events;
}
