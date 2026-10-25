// Vault crypto (P-L7_09; spec 2.17 Encryption split; ARCH 7.8): enc=2 Mine rows under a wrapped item key, enc=1 Shared rows under the filler's key, Argon2id parameters, and key rotation for both.
// @reads /modules/vault/handlers/crypto.ts
import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { argon2id, STRETCH } from "../../../kernel/src/seal/index.ts";
import {
  ENC_MINE, ENC_SHARED, Filler, VAULT_STRETCH, keyIdOf, openMine, rewrapMine, sealMine, wrapKeyFromPassword, wrapKeyFromPersonKey,
} from "../handlers/crypto.ts";
import type { Field } from "../handlers/crypto.ts";
import { MAYA, ROB, keyOfPerson } from "../fixtures/harness.ts";

const FIELDS: Field[] = [{ key: "username", value: "dana", secret: false }, { key: "api_key", value: "sk-test-1234", secret: true }];
const wrapMaya = wrapKeyFromPersonKey(keyOfPerson(MAYA));

test("enc=2: a Mine row holds a random item key wrapped for the owner, and nothing else opens it", () => {
  assert.deepEqual([ENC_SHARED, ENC_MINE], [1, 2]);
  const a = sealMine("vit_a", FIELDS, wrapMaya);
  assert.equal(a.enc, 2);
  assert.ok(a.wrapped, "the item key is stored wrapped");
  assert.deepEqual(openMine("vit_a", a, wrapMaya), FIELDS);
  assert.ok(!JSON.stringify(a).includes("sk-test-1234") && !JSON.stringify(a).includes("dana"));

  const b = sealMine("vit_a", FIELDS, wrapMaya);
  assert.notDeepEqual(b.box, a.box, "fresh iv and a fresh item key every time");
  assert.notDeepEqual(b.wrapped, a.wrapped);
  assert.equal(b.keyId, a.keyId, "the key id names the wrap key, not the item key");
  assert.match(a.keyId, /^k_[0-9a-f]{12}$/);

  assert.throws(() => openMine("vit_a", a, wrapKeyFromPersonKey(keyOfPerson(ROB))), "another person's key");
  assert.throws(() => openMine("vit_other", a, wrapMaya), "the item id is bound in");
  assert.throws(() => openMine("vit_a", { ...a, rev: 2 }, wrapMaya), "the revision is bound in");
  const flipped = { ...a, box: { ...a.box, ct: (a.box.ct[0] === "A" ? "B" : "A") + a.box.ct.slice(1) } };
  assert.throws(() => openMine("vit_a", flipped, wrapMaya), "a changed byte is caught");
  assert.throws(() => openMine("vit_a", { ...a, enc: 1 }, wrapMaya), "a Shared row is not a Mine row");
});

test("enc=1: the filler seals and opens Shared rows, never shows its key, and another service cannot open them", () => {
  const f = new Filler(new Uint8Array(32).fill(5));
  const row = f.seal("vit_s", FIELDS);
  assert.deepEqual([row.enc, row.wrapped, row.keyId], [1, undefined, f.keyId]);
  assert.deepEqual(f.open("vit_s", row), FIELDS);
  assert.ok(!JSON.stringify(row).includes("sk-test-1234"));
  assert.throws(() => new Filler(new Uint8Array(32).fill(6)).open("vit_s", row));
  assert.throws(() => f.open("vit_other", row), "the item id is bound in");
  assert.throws(() => f.open("vit_s", sealMine("vit_s", FIELDS, wrapMaya)), "a Mine row is not the filler's");
  assert.throws(() => new Filler(new Uint8Array(31)), RangeError);

  // nothing a logger, a JSON dump or a debugger can find
  assert.deepEqual(Object.keys(f), []);
  assert.equal(JSON.stringify(f), JSON.stringify({ keyId: f.keyId }));
  assert.equal(String(f), `Filler(${f.keyId})`);
  assert.equal(inspect(f), `Filler(${f.keyId})`);
  assert.ok(!inspect(f, { showHidden: true, depth: 5 }).includes("0505050505"));
  assert.equal(keyIdOf(new Uint8Array(32).fill(5)), f.keyId);
});

test("Argon2id: the vault uses the kernel's parameters and a salt per person", () => {
  assert.deepEqual({ ...VAULT_STRETCH }, { memoryKiB: 19456, passes: 2, lanes: 1, tagLength: 32 }, "19 MiB, two passes, one lane, a 32 byte tag");
  assert.deepEqual({ ...VAULT_STRETCH }, { ...STRETCH }, "the same parameters as the recovery stretch");
  const a = wrapKeyFromPassword("correct horse battery staple", MAYA);
  assert.equal(a.length, 32);
  assert.deepEqual(a, wrapKeyFromPassword("correct horse battery staple", MAYA), "deterministic");
  assert.notDeepEqual(a, wrapKeyFromPassword("correct horse battery stapl3", MAYA), "a different password");
  assert.notDeepEqual(a, wrapKeyFromPassword("correct horse battery staple", ROB), "a different person: two people with one password do not share a key");
  assert.deepEqual(a, wrapKeyFromPersonKey(argon2id("correct horse battery staple", `vyre-vault-mine:${MAYA}`, VAULT_STRETCH)), "Argon2id, then the wrap derivation");
});

test("key rotation, Mine: a new password moves the item key to a new wrap key without touching the sealed fields", () => {
  const oldWrap = wrapKeyFromPassword("old password", MAYA);
  const newWrap = wrapKeyFromPassword("new password", MAYA);
  const row = sealMine("vit_r", FIELDS, oldWrap, 3);
  const moved = rewrapMine("vit_r", row, oldWrap, newWrap);
  assert.deepEqual(moved.box, row.box, "the fields are not re-encrypted");
  assert.notDeepEqual(moved.wrapped, row.wrapped);
  assert.equal(moved.keyId, keyIdOf(newWrap));
  assert.notEqual(moved.keyId, row.keyId);
  assert.equal(moved.rev, 3);
  assert.deepEqual(openMine("vit_r", moved, newWrap), FIELDS);
  assert.throws(() => openMine("vit_r", moved, oldWrap), "the old password no longer opens it");
  assert.throws(() => rewrapMine("vit_r", row, newWrap, oldWrap), "rewrapping needs the old key");
  assert.throws(() => rewrapMine("vit_r", { ...row, enc: 1 }, oldWrap, newWrap));
});

test("key rotation, Shared: a new filler key seals new rows, old rows open until moved, then the old key is retired", () => {
  const f = new Filler(new Uint8Array(32).fill(1));
  const oldId = f.keyId;
  const old = f.seal("vit_a", FIELDS);
  const kept = f.seal("vit_b", FIELDS);
  const newId = f.rotate(new Uint8Array(32).fill(2));
  assert.notEqual(newId, oldId);
  assert.equal(f.keyId, newId);
  assert.deepEqual(f.keyIds, [newId, oldId]);
  assert.equal(f.seal("vit_c", FIELDS).keyId, newId, "new rows use the new key");
  assert.deepEqual(f.open("vit_a", old), FIELDS, "rows sealed before still open");

  const moved = f.reseal("vit_a", old);
  assert.deepEqual([moved.keyId, moved.rev], [newId, old.rev + 1]);
  assert.deepEqual(f.open("vit_a", moved), FIELDS);
  assert.equal(f.rotate(new Uint8Array(32).fill(2)), newId, "the same key again changes nothing");
  assert.deepEqual(f.keyIds, [newId, oldId]);

  assert.equal(f.retire(oldId), true);
  assert.throws(() => f.open("vit_b", kept), "a row nobody moved is lost with its key: move every row first");
  assert.equal(f.retire(oldId), false);
  assert.equal(f.retire(newId), false, "the current key cannot be retired");
  assert.deepEqual(f.keyIds, [newId]);
  assert.throws(() => f.rotate(new Uint8Array(5)), RangeError);
});
