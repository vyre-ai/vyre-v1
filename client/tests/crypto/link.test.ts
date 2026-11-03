// rc.17, one account everywhere, on the client: the recovery-code carry, the account link, and the former key a linked Space keeps its data under.
import test from "node:test";
import assert from "node:assert/strict";
import { KeyError, carryBundle, carryWithRecovery, heldKeyOf, linkBundle, makeBundle, openBundle, openSpaceKey, openWithRecovery, rewrap, sealSpaceKey, wipeOpened } from "../../src/crypto/keys.ts";
import type { ArgonParams } from "../../src/crypto/keys.ts";

const FAST: ArgonParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };
const o = { argon: FAST };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

test("the recovery code carries the same person key to a new Space under a password chosen now, and the same code still opens it there", async () => {
  const home = await makeBundle("forgotten key password", "RCV1-AAAA-BBBB-CCCC", { ...o, spaceId: "spc_home" });
  const made = await carryWithRecovery("RCV1-AAAA-BBBB-CCCC", "a password chosen now", { personKeyByRecovery: home.personKeyByRecovery, publicKey: home.publicKey, privateKeyWrapped: home.privateKeyWrapped }, "spc_new", o);
  assert.equal(hex(made.personKey), hex(home.personKey));
  assert.equal(made.publicKey, home.publicKey);
  assert.equal(made.personKeyByRecovery, home.personKeyByRecovery);
  assert.notEqual(made.personKeyByPassword, home.personKeyByPassword);
  const byPw = await openBundle("a password chosen now", made, o);
  const byCode = await openWithRecovery("RCV1-AAAA-BBBB-CCCC", made, o);
  assert.equal(hex(byPw.personKey), hex(home.personKey));
  assert.equal(hex(byCode.personKey), hex(home.personKey));
  const sk = await openSpaceKey(byPw.privateKey, made.spaceKeys[0]!, "spc_new");
  assert.equal(sk.length, 32);
  await assert.rejects(carryWithRecovery("WRNG-AAAA-BBBB-CCCC", "x".repeat(10), { personKeyByRecovery: home.personKeyByRecovery, publicKey: home.publicKey, privateKeyWrapped: home.privateKeyWrapped }, "spc_new", o), (e) => e instanceof KeyError && e.code === "bad_secret");
});

test("a link: the kept password and code open the other Space, its Space key is sealed again for the kept key pair, and its data key comes back through formerKey", async () => {
  const kept = await makeBundle("kept password", "KEPT-CODE-AAAA-BBBB", { ...o, spaceId: "spc_personal" });
  const other = await makeBundle("other password", "OTHR-CODE-AAAA-BBBB", { ...o, spaceId: "spc_mla" });
  const otherOpened = await openBundle("other password", { ...other }, o);
  const otherSpaceKey = await openSpaceKey(otherOpened.privateKey, other.spaceKeys![0]!, "spc_mla");
  // a second epoch, so every one is carried over
  const second = await sealSpaceKey(new Uint8Array(32).fill(7), other.publicKey, "spc_mla", 1);
  const linked = await linkBundle({ password: "kept password", bundle: kept }, { secret: { password: "other password" }, bundle: { ...other, spaceKeys: [...other.spaceKeys!, second] } }, "spc_mla", o);
  assert.equal(linked.publicKey, kept.publicKey);
  assert.equal(linked.personKeyByPassword, kept.personKeyByPassword);
  assert.equal(linked.personKeyByRecovery, kept.personKeyByRecovery);
  assert.deepEqual(linked.spaceKeys.map((k) => k.epoch), [0, 1]);
  for (const opened of [await openBundle("kept password", linked, o), await openWithRecovery("KEPT-CODE-AAAA-BBBB", linked, o)]) {
    assert.equal(hex(opened.personKey), hex(kept.personKey), "the kept person key");
    assert.equal(hex(heldKeyOf(opened)), hex(other.personKey), "the Space is handed the key its data is under");
    assert.equal(hex(await openSpaceKey(opened.privateKey, linked.spaceKeys[0]!, "spc_mla")), hex(otherSpaceKey), "the same Space key, now for the kept key pair");
    assert.equal(hex(await openSpaceKey(opened.privateKey, linked.spaceKeys[1]!, "spc_mla")), hex(new Uint8Array(32).fill(7)));
    wipeOpened(opened);
  }
  // the old password no longer opens it, and a password change there keeps the former key
  await assert.rejects(openBundle("other password", linked, o), (e) => e instanceof KeyError && e.code === "bad_secret");
  const changed = await rewrap("kept password", "a newer password", linked, o);
  assert.equal(changed.formerKey, linked.formerKey);
  assert.equal(hex(heldKeyOf(await openBundle("a newer password", changed, o))), hex(other.personKey));
  // carrying from a linked Space takes the person key, never that Space's former key
  const onward = await carryBundle("kept password", linked, "spc_third", o);
  assert.equal((onward as { formerKey?: string }).formerKey, undefined);
  assert.equal(hex(onward.personKey), hex(kept.personKey));
});

test("a link proved with the other side's recovery code, a link of a linked Space keeps the oldest data key, and one account cannot link to itself", async () => {
  const kept = await makeBundle("kept password", "KEPT-CODE-AAAA-BBBB", { ...o, spaceId: "spc_a" });
  const other = await makeBundle("forgotten", "OTHR-CODE-AAAA-BBBB", { ...o, spaceId: "spc_b" });
  const linked = await linkBundle({ password: "kept password", bundle: kept }, { secret: { recoveryCode: "OTHR-CODE-AAAA-BBBB" }, bundle: { ...other, spaceKeys: other.spaceKeys! } }, "spc_b", o);
  assert.equal(hex(heldKeyOf(await openBundle("kept password", linked, o))), hex(other.personKey));
  // linking that Space again, to a third account: its data key is still the original one
  const third = await makeBundle("third password", "THRD-CODE-AAAA-BBBB", { ...o, spaceId: "spc_c" });
  const again = await linkBundle({ password: "third password", bundle: third }, { secret: { password: "kept password" }, bundle: linked }, "spc_b", o);
  assert.equal(hex(heldKeyOf(await openBundle("third password", again, o))), hex(other.personKey));
  await assert.rejects(linkBundle({ password: "kept password", bundle: kept }, { secret: { password: "kept password" }, bundle: { ...kept, spaceKeys: kept.spaceKeys! } }, "spc_a", o), (e) => e instanceof KeyError && e.code === "bad_blob");
  await assert.rejects(linkBundle({ password: "wrong", bundle: kept }, { secret: { password: "forgotten" }, bundle: { ...other, spaceKeys: other.spaceKeys! } }, "spc_b", o), (e) => e instanceof KeyError && e.code === "bad_secret");
  await assert.rejects(linkBundle({ password: "kept password", bundle: kept }, { secret: { recoveryCode: "WRNG-CODE-AAAA-BBBB" }, bundle: { ...other, spaceKeys: other.spaceKeys! } }, "spc_b", o), (e) => e instanceof KeyError && e.code === "bad_secret");
});

test("a damaged formerKey is refused, never handed over as a key", async () => {
  const kept = await makeBundle("kept password", "KEPT-CODE-AAAA-BBBB", { ...o, spaceId: "spc_a" });
  const other = await makeBundle("other", "OTHR-CODE-AAAA-BBBB", { ...o, spaceId: "spc_b" });
  const linked = await linkBundle({ password: "kept password", bundle: kept }, { secret: { password: "other" }, bundle: { ...other, spaceKeys: other.spaceKeys! } }, "spc_b", o);
  const bytes = Buffer.from(linked.formerKey, "base64"); bytes[bytes.length - 1]! ^= 1;
  await assert.rejects(openBundle("kept password", { ...linked, formerKey: bytes.toString("base64") }, o), (e) => e instanceof KeyError && e.code === "bad_blob");
});
