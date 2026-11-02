// The installers and vyre-server check every release against a pinned Ed25519 public key. rc.14 shipped installers that still pinned the 0.6 key, so a fresh install refused the
// v1 release. Each pinned PEM must be the key the host compiles in (RELEASE_PUBLIC_KEY_HEX): the raw key is the last 32 bytes of the SPKI DER.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RELEASE_PUBLIC_KEY_HEX } from "../../host/src/seams/updates.ts";

const repo = path.resolve(import.meta.dirname, "../..");
// SPKI header for an Ed25519 key: SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING (33 bytes, 0 unused bits) }
const ED25519_SPKI_PREFIX = "302a300506032b6570032100";

for (const file of ["scripts/install/linux/install.sh", "scripts/install/linux/vyre-server", "scripts/install/macos/install.sh"]) {
  test(`${file} pins the v1 release key`, () => {
    const text = fs.readFileSync(path.join(repo, file), "utf8");
    const pems = [...text.matchAll(/-----BEGIN PUBLIC KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PUBLIC KEY-----/g)];
    assert.equal(pems.length, 1, "exactly one pinned public key");
    const der = Buffer.from(pems[0]![1]!.replace(/\s+/g, ""), "base64");
    assert.equal(der.length, 44, "an Ed25519 SPKI key is 44 bytes");
    assert.equal(der.subarray(0, 12).toString("hex"), ED25519_SPKI_PREFIX, "the key is Ed25519");
    assert.equal(der.subarray(der.length - 32).toString("hex"), RELEASE_PUBLIC_KEY_HEX, "the pinned key is RELEASE_PUBLIC_KEY_HEX in host/src/seams/updates.ts");
  });
}
