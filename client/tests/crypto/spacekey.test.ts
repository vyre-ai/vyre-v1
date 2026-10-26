// P-SEC_11 (ruling 72): the Space key is made on the client at claim and sealed to the owner's X25519 public key. The known-answer vector is computed with Node's own X25519, HKDF and AES-GCM (a second
// implementation), the blob layout is pinned byte by byte, and a wrong Space, a wrong epoch, a wrong key or a changed byte all fail to open.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { KEY_BYTES, KeyError, NONCE_BYTES, SALT_BYTES, SPACE_KEY_VERSION, fromBase64, makeBundle, makeSpaceKey, openBundle, openSpaceKey, toBase64 } from "../../src/crypto/keys.ts";
import type { ArgonParams, KeyBundle } from "../../src/crypto/keys.ts";

const FAST: ArgonParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fixed = (n: number, from: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (from + i) & 0xff);
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const pkcs8Of = (seed: Uint8Array): Uint8Array => Buffer.concat([PKCS8_PREFIX, seed]);
const publicOf = (seed: Uint8Array): Buffer => {
  const x = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(pkcs8Of(seed)), format: "der", type: "pkcs8" })).export({ format: "jwk" }).x as string;
  return Buffer.from(x, "base64url");
};
const SPACE = "spc_core";

async function expectKeyError(code: string, run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (e) { assert.ok(e instanceof KeyError, e instanceof Error ? e.message : "a KeyError"); assert.equal(e.code, code); return; }
  assert.fail(`expected KeyError ${code}`);
}

test("a fixed recipient, ephemeral key, salt and nonce make the blob Node computes independently: version | ephemeral public | salt | nonce | AES-256-GCM(HKDF-SHA256(X25519))", async () => {
  const recipientSeed = fixed(32, 0x20), ephSeed = fixed(32, 0x60);
  const rand = (n: number): Uint8Array => fixed(n, 0x90);   // key, salt and nonce all come from here
  const sealed = await makeSpaceKey(toBase64(publicOf(recipientSeed)), SPACE, { rand, ephemeral: pkcs8Of(ephSeed) });
  assert.equal(sealed.epoch, 0);
  const blob = fromBase64(sealed.wrapped);
  assert.equal(blob.length, 1 + 32 + SALT_BYTES + NONCE_BYTES + KEY_BYTES + 16);
  assert.equal(blob[0], SPACE_KEY_VERSION);
  assert.equal(hex(blob.subarray(1, 33)), hex(publicOf(ephSeed)), "the ephemeral public key");
  assert.equal(hex(blob.subarray(33, 49)), hex(fixed(SALT_BYTES, 0x90)));
  assert.equal(hex(blob.subarray(49, 61)), hex(fixed(NONCE_BYTES, 0x90)));

  const shared = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey({ key: Buffer.from(pkcs8Of(ephSeed)), format: "der", type: "pkcs8" }),
    publicKey: crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(pkcs8Of(recipientSeed)), format: "der", type: "pkcs8" })),
  });
  const tag = `vyre/space-key/v1|${SPACE}|0`;
  const aesKey = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(fixed(SALT_BYTES, 0x90)), Buffer.from(tag), 32));
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, Buffer.from(fixed(NONCE_BYTES, 0x90)));
  cipher.setAAD(Buffer.from(tag));
  const expected = Buffer.concat([cipher.update(Buffer.from(fixed(KEY_BYTES, 0x90))), cipher.final(), cipher.getAuthTag()]);
  assert.equal(hex(blob.subarray(61)), hex(expected));
  assert.ok(!hex(blob).includes(hex(fixed(KEY_BYTES, 0x90))), "the Space key is not in the blob in the clear");

  // and the owner's private key opens it back to the key
  const opened = await openSpaceKey(pkcs8Of(recipientSeed), sealed, SPACE);
  assert.equal(hex(opened), hex(fixed(KEY_BYTES, 0x90)));
});

test("a claim bundle carries the Space key: sign-up with a spaceId seals epoch 0 to the new public key, and the owner opens it after sign-in", async () => {
  const made = await makeBundle("correct horse battery staple", "ember-lark-quill-delta-nine", { argon: FAST, spaceId: SPACE });
  assert.equal(made.spaceKeys?.length, 1);
  assert.equal(made.spaceKeys?.[0]?.epoch, 0);
  const bundle: KeyBundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
  const opened = await openBundle("correct horse battery staple", bundle, { argon: FAST });
  const key = await openSpaceKey(opened.privateKey, made.spaceKeys![0]!, SPACE);
  assert.equal(key.length, KEY_BYTES);
  const second = await makeBundle("correct horse battery staple", "ember-lark-quill-delta-nine", { argon: FAST, spaceId: SPACE });
  assert.notEqual(second.spaceKeys![0]!.wrapped, made.spaceKeys![0]!.wrapped, "every Space key is random");
  const without = await makeBundle("correct horse battery staple", "ember-lark-quill-delta-nine", { argon: FAST });
  assert.equal("spaceKeys" in without, false, "no spaceId, no Space key");
});

test("a wrong Space, a wrong epoch, another person's key and a changed byte fail to open, and the version is checked", async () => {
  const mine = await makeBundle("pw one", "rc one", { argon: FAST, spaceId: SPACE });
  const other = await makeBundle("pw two", "rc two", { argon: FAST });
  const open = async (b: typeof mine, pw: string) => (await openBundle(pw, { personKeyByPassword: b.personKeyByPassword, personKeyByRecovery: b.personKeyByRecovery, publicKey: b.publicKey, privateKeyWrapped: b.privateKeyWrapped }, { argon: FAST })).privateKey;
  const sealed = mine.spaceKeys![0]!;
  const priv = await open(mine, "pw one");
  assert.equal((await openSpaceKey(priv, sealed, SPACE)).length, KEY_BYTES);
  await expectKeyError("bad_secret", () => openSpaceKey(priv, sealed, "spc_other"));
  await expectKeyError("bad_secret", () => openSpaceKey(priv, { ...sealed, epoch: 1 }, SPACE));
  await expectKeyError("bad_secret", async () => openSpaceKey(await open(other, "pw two"), sealed, SPACE));
  const blob = fromBase64(sealed.wrapped);
  for (const at of [1, 40, 55, 70, blob.length - 1]) {
    const bent = Uint8Array.from(blob); bent[at] = (bent[at] ?? 0) ^ 1;
    await expectKeyError("bad_secret", () => openSpaceKey(priv, { epoch: 0, wrapped: toBase64(bent) }, SPACE));
  }
  const future = Uint8Array.from(blob); future[0] = SPACE_KEY_VERSION + 1;
  await expectKeyError("unsupported_version", () => openSpaceKey(priv, { epoch: 0, wrapped: toBase64(future) }, SPACE));
  await expectKeyError("bad_blob", () => openSpaceKey(priv, { epoch: 0, wrapped: toBase64(blob.subarray(0, 40)) }, SPACE));
  await expectKeyError("bad_blob", () => makeSpaceKey(toBase64(fixed(31, 0)), SPACE));
  await expectKeyError("bad_blob", () => makeSpaceKey(mine.publicKey, ""));
});
