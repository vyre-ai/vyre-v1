// Golden flow 10: a key failure falls back to the recovery code (spec 5 b7; ARCH 7.13). A member who joined by invite mistypes the password (signin.failed), had saved a recovery code
// (recovery.saved), and gets back in with it (signin.succeeded). Through the gateway: the member signs in with no token, everything else with the session that comes back.
import assert from "node:assert/strict";
import { makeBundle, openWithRecovery, rewrap } from "../../client/src/crypto/keys.ts";
import { openSeal } from "../../kernel/src/seal/box.ts";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import { joinPerson, memberRole } from "./02-person-joining.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_KEYFAIL = ["identity", "members", "devices", "tasks", "access", "spaces"];
export const GAPS: Gap[] = [];
const CODE = "a saved high entropy recovery code only on her device", PASSWORD = "correct horse battery", NEW_PASSWORD = "a brand new password";

export async function runKeyFail(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const roleId = await trail.step("the Member role is listed", async () => await memberRole(s));
    // Her device makes real keys (the client helpers), so the saved code really opens her private key and answers the server's sealed challenge.
    const made = await makeBundle(PASSWORD, CODE, {});
    const keys = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys ?? [] };
    made.personKey.fill(0);
    const kay = await joinPerson(s, trail, "Kay", roleId ?? "rol_member", keys);
    await trail.step("a mistyped password is refused", async () => {
      const r = await s.call("identity.sign_in", null, { username: kay!.username, password: "wrong password", deviceName: "Kay phone", deviceClass: "phone" });
      assert.equal(r.body?.error?.code, "auth.bad_credentials", `wrong password: ${r.status} ${short(r.body)}`);
    }, ["Kay accepts"]);
    await trail.step("she saved a recovery code earlier", async () => {
      expectStatus(await s.call("identity.recovery_save", kay!.token, { idempotencyKey: "golden-10-recovery", personKeyByRecovery: keys.personKeyByRecovery }), 200, "identity.recovery_save");
    }, ["Kay accepts"]);
    await trail.step("a made-up recovery proof is refused", async () => {
      const r = await s.call("identity.recovery_restore", null, { username: kay!.username, recoveryProof: "recovery-proof", newPassword: NEW_PASSWORD, keys, deviceName: "Kay phone", deviceClass: "phone" });
      assert.equal(r.status, 401, `a wrong proof: ${r.status} ${short(r.body?.error ?? r.body)}`);
      assert.equal(r.body?.error?.code, "auth.invalid_code");
    }, ["she saved a recovery code earlier"]);
    await trail.step("the recovery code gets her back in with a new password", async () => {
      // Fetch the recovery-only bundle and sealed challenge, open her private key with the saved code, unseal the one-use nonce, and replace only the password wrap.
      const fetched = expectStatus(await s.call("identity.recovery_fetch", null, { username: kay!.username }), 200, "identity.recovery_fetch") as unknown as { keys: Record<string, unknown>; challenge: { eph: string; iv: string; ct: string; tag: string }; context: string };
      assert.equal(fetched.keys["personKeyByPassword"], undefined, "the public fetch never carries the password wrap");
      const opened = await openWithRecovery(CODE, { ...(fetched.keys as object), personKeyByPassword: "" } as never);
      const nonce = openSeal(Buffer.from(opened.privateKey).subarray(-32).toString("base64url"), fetched.challenge, fetched.context).toString("base64url");
      opened.personKey.fill(0); opened.privateKey.fill(0);
      const next = { ...(await rewrap(PASSWORD, NEW_PASSWORD, keys)), spaceKeys: keys.spaceKeys };
      const out = expectStatus(await s.call("identity.recovery_restore", null, { username: kay!.username, recoveryProof: nonce, newPassword: NEW_PASSWORD, keys: next, deviceName: "Kay phone", deviceClass: "phone" }), 200, "identity.recovery_restore") as unknown as { keys: typeof keys; session: { token: string } };
      assert.ok(out.session?.token, `restore returns a session ${short(out)}`);
      assert.equal(out.keys.publicKey, keys.publicKey, "the same identity key");
      assert.equal(out.keys.privateKeyWrapped, keys.privateKeyWrapped, "the same private key wrap");
      assert.equal(out.keys.personKeyByRecovery, keys.personKeyByRecovery, "the same recovery wrap");
      assert.deepEqual(out.keys.spaceKeys, keys.spaceKeys, "the same Space key wraps");
      assert.notEqual(out.keys.personKeyByPassword, keys.personKeyByPassword, "only the password wrap changed");
    }, ["a made-up recovery proof is refused"]);
    await trail.step("the old password fails and the new one signs in", async () => {
      const old = await s.call("identity.sign_in", null, { username: kay!.username, password: PASSWORD, deviceName: "Kay phone", deviceClass: "phone" });
      assert.equal(old.status, 401, `the old password: ${old.status} ${short(old.body)}`);
      expectStatus(await s.call("identity.sign_in", null, { username: kay!.username, password: NEW_PASSWORD, deviceName: "Kay phone", deviceClass: "phone" }), 200, "identity.sign_in");
    }, ["the recovery code gets her back in with a new password"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runKeyFail([]);
  if (trail.failures.length) throw new Error(`flow 10 failed:\n${trail.report()}`);
  return events;
}
