import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHANNEL_KINDS, buildEntries, manifestFor, readFeed } from "./channels.ts";
import type { ChannelRelease, FeedEntry } from "./channels.ts";
import { lineage, newestStable, nextPatchTag } from "./lineage.ts";
import { SIGNATURE_PREFIX, keyId, publicKeyBytes, publicKeyHexOf, signManifest, verifyManifest } from "./sign.ts";
import { bump, releaseCounter, versionProblems } from "./version.ts";

const keys = (): { pem: string; pub: string } => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), pub: Buffer.from(publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex") };
};
const rel = (version: string, tarball = "vyre.tgz"): ChannelRelease => ({ version, tarball, sha256: "a".repeat(64) });

test("the release counter orders exactly as semver does: beta below rc below the release, patch above minor", () => {
  const order = ["0.2.9", "0.3.0-beta.1", "0.3.0-beta.39", "0.3.0-rc.1", "0.3.0-rc.2", "0.3.0", "0.3.1", "1.0.0-rc.1", "1.0.0"].map(releaseCounter);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(releaseCounter("v0.3.0-rc.2"), releaseCounter("0.3.0-rc.2"));
  assert.equal(releaseCounter("0.3.0-rc.2"), 300042);
  assert.equal(releaseCounter("0.3.0"), 300099);
  for (const bad of ["1.2", "1.2.3-alpha.1", "1.2.3-rc.0", "1.2.3-rc.40", "1000.0.0", ""]) assert.throws(() => releaseCounter(bad), bad);
});

test("bump moves every version file together, keeps formatting, and refuses a non-version", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bump-"));
  fs.writeFileSync(path.join(dir, "a.json"), '{\n    "name": "a",\n    "version": "0.1.0"\n}\n');
  fs.writeFileSync(path.join(dir, "b.json"), '{\n  "version": "0.0.1"\n}');
  assert.equal(versionProblems(dir, ["a.json", "b.json"]).length, 1);
  assert.deepEqual(bump(dir, "0.2.0-rc.1", ["a.json", "b.json"]), { from: "0.1.0", to: "0.2.0-rc.1" });
  assert.equal(fs.readFileSync(path.join(dir, "a.json"), "utf8"), '{\n    "name": "a",\n    "version": "0.2.0-rc.1"\n}\n');
  assert.equal(fs.readFileSync(path.join(dir, "b.json"), "utf8"), '{\n  "version": "0.2.0-rc.1"\n}');
  assert.deepEqual(versionProblems(dir, ["a.json", "b.json"]), []);
  assert.throws(() => bump(dir, "v2", ["a.json"]));
});

test("a bad lineage is refused with every reason; a proper next patch on its hotfix branch passes", () => {
  assert.equal(nextPatchTag("v0.2.1"), "v0.2.2");
  assert.equal(nextPatchTag("v0.2.1-rc.1"), null);
  assert.equal(newestStable(["v0.2.0", "v0.10.0", "v0.9.9", "v1.0.0-rc.1"]), "v0.10.0");
  assert.deepEqual(lineage({ tag: "v0.2.2", prev: "v0.2.1", prevIsAncestor: true, onHotfixBranch: true }), []);
  assert.deepEqual(lineage({ tag: "v0.2.2", prev: null, prevIsAncestor: false, onHotfixBranch: true }), ["there is no published stable release for this commit to descend from"]);
  const bad = lineage({ tag: "v0.2.4", prev: "v0.2.1", prevIsAncestor: false, onHotfixBranch: false });
  assert.equal(bad.length, 3);
  assert.match(bad.join("\n"), /not an ancestor/);
  assert.match(bad.join("\n"), /not the next patch after v0.2.1 \(v0.2.2\)/);
  assert.match(bad.join("\n"), /origin\/hotfix\/v0.2.4/);
});

test("the signature verifies with the public key, in the way the server verifies it, and with nothing else", async () => {
  const k = keys();
  const manifest = manifestFor("server", "stable", rel("1.0.0"));
  const sig = signManifest(manifest, k.pem, k.pub);
  assert.equal(Buffer.from(sig, "base64").length, 64);
  assert.equal(verifyManifest(manifest, sig, k.pub), true);
  // The server's check (modules/updates/handlers/channels.ts verifySignature): WebCrypto, raw key, prefix + manifest text.
  const key = await globalThis.crypto.subtle.importKey("raw", publicKeyBytes(k.pub), { name: "Ed25519" }, false, ["verify"]);
  assert.equal(await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(sig, "base64"), new TextEncoder().encode(SIGNATURE_PREFIX + manifest)), true);
  assert.equal(verifyManifest(manifest + " ", sig, k.pub), false, "a changed manifest");
  assert.equal(verifyManifest(manifest, sig, keys().pub), false, "another key");
  assert.equal(verifyManifest(manifest, "AAAA", k.pub), false, "a short signature");
});

test("a key that is not the pinned release key signs nothing, and a missing key says where the key lives", () => {
  const real = keys(), other = keys();
  assert.throws(() => signManifest("{}", other.pem, real.pub), /not the pinned release key/);
  assert.throws(() => signManifest("{}", "", real.pub), /VYRE_SIGNING_KEY/);
});

test("each channel has its own entry; a release may leave channels out, and staggered versions are accepted", () => {
  const k = keys();
  const entries = buildEntries({ channel: "stable", releases: { server: rel("1.2.0"), extension: rel("0.9.4", "ext.zip") }, privateKeyPem: k.pem, pinnedPublicKey: k.pub });
  assert.deepEqual(entries.map((e) => e.kind), ["server", "extension"], "app and kits have no entry: they are left where they were");
  const r = readFeed(entries, { pinnedPublicKey: k.pub, running: { server: releaseCounter("1.1.0"), app: releaseCounter("1.0.0") } });
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.accepted.map((a) => `${a.kind}@${a.version}`), ["server@1.2.0", "extension@0.9.4"]);
  assert.deepEqual([...CHANNEL_KINDS], ["app", "server", "kits", "extension"]);
});

test("one bad entry is refused alone; the others in the same feed are still read", () => {
  const k = keys();
  const good = buildEntries({ channel: "stable", releases: { app: rel("2.0.0"), server: rel("1.2.0"), kits: rel("1.2.1") }, privateKeyPem: k.pem, pinnedPublicKey: k.pub });
  const tampered: FeedEntry[] = good.map((e) => (e.kind === "server" ? { ...e, manifest: e.manifest.replace("1.2.0", "9.9.9") } : e));
  const r = readFeed(tampered, { pinnedPublicKey: k.pub });
  assert.deepEqual(r.refused, [{ kind: "server", reason: "bad signature" }]);
  assert.deepEqual(r.accepted.map((a) => a.kind), ["app", "kits"]);
});

test("an entry older than what runs is refused (no rollback), and an entry whose counter was edited is refused", () => {
  const k = keys();
  const [old] = buildEntries({ channel: "stable", releases: { server: rel("1.0.0") }, privateKeyPem: k.pem, pinnedPublicKey: k.pub });
  assert.ok(old);
  assert.deepEqual(readFeed([old], { pinnedPublicKey: k.pub, running: { server: releaseCounter("1.1.0") } }).refused, [{ kind: "server", reason: "older than what is running" }]);
  assert.deepEqual(readFeed([{ ...old, counter: releaseCounter("9.0.0") }], { pinnedPublicKey: k.pub }).refused, [{ kind: "server", reason: "counter does not match the version" }]);
});

test("the server channel entry is the manifest the server reads; artifact names and hashes are checked", () => {
  const doc = JSON.parse(manifestFor("server", "beta", { ...rel("1.0.0-rc.1"), notes: "n", security: true }, { mac: "1.0.0" })) as Record<string, unknown>;
  assert.deepEqual(doc, { v: 1, channel: "beta", server: { version: "1.0.0-rc.1", tarball: "vyre.tgz", sha256: "a".repeat(64), notes: "n", security: true }, apps: { mac: "1.0.0" } });
  assert.throws(() => manifestFor("server", "stable", { ...rel("1.0.0"), tarball: "../x" }));
  assert.throws(() => manifestFor("server", "stable", { ...rel("1.0.0"), sha256: "xyz" }));
});

test("the public half derived from the signing key is the one that verifies, and the key id is stable and short", () => {
  const k = keys();
  assert.equal(publicKeyHexOf(k.pem), k.pub);
  assert.match(keyId(k.pub), /^[0-9a-f]{16}$/);
  assert.equal(keyId(k.pub), keyId(k.pub));
  assert.notEqual(keyId(keys().pub), keyId(k.pub));
  assert.ok(!publicKeyHexOf(k.pem).includes("PRIVATE"));
});
