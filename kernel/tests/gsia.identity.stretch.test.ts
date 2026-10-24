// ported from vyre 0.6.9 kernel/identity/stretch.test.js; the pure JS fallback and its vectors are not carried over
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { argon2id, STRETCH, STRETCH_SALT } from "../src/identity/stretch.ts";

// Vectors made by Node's native Argon2id (24.15) with the salt below, one lane. The pure JS must give the same bytes on every Node.
const VECTORS = [
  { memoryKiB: 8, passes: 1, secret: "a", tag: "9e479e4512a05da9" },
  { memoryKiB: 64, passes: 2, secret: "vyre test secret", tag: "2135d5e12c4cfc27" },
  { memoryKiB: 256, passes: 3, secret: "x".repeat(200), tag: "4c1a8780a71e64f4" },
];

test("stretch: the parameters are the stated ones", () => {
  assert.deepEqual({ ...STRETCH }, { memoryKiB: 19456, passes: 2, lanes: 1, tagLength: 32 });
  assert.equal(STRETCH_SALT, "vyre-recovery-code-v1");
});

test("stretch: the pure Argon2id matches the native vectors, and the native one when there is one", () => {
  for (const v of VECTORS) {
    const pure = argon2id(v.secret, STRETCH_SALT, { memoryKiB: v.memoryKiB, passes: v.passes });
    assert.equal(pure.length, 32);
    assert.ok(pure.toString("hex").startsWith(v.tag), `${v.memoryKiB} KiB, ${v.passes} passes`);
    assert.equal(argon2id(v.secret, STRETCH_SALT, { memoryKiB: v.memoryKiB, passes: v.passes }).toString("hex"), pure.toString("hex"));
  }
});

test("stretch: the full-size parameters give the pinned answer (native Argon2id)", () => {
  const a = argon2id("code\npassword", STRETCH_SALT, STRETCH).toString("hex");
  assert.equal(a.slice(0, 16), "6a8a30625a4eb5d7");
});

test("stretch: the secret and the salt both change the key", () => {
  const p = { memoryKiB: 64, passes: 1 };
  assert.notEqual(argon2id("a", "salt-one-xx", p).toString("hex"), argon2id("b", "salt-one-xx", p).toString("hex"));
  assert.notEqual(argon2id("a", "salt-one-xx", p).toString("hex"), argon2id("a", "salt-two-xx", p).toString("hex"));
});

// The verifier and the stretch are the root of trust for devices, spaces and recovery: they import nothing but node:crypto (boundary B3), and the ported files are pinned by a review, not by a hash of the 0.6 bytes.
test("identity chain and stretch import nothing but node:crypto", () => {
  for (const file of ["chain.ts", "stretch.ts"]) {
    const text = fs.readFileSync(new URL(`../src/identity/${file}`, import.meta.url), "utf8");
    const imports = [...text.matchAll(/^\s*import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    assert.ok(imports.every((i) => i === "node:crypto"), `${file} imports ${imports.join(", ")}`);
  }
});
