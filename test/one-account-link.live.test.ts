// Use one account everywhere (rc.17), live on two Space servers: a person made an account in A (their Personal one, say) and a separate one in B (their team's) before one account worked
// across Spaces. Settings proves both on the device (apps/app/src/places/settings/security.ts linkAccounts) and B takes the account kept from A. Afterwards one password and one recovery code
// work in both Spaces, B's data is intact (a Mine item sealed under B's old key still opens, through formerKey), the person, role and Space key in B are the same, old sessions in B ended, and
// the change is audited. The second person proves B's side with their recovery code instead of the password.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { heldKeyOf, openBundle, openSpaceKey, openWithRecovery } from "../client/src/crypto/keys.ts";
import { linkAccounts } from "../apps/app/src/places/settings/security.ts";
import type { LinkSide } from "../apps/app/src/places/settings/security.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, door, ok, standIn } from "./member-key-kit.ts";
import { FAST, PASSWORD, caller, joinWithNew, same, spaceB, spaceOf } from "./one-account-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const side = async (d: Daemon, token: string, name: string): Promise<LinkSide> => {
  const call = caller(d, token);
  const sec = await call("identity.security.get", {}) as { username: string };
  const keys = await call("identity.keys_get", {}) as { keys: { publicKey: string } };
  return { name, spaceId: await spaceOf(d), call, username: sec.username, publicKey: keys.keys.publicKey };
};

test("two accounts become one: the kept password and recovery code work in B, B's data and membership are intact, old sessions end, and it is audited", async () => {
  const dirs = [seededDir()];
  const a = await boot(dirs[0]!, standIn);
  const b = await spaceB("spc_oneid_mla", "MLA");
  try {
    const bSpace = await spaceOf(b);
    for (const who of [{ kept: "irfad", other: "irfad.mla", proveBy: "password" as const }, { kept: "lee", other: "lee.b", proveBy: "code" as const }]) {
      const KEPT_CODE = who.kept === "irfad" ? "KEPT-2KQX-7HMT-W4PD" : "LEEK-2KQX-7HMT-W4PD", OTHER_CODE = who.kept === "irfad" ? "OTHR-2KQX-7HMT-W4PD" : "LEEO-2KQX-7HMT-W4PD";
      const kept = await joinWithNew(a, who.kept, KEPT_CODE);
      const other = await joinWithNew(b, who.other, OTHER_CODE);
      // B holds data under B's own key: a Mine item, sealed with the key the device handed over at B's door
      assert.equal((await door(b, other.token, "unlock", other.personKey)).status, 204);
      const folder = (await ok(b, other.token, "vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
      const item = (await ok(b, other.token, "vault.item.put", { folderId: folder, name: "Bank_login", kind: "other", fields: [{ key: "pin", value: `the secret of ${who.other}`, secret: true }] })).item.id as string;
      const bKeysBefore = (await ok(b, other.token, "identity.keys_get")).keys;
      const openedBefore = await openBundle(PASSWORD, bKeysBefore, { argon: FAST });
      const spaceKeyBefore = await openSpaceKey(openedBefore.privateKey, bKeysBefore.spaceKeys[0], bSpace);
      const roleBefore = (await ok(b, other.token, "identity.whoami")).roles as string[];
      const secondDevice = (await api(b, null, "identity.sign_in", { username: who.other, password: PASSWORD, deviceName: "Phone", deviceClass: "phone" })).data.session.token as string;

      // Settings on the device: keep A's account, prove both
      const keep = await side(a, kept.token, "Personal");
      const otherSide = await side(b, other.token, "MLA");
      const stored: Array<{ spaceId: string; token: string; username: string }> = [];
      await linkAccounts(keep, PASSWORD, otherSide, who.proveBy === "password" ? PASSWORD : OTHER_CODE.toLowerCase(), { deviceName: "Mac", deviceClass: "desktop" }, (spaceId, token, username) => stored.push({ spaceId, token, username }), { argon: FAST });
      assert.equal(stored.length, 1);
      assert.equal(stored[0]!.spaceId, bSpace);
      assert.equal(stored[0]!.username, who.kept);
      const fresh = stored[0]!.token;

      // old sessions in B ended; the new one is the same person with the same role
      assert.equal((await api(b, other.token, "identity.whoami", {})).status, 401);
      assert.equal((await api(b, secondDevice, "identity.whoami", {})).status, 401);
      const me = await ok(b, fresh, "identity.whoami");
      assert.equal(me.principal.id, other.personId, "the same person in B");
      assert.deepEqual(me.roles, roleBefore, "the same role");
      // one password: the kept username and password sign in to B; the old ones do not
      assert.equal((await api(b, null, "identity.sign_in", { username: who.kept, password: PASSWORD, deviceName: "PC", deviceClass: "desktop" })).status, 200);
      assert.equal((await api(b, null, "identity.sign_in", { username: who.other, password: PASSWORD, deviceName: "PC", deviceClass: "desktop" })).status, 401);
      // one key pair and one recovery code: both open B's bundle, and what B is handed is B's own data key
      const inB = (await ok(b, fresh, "identity.keys_get")).keys;
      assert.equal(inB.publicKey, keep.publicKey);
      assert.ok(inB.formerKey);
      for (const opened of [await openBundle(PASSWORD, inB, { argon: FAST }), await openWithRecovery(KEPT_CODE, inB, { argon: FAST })]) {
        assert.ok(same(opened.personKey, kept.personKey), "the kept person key");
        assert.ok(same(heldKeyOf(opened), other.personKey), "B's data key, from formerKey");
        assert.ok(same(await openSpaceKey(opened.privateKey, inB.spaceKeys[0], bSpace), spaceKeyBefore), "the same Space key, sealed to the kept key pair");
      }
      await assert.rejects(openWithRecovery(OTHER_CODE, inB, { argon: FAST }), "B's old recovery code is retired");
      // B's data is intact: the device hands B the key from formerKey, and the Mine item opens
      const unlocked = await openBundle(PASSWORD, inB, { argon: FAST });
      assert.equal((await door(b, fresh, "unlock", heldKeyOf(unlocked))).status, 204);
      const shown = await ok(b, fresh, "vault.item.reveal", { itemId: item });
      assert.equal(shown.fields.find((f: { key: string }) => f.key === "pin")?.value, `the secret of ${who.other}`);
      // the same in A, untouched
      assert.equal((await api(a, kept.token, "identity.whoami", {})).status, 200);
      // audited, with the move named and no secret in it
      const rows = (await ok(b, b.token, "audit.list", { limit: 200 })).rows as Array<{ action: string; onBehalfOf?: { id: string } }>;
      const linked = rows.filter((r) => r.action === "identity.link_account" && JSON.stringify(r).includes(other.personId));
      assert.ok(linked.length >= 1, `an audit row for the link: ${JSON.stringify(rows.map((r) => r.action).slice(0, 40))}`);
      assert.ok(!JSON.stringify(rows).includes(PASSWORD), "no password in the audit log");
    }
  } finally {
    await a.stop(); await b.stop();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
