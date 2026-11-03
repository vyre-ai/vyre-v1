// Personal memory sealing (kernel/src/seal/person-memory.ts; owner ruling 3 Nov 2026): both forms open only with the person key, are bound to their context, and a public-key write needs no private key.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PersonMemoryKey, memoryKeyTag, memorySealForm, memorySealTag, sealToMemoryKey } from "../src/seal/index.ts";

const AAD = "vyre:memory:v1|usr_dana";

test("the own form and the public form open with the person key, and only with it", () => {
  const pk = crypto.randomBytes(32);
  const k = PersonMemoryKey.from(pk);
  const own = k.seal("Dana takes her coffee black", AAD);
  const pub = sealToMemoryKey(k.pub, "Dana is allergic to cashews", AAD);
  assert.equal(memorySealForm(own), "own");
  assert.equal(memorySealForm(pub), "public");
  assert.equal(memorySealForm('{"keyId":"k1/mem.usr_dana"}'), null);
  assert.equal(memorySealTag(own), k.tag);
  assert.equal(memorySealTag(pub), memoryKeyTag(k.pub));
  assert.equal(k.open(own, AAD), "Dana takes her coffee black");
  assert.equal(k.open(pub, AAD), "Dana is allergic to cashews");
  // the same person key on another node makes the same pair
  assert.equal(PersonMemoryKey.from(Uint8Array.from(pk)).open(own, AAD), "Dana takes her coffee black");
  // another key, another person's context, a changed byte: all refused
  const other = PersonMemoryKey.from(crypto.randomBytes(32));
  assert.throws(() => other.open(own, AAD));
  assert.throws(() => other.open(pub, AAD));
  assert.throws(() => k.open(own, "vyre:memory:v1|usr_omar"));
  assert.throws(() => k.open(pub, "vyre:memory:v1|usr_omar"));
  const parts = own.split(".");
  parts[4] = Buffer.from(Buffer.from(parts[4]!, "base64url").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64url");
  assert.throws(() => k.open(parts.join("."), AAD));
});

test("the public half alone cannot open what was sealed to it; a wiped key opens nothing; no key leaves through JSON", () => {
  const k = PersonMemoryKey.from(crypto.randomBytes(32));
  const pub = sealToMemoryKey(k.pub, "words", AAD);
  assert.throws(() => PersonMemoryKey.from(Buffer.from(k.pub, "base64url")).open(pub, AAD));
  assert.equal(Buffer.from(k.pub, "base64url").length, 32);
  assert.deepEqual(JSON.parse(JSON.stringify(k)), { tag: k.tag });
  k.wipe();
  assert.throws(() => k.open(pub, AAD));
  assert.throws(() => k.seal("x", AAD));
  assert.throws(() => sealToMemoryKey("not-a-key", "x", AAD));
});
