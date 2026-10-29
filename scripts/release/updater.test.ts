import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UPDATE_ARTIFACTS, blake2b512, checkDesktopArtifacts, desktopFeed, digestLine, keyIdBytes, minisignPublicKey, minisignPublicKeyBase64, minisignSign, minisignVerify, readDigests, signDesktop, signatureAsset } from "./updater.ts";
import { publicKeyBytes, publicKeyHexOf } from "./sign.ts";
import { feedBase } from "./feed.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const pair = (): { pem: string; pub: Uint8Array } => {
  const pem = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { pem, pub: publicKeyBytes(publicKeyHexOf(pem)) };
};
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-updater-"));

test("a minisign signature is the shape Tauri's verifier reads, and verifies only for the file it was made from", () => {
  const { pem, pub } = pair();
  const file = Buffer.from("the update bundle");
  const digestHex = blake2b512(file).toString("hex");
  const text = minisignSign({ digestHex, fileName: "Vyre.app.tar.gz", privateKeyPem: pem, pinnedPublicKey: pub, seconds: 1_761_800_000 });
  const lines = text.split("\n");
  assert.equal(lines.length, 5, "comment, signature, trusted comment, global signature, and the final newline");
  assert.match(lines[0]!, /^untrusted comment: /);
  assert.match(lines[2]!, /^trusted comment: timestamp:1761800000\tfile:Vyre\.app\.tar\.gz$/);
  const body = Buffer.from(lines[1]!, "base64");
  assert.equal(body.length, 74);
  assert.equal(body.subarray(0, 2).toString(), "ED", "prehashed: the digest is what is signed");
  assert.ok(body.subarray(2, 10).equals(keyIdBytes(pub)));
  assert.equal(Buffer.from(lines[3]!, "base64").length, 64);
  assert.equal(minisignVerify({ digestHex, signatureText: text, publicKey: pub }), true);
  assert.equal(minisignVerify({ digestHex: blake2b512(Buffer.from("another file")).toString("hex"), signatureText: text, publicKey: pub }), false, "another file");
  assert.equal(minisignVerify({ digestHex, signatureText: text.replace("file:Vyre", "file:Evil"), publicKey: pub }), false, "a changed trusted comment");
  assert.equal(minisignVerify({ digestHex, signatureText: text, publicKey: pair().pub }), false, "another key");
  const pk = minisignPublicKey(pub).split("\n");
  assert.match(pk[0]!, /^untrusted comment: minisign public key: [0-9A-F]{16}$/);
  const raw = Buffer.from(pk[1]!, "base64");
  assert.deepEqual([raw.subarray(0, 2).toString(), raw.length], ["Ed", 42]);
  assert.equal(Buffer.from(minisignPublicKeyBase64(pub), "base64").toString(), minisignPublicKey(pub));
});

test("only the pinned release key signs: any other key is refused and nothing is written", () => {
  const a = pair(), b = pair();
  const digestHex = blake2b512(Buffer.from("x")).toString("hex");
  assert.throws(() => minisignSign({ digestHex, fileName: "x", privateKeyPem: a.pem, pinnedPublicKey: b.pub, seconds: 1 }), /not the pinned release key/);
  assert.throws(() => minisignSign({ digestHex: "abc", fileName: "x", privateKeyPem: a.pem, pinnedPublicKey: a.pub, seconds: 1 }), /128 hex/);
});

test("the committed fixture (made once with a throwaway key, checked by Tauri's own verifier in the Rust tests) still verifies here", () => {
  const dir = path.join(repo, "apps/desktop/src-tauri/fixtures/updater");
  const pubText = fs.readFileSync(path.join(dir, "key.pub"), "utf8");
  const sigText = fs.readFileSync(path.join(dir, "bundle.minisig"), "utf8");
  const data = fs.readFileSync(path.join(dir, "bundle.bin"));
  const raw = Buffer.from(pubText.split("\n")[1]!, "base64").subarray(10);
  assert.equal(minisignVerify({ digestHex: blake2b512(data).toString("hex"), signatureText: sigText, publicKey: raw }), true);
  assert.equal(minisignPublicKey(raw), pubText, "the public key file is the one this code writes");
});

test("the app's pinned updater key is the release key the servers trust, so rotating one without the other fails here", () => {
  const conf = JSON.parse(fs.readFileSync(path.join(repo, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")) as { plugins: { updater: { pubkey: string; endpoints: string[] } } };
  const hex = /RELEASE_PUBLIC_KEY_HEX = "([0-9a-f]{64})"/.exec(fs.readFileSync(path.join(repo, "host/src/seams/updates.ts"), "utf8"))![1]!;
  assert.equal(conf.plugins.updater.pubkey, minisignPublicKeyBase64(publicKeyBytes(hex)));
  assert.deepEqual(conf.plugins.updater.endpoints, [`${feedBase("stable")}desktop-stable.json`]);
});

test("the sign job writes a signature per digest and the feed Tauri reads, and the publish job refuses an artifact that is not the one signed", () => {
  const { pem, pub } = pair();
  const dist = tmp(), artifacts = tmp();
  const files: Record<string, string> = { "Vyre.app.tar.gz": "mac bundle", "VyreSetup.exe": "windows installer" };
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(artifacts, name), text);
    fs.writeFileSync(path.join(dist, `${name}.b2`), digestLine(path.join(artifacts, name)));
  }
  assert.deepEqual(Object.keys(readDigests(dist)).sort(), ["Vyre.app.tar.gz", "VyreSetup.exe"]);
  const written = signDesktop({ dir: dist, version: "1.0.0-rc.4", channel: "beta", tag: "v1.0.0-rc.4", repo: "vyre-ai/vyre-v1", privateKeyPem: pem, pinnedPublicKey: pub, now: () => new Date("2026-10-30T01:02:03Z") });
  assert.deepEqual(written.sort(), ["Vyre.app.tar.gz.sig", "VyreSetup.exe.sig", "desktop-beta.json"]);
  const feed = JSON.parse(fs.readFileSync(path.join(dist, "desktop-beta.json"), "utf8")) as { version: string; pub_date: string; platforms: Record<string, { url: string; signature: string }> };
  assert.equal(feed.version, "1.0.0-rc.4");
  assert.equal(feed.pub_date, "2026-10-30T01:02:03.000Z");
  assert.deepEqual(Object.keys(feed.platforms).sort(), ["darwin-aarch64", "windows-x86_64"]);
  assert.equal(feed.platforms["darwin-aarch64"]!.url, "https://github.com/vyre-ai/vyre-v1/releases/download/v1.0.0-rc.4/Vyre.app.tar.gz");
  for (const [name, platform] of Object.entries(UPDATE_ARTIFACTS)) {
    const entry = feed.platforms[platform]!;
    assert.equal(fs.readFileSync(path.join(dist, `${name}.sig`), "utf8"), `${entry.signature}\n`, ".sig asset and feed carry the same line");
    assert.equal(minisignVerify({ digestHex: blake2b512(Buffer.from(files[name]!)).toString("hex"), signatureText: Buffer.from(entry.signature, "base64").toString(), publicKey: pub }), true, name);
  }
  assert.deepEqual(checkDesktopArtifacts(dist, artifacts).sort(), ["Vyre.app.tar.gz", "VyreSetup.exe"]);
  fs.writeFileSync(path.join(artifacts, "VyreSetup.exe"), "windows installer, changed");
  assert.throws(() => checkDesktopArtifacts(dist, artifacts), /not the file that was signed/);
  fs.rmSync(path.join(artifacts, "Vyre.app.tar.gz"));
  assert.throws(() => checkDesktopArtifacts(dist, artifacts), /not there to attach|not the file/);
});

test("nothing unexplained is signed: an unknown or malformed digest, no digest and a wrong key all stop the sign job", () => {
  const { pem, pub } = pair();
  const dist = tmp();
  const sign = (): string[] => signDesktop({ dir: dist, version: "1.0.0", channel: "stable", tag: "v1.0.0", repo: "r/r", privateKeyPem: pem, pinnedPublicKey: pub, now: () => new Date(0) });
  assert.throws(sign, /no update digests/);
  fs.writeFileSync(path.join(dist, "Evil.exe.b2"), `${"0".repeat(128)}  Evil.exe\n`);
  assert.throws(sign, /not a known update artifact/);
  fs.rmSync(path.join(dist, "Evil.exe.b2"));
  fs.writeFileSync(path.join(dist, "VyreSetup.exe.b2"), `${"0".repeat(128)}  Other.exe\n`);
  assert.throws(sign, /malformed/);
  fs.writeFileSync(path.join(dist, "VyreSetup.exe.b2"), `${"0".repeat(128)}  VyreSetup.exe\n`);
  assert.throws(() => signDesktop({ dir: dist, version: "1.0.0", channel: "stable", tag: "v1.0.0", repo: "r/r", privateKeyPem: pem, pinnedPublicKey: pair().pub, now: () => new Date(0) }), /not the pinned release key/);
  assert.deepEqual(fs.readdirSync(dist), ["VyreSetup.exe.b2"], "nothing was written");
  assert.throws(() => desktopFeed({ version: "1", channel: "stable", notes: "", pubDate: "", platforms: {} }), /at least one platform/);
  assert.equal(signatureAsset("a\nb\n"), Buffer.from("a\nb\n").toString("base64"));
});
