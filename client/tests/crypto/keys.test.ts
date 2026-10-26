// P-SEC_09 (ruling 63): the person key bundle on the client. Known-answer vectors are checked against Node's own Argon2id and AES-GCM (a second implementation), the blob layout is pinned byte by byte,
// and the refusals are clean: a wrong password, a changed byte, a blob presented for another purpose. Nothing secret reaches storage, logs or an error message.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ARGON, KeyError, UNSUPPORTED_MESSAGE, assertSupported, isSupported, KEY_BYTES, NONCE_BYTES, SALT_BYTES, VERSION, fromBase64, makeBundle, openBundle, openWithRecovery, parse, rewrap, seal, stretch, toBase64,
} from "../../src/crypto/keys.ts";
import type { ArgonParams, KeyBundle } from "../../src/crypto/keys.ts";

const FAST: ArgonParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };   // for tests that do not check the cost itself
const PASSWORD = "correct horse battery staple";
const RECOVERY = "ember-lark-quill-delta-nine";
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fixed = (n: number, from: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (from + i) & 0xff);
const text = new TextDecoder();

async function expectKeyError(code: string, run: () => Promise<unknown>): Promise<KeyError> {
  try { await run(); } catch (e) { assert.ok(e instanceof KeyError, e instanceof Error ? e.message : "a KeyError"); assert.equal(e.code, code); return e; }
  assert.fail(`expected KeyError ${code}`);
}

test("the cost is the ruling: Argon2id 64 MiB, 3 passes, 1 lane, 32-byte key, and hash-wasm derives what Node's Argon2id derives for the same password and salt", async () => {
  assert.deepEqual({ ...ARGON }, { memoryKiB: 65536, iterations: 3, parallelism: 1 });
  const salt = fixed(SALT_BYTES, 0x10);
  const mine = await stretch(PASSWORD, salt);
  assert.equal(mine.length, KEY_BYTES);
  const reference = crypto.argon2Sync("argon2id", { message: Buffer.from(PASSWORD.normalize("NFKC")), nonce: Buffer.from(salt), parallelism: 1, tagLength: 32, memory: 65536, passes: 3 });
  assert.equal(hex(mine), hex(reference));
});

test("a sealed blob is version | salt | nonce | ciphertext+tag, and equals AES-256-GCM computed independently for a fixed key, salt and nonce", async () => {
  const key = fixed(KEY_BYTES, 0x40), salt = fixed(SALT_BYTES, 0x80), nonce = fixed(NONCE_BYTES, 0xc0), plain = fixed(32, 0x01);
  const blob = await seal(key, plain, "password", salt, nonce);
  assert.equal(blob.length, 1 + SALT_BYTES + NONCE_BYTES + 32 + 16);
  assert.equal(blob[0], VERSION);
  assert.equal(hex(blob.subarray(1, 17)), hex(salt));
  assert.equal(hex(blob.subarray(17, 29)), hex(nonce));
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("vyre/person-key/v1/password"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  assert.equal(hex(blob.subarray(29)), hex(Buffer.concat([ct, cipher.getAuthTag()])));
  const p = parse(blob);
  assert.deepEqual([hex(p.salt), hex(p.nonce)], [hex(salt), hex(nonce)]);
});

test("a fixed password, salt and nonce make a known password blob: the Argon2id key of the password seals the person key", async () => {
  const salt = fixed(SALT_BYTES, 0x20), nonce = fixed(NONCE_BYTES, 0x30), personKey = fixed(KEY_BYTES, 0x50);
  const made = await makeBundle(PASSWORD, RECOVERY, { salt, nonce, rand: (n) => (n === KEY_BYTES ? personKey.slice() : crypto.randomBytes(n)) });
  const blob = fromBase64(made.personKeyByPassword);
  const key = crypto.argon2Sync("argon2id", { message: Buffer.from(PASSWORD), nonce: Buffer.from(salt), parallelism: 1, tagLength: 32, memory: 65536, passes: 3 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("vyre/person-key/v1/password"));
  const ct = Buffer.concat([cipher.update(personKey), cipher.final()]);
  const expected = Buffer.concat([Buffer.from([VERSION]), salt, nonce, ct, cipher.getAuthTag()]);
  assert.equal(hex(blob), hex(expected));
});

test("sign-up makes a bundle and sign-in opens it: the password gives the person key and the private key, and the public key matches", async () => {
  const made = await makeBundle(PASSWORD, RECOVERY, { argon: FAST });
  assert.equal(made.personKey.length, KEY_BYTES);
  assert.deepEqual(Object.keys(made).sort(), ["personKey", "personKeyByPassword", "personKeyByRecovery", "privateKeyWrapped", "publicKey"]);
  assert.equal(fromBase64(made.publicKey).length, 32, "a raw X25519 public key");
  const bundle: KeyBundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
  const opened = await openBundle(PASSWORD, bundle, { argon: FAST });
  assert.equal(hex(opened.personKey), hex(made.personKey));
  assert.ok(opened.privateKey.length > 32, "the PKCS8 private key");
  const viaRecovery = await openWithRecovery(RECOVERY, bundle, { argon: FAST });
  assert.equal(hex(viaRecovery.personKey), hex(made.personKey), "the recovery code opens the same person key");
  assert.equal(hex(viaRecovery.privateKey), hex(opened.privateKey));
});

test("a wrong password, a wrong recovery code, a changed byte and a blob offered for another purpose all fail cleanly as bad_secret, with nothing secret in the message", async () => {
  const made = await makeBundle(PASSWORD, RECOVERY, { argon: FAST });
  const bundle: KeyBundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
  const wrong = await expectKeyError("bad_secret", () => openBundle("not the password", bundle, { argon: FAST }));
  for (const secret of [PASSWORD, RECOVERY, "not the password", hex(made.personKey), toBase64(made.personKey)]) assert.ok(!wrong.message.includes(secret));
  await expectKeyError("bad_secret", () => openWithRecovery("wrong-code", bundle, { argon: FAST }));
  const flipped = fromBase64(bundle.personKeyByPassword);
  flipped[flipped.length - 1] = (flipped[flipped.length - 1]! ^ 1) & 0xff;
  await expectKeyError("bad_secret", () => openBundle(PASSWORD, { ...bundle, personKeyByPassword: toBase64(flipped) }, { argon: FAST }));
  // the recovery blob presented as the password blob: the password cannot derive its key, and its purpose differs even when the secret is the same
  await expectKeyError("bad_secret", () => openBundle(RECOVERY, { ...bundle, personKeyByPassword: bundle.personKeyByRecovery }, { argon: FAST }));
  await expectKeyError("bad_blob", () => openBundle(PASSWORD, { ...bundle, personKeyByPassword: toBase64(Uint8Array.of(1, 2, 3)) }, { argon: FAST }));
  await expectKeyError("bad_blob", () => openBundle(PASSWORD, { ...bundle, personKeyByPassword: "!!!not base64!!!" }, { argon: FAST }));
  const future = fromBase64(bundle.personKeyByPassword);
  future[0] = 2;
  await expectKeyError("unsupported_version", () => openBundle(PASSWORD, { ...bundle, personKeyByPassword: toBase64(future) }, { argon: FAST }));
});

test("a public key that is not the private key's is refused on open", async () => {
  const a = await makeBundle(PASSWORD, RECOVERY, { argon: FAST });
  const b = await makeBundle(PASSWORD, RECOVERY, { argon: FAST });
  await expectKeyError("bad_blob", () => openBundle(PASSWORD, { personKeyByPassword: a.personKeyByPassword, personKeyByRecovery: a.personKeyByRecovery, privateKeyWrapped: a.privateKeyWrapped, publicKey: b.publicKey }, { argon: FAST }));
});

test("rewrap keeps the person key, the key pair and the recovery wrap, the old password stops working and the new one works", async () => {
  const made = await makeBundle(PASSWORD, RECOVERY, { argon: FAST });
  const bundle: KeyBundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
  const next = await rewrap(PASSWORD, "a brand new passphrase", bundle, { argon: FAST });
  assert.notEqual(next.personKeyByPassword, bundle.personKeyByPassword);
  assert.deepEqual([next.personKeyByRecovery, next.publicKey, next.privateKeyWrapped], [bundle.personKeyByRecovery, bundle.publicKey, bundle.privateKeyWrapped]);
  await expectKeyError("bad_secret", () => openBundle(PASSWORD, next, { argon: FAST }));
  assert.equal(hex((await openBundle("a brand new passphrase", next, { argon: FAST })).personKey), hex(made.personKey));
  assert.equal(hex((await openWithRecovery(RECOVERY, next, { argon: FAST })).personKey), hex(made.personKey));
  await expectKeyError("bad_secret", () => rewrap("not the old password", "x", bundle, { argon: FAST }));
});

test("nothing secret reaches storage, logs or the bundle's wire form", async () => {
  const source = readFileSync(new URL("../../src/crypto/keys.ts", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|console\./.test(source.replace(/\/\/.*$/gm, "")), "the module never touches browser storage and never logs");
  const lines: string[] = [];
  const spied = ["log", "info", "warn", "error", "debug"] as const;
  const saved = spied.map((k) => console[k]);
  for (const k of spied) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const made = await makeBundle(PASSWORD, RECOVERY, { argon: FAST });
    const bundle: KeyBundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
    const opened = await openBundle(PASSWORD, bundle, { argon: FAST });
    await rewrap(PASSWORD, "another passphrase", bundle, { argon: FAST });
    const wire = JSON.stringify(bundle);
    for (const secret of [PASSWORD, RECOVERY, hex(made.personKey), toBase64(made.personKey), toBase64(opened.privateKey)]) assert.ok(!wire.includes(secret) && !lines.join("\n").includes(secret));
    assert.ok(!text.decode(fromBase64(bundle.personKeyByPassword)).includes(PASSWORD), "the blob is ciphertext");
    assert.deepEqual(lines, [], "nothing is logged");
  } finally {
    spied.forEach((k, i) => { console[k] = saved[i]!; });
  }
});

test("a browser without X25519 or AES-GCM gets one clear message at sign-up and sign-in, not a failure inside key derivation", async () => {
  assert.equal(await isSupported(), true, "Node 24 WebCrypto has both");
  const lacking = (missing: string): SubtleCrypto => ({
    generateKey: async (alg: { name: string }) => { if (alg.name === missing) throw new DOMException("not supported", "NotSupportedError"); return {} as CryptoKey; },
  }) as unknown as SubtleCrypto;
  assert.equal(await isSupported(lacking("X25519")), false);
  assert.equal(await isSupported(lacking("AES-GCM")), false);
  assert.equal(await isSupported(undefined), true, "the default is this runtime's subtle");
  const e = await expectKeyError("unavailable", () => assertSupported(lacking("X25519")));
  assert.equal(e.message, UNSUPPORTED_MESSAGE);
  assert.match(UNSUPPORTED_MESSAGE, /can't protect your keys.*Update/);
});
