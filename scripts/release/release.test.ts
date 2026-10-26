import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "./cli.ts";
import { EXTENSION_ZIP, SERVER_FILES, imagesLock, packExtension, packFolder, packServer, releasesFrom, sha256File, tarList, zipNames, zipRead } from "./pack.ts";
import { smokeRelease } from "./smoke.ts";
import { CHANNEL_KINDS, buildEntries, manifestFor, readFeed } from "./channels.ts";
import type { ChannelRelease, FeedEntry } from "./channels.ts";
import { assetsFor, feedBase } from "./feed.ts";
import { lineage, newestStable, nextPatchTag } from "./lineage.ts";
import { SIGNATURE_PREFIX, keyId, publicKeyBytes, publicKeyHexOf, signManifest, verifyManifest } from "./sign.ts";
import { bump, channelOfVersion, releaseCounter, tagVersion, versionProblems } from "./version.ts";

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

test("release assets carry the names the installer and the updater read, and the .sig verifies the manifest file byte for byte", () => {
  const k = keys();
  const entries = buildEntries({ channel: "stable", releases: { server: rel("1.2.0"), kits: rel("3.0.0", "kits.tgz") }, privateKeyPem: k.pem, pinnedPublicKey: k.pub });
  const files = entries.flatMap(assetsFor);
  assert.deepEqual(files.map((f) => f.name), ["stable.json", "stable.json.sig", "stable-kits.json", "stable-kits.json.sig"]);
  const manifest = files.find((f) => f.name === "stable.json")?.content ?? "";
  const sig = files.find((f) => f.name === "stable.json.sig")?.content ?? "";
  assert.equal(verifyManifest(manifest, sig, k.pub), true);
  assert.equal((JSON.parse(manifest) as { server: { tarball: string } }).server.tarball, "vyre.tgz", "relative to the feed base, as the installer expects");
  assert.equal(feedBase("stable"), "https://github.com/vyre-ai/vyre-v1/releases/latest/download/");
  assert.equal(feedBase("beta"), "https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/");
});

test("the command line: counter, pubkey, sign and assets work end to end in a directory, and a missing key or a bad channel is refused", () => {
  const k = keys();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-"));
  const log = console.log, err = console.error;
  const out: string[] = [];
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  console.error = () => undefined;
  const saved = process.env["VYRE_SIGNING_KEY"];
  try {
    assert.equal(main(["counter", "0.3.0"]), 0);
    assert.equal(out.at(-1), "300099");
    assert.equal(main(["counter", "nope"]), 1);
    assert.equal(main(["nothing"]), 2);
    delete process.env["VYRE_SIGNING_KEY"];
    assert.equal(main(["pubkey"]), 2, "no key outside the release environment");
    process.env["VYRE_SIGNING_KEY"] = k.pem;
    assert.equal(main(["pubkey", path.join(dir, "key.json")]), 0);
    assert.equal((JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8")) as { publicKey: string }).publicKey, k.pub);
    fs.writeFileSync(path.join(dir, "releases.json"), JSON.stringify({ server: rel("1.2.0") }));
    assert.equal(main(["sign", dir, "nightly-x", k.pub]), 2);
    assert.equal(main(["sign", dir, "stable", k.pub]), 0);
    assert.equal(main(["assets", dir]), 0);
    const manifest = fs.readFileSync(path.join(dir, "stable.json"), "utf8");
    assert.equal(verifyManifest(manifest, fs.readFileSync(path.join(dir, "stable.json.sig"), "utf8"), k.pub), true);
    assert.equal(main(["sign", dir, "stable", keys().pub]), 1, "a key that is not the pinned one signs nothing");
  } finally {
    console.log = log; console.error = err;
    if (saved === undefined) delete process.env["VYRE_SIGNING_KEY"]; else process.env["VYRE_SIGNING_KEY"] = saved;
  }
});

const DIGEST = `ghcr.io/vyre-ai/vyred@sha256:${"b".repeat(64)}`;

/** A repository with just the files a server release is made from. */
function fakeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-"));
  const put = (f: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
  put("images/vyred/compose.server.yml", "services: {}\n");
  put("images/vyred/Caddyfile", ":80\n");
  put("scripts/install/linux/vyre-server", "#!/bin/sh\n");
  for (const u of ["vyre-server.service", "vyre-server-update.service", "vyre-server-update.timer"]) put(`scripts/install/linux/units/${u}`, "[Unit]\n");
  put("apps/chrome/manifest.json", JSON.stringify({ manifest_version: 3, name: "Vyre", version: "1.4.0" }));
  put("apps/chrome/package.json", "{}");
  put("apps/chrome/src/content/fill.js", "console.log('fill');\n".repeat(50));
  put("apps/chrome/tests/ext.test.ts", "test");
  put("kits/default/kit.json", "{}");
  return root;
}

test("release tags: the version a tag names must be a release version, and a prerelease goes to beta", () => {
  assert.equal(tagVersion("v1.2.3"), "1.2.3");
  assert.equal(tagVersion("refs/tags/v1.2.3-rc.1"), "1.2.3-rc.1");
  for (const bad of ["1.2.3", "v1.2", "v1.2.3-dryrun.1", "latest"]) assert.equal(tagVersion(bad), null, bad);
  assert.equal(channelOfVersion("1.2.3"), "stable");
  assert.equal(channelOfVersion("1.2.3-rc.1"), "beta");
  assert.equal(channelOfVersion("1.2.3-beta.2"), "beta");
});

test("images.lock pins every image by digest and the server image is required", () => {
  assert.equal(imagesLock({ VYRE_IMAGE: DIGEST }), `VYRE_IMAGE=${DIGEST}\n`);
  assert.throws(() => imagesLock({}), /VYRE_IMAGE/);
  assert.throws(() => imagesLock({ VYRE_IMAGE: "ghcr.io/vyre-ai/vyred:latest" }), /digest/);
  assert.throws(() => imagesLock({ VYRE_IMAGE: DIGEST, VYRE_AGENT_IMAGE: "agent:1" }), /VYRE_AGENT_IMAGE/);
});

test("the server tarball holds every file the installer insists on, under one folder, with the version and the pinned images", () => {
  const root = fakeRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"));
  const r = packServer({ root, outDir: out, version: "1.4.0", images: { VYRE_IMAGE: DIGEST } });
  const names = tarList(r.file);
  for (const f of SERVER_FILES) assert.ok(names.includes(`vyre-1.4.0/${f}`), f);
  assert.ok(names.every((n) => n.startsWith("vyre-1.4.0/")), "one top folder");
  assert.equal(r.sha256, sha256File(r.file));
  assert.deepEqual(fs.readdirSync(out), ["vyre.tgz"], "the staging folder is gone");
  assert.throws(() => packServer({ root, outDir: out, version: "not-a-version", images: { VYRE_IMAGE: DIGEST } }));
});

test("the Chrome extension zip carries the extension without its tests or package.json, and every file reads back intact", () => {
  const root = fakeRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"));
  const r = packExtension({ dir: path.join(root, "apps/chrome"), outFile: path.join(out, EXTENSION_ZIP) });
  assert.equal(r.version, "1.4.0");
  const zip = fs.readFileSync(r.file);
  assert.deepEqual(zipNames(zip), ["manifest.json", "src/content/fill.js"]);
  assert.equal(zipRead(zip, "src/content/fill.js")?.toString(), "console.log('fill');\n".repeat(50));
  assert.equal(JSON.parse(zipRead(zip, "manifest.json")?.toString() ?? "{}").version, "1.4.0");
  assert.equal(zipRead(zip, "package.json"), null);
});

test("releases.json lists only the channels whose artifact is there, each with its hash", () => {
  const root = fakeRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"));
  packServer({ root, outDir: out, version: "1.4.0", images: { VYRE_IMAGE: DIGEST } });
  packExtension({ dir: path.join(root, "apps/chrome"), outFile: path.join(out, EXTENSION_ZIP) });
  const r = releasesFrom({ version: "1.4.0", dir: out });
  assert.deepEqual(Object.keys(r).sort(), ["extension", "server"], "no app and no kits artifact, so no entry for them");
  assert.equal(r.server?.sha256, sha256File(path.join(out, "vyre.tgz")));
  assert.equal(r.server?.tarball, "vyre.tgz");
  packFolder({ dir: path.join(root, "kits"), outFile: path.join(out, "vyre-kits.tgz"), topName: "kits" });
  assert.deepEqual(Object.keys(releasesFrom({ version: "1.4.0", dir: out })).sort(), ["extension", "kits", "server"]);
});

function published(k: { pem: string; pub: string }, version: string) {
  const root = fakeRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), "out-"));
  packServer({ root, outDir: out, version, images: { VYRE_IMAGE: DIGEST } });
  const entries = buildEntries({ channel: "stable", releases: releasesFrom({ version, dir: out }), privateKeyPem: k.pem, pinnedPublicKey: k.pub });
  const files = new Map<string, Buffer>([["vyre.tgz", fs.readFileSync(path.join(out, "vyre.tgz"))]]);
  for (const f of entries.flatMap(assetsFor)) files.set(f.name, Buffer.from(f.content));
  const fetch = async (url: string) => {
    const f = files.get(url.split("/").at(-1) ?? "");
    return { status: f ? 200 : 404, arrayBuffer: async () => (f ?? Buffer.alloc(0)).buffer.slice((f ?? Buffer.alloc(0)).byteOffset, (f ?? Buffer.alloc(0)).byteOffset + (f ?? Buffer.alloc(0)).byteLength) as ArrayBuffer };
  };
  return { files, fetch };
}

test("the post-publish smoke passes on a good release and names the step that fails on a bad one", async () => {
  const k = keys();
  const good = published(k, "1.4.0");
  const ok = await smokeRelease({ base: "https://example.test/dl/", channel: "stable", publicKeyHex: k.pub, version: "1.4.0", fetch: good.fetch });
  assert.equal(ok.ok, true, JSON.stringify(ok.steps));
  assert.ok(ok.steps.every((s) => s.ok));

  const wrongKey = await smokeRelease({ base: "https://example.test/dl/", channel: "stable", publicKeyHex: keys().pub, version: "1.4.0", fetch: good.fetch });
  assert.equal(wrongKey.ok, false);
  assert.equal(wrongKey.steps.at(-1)?.step, "signature verifies with the compiled-in key");

  const wrongVersion = await smokeRelease({ base: "https://example.test/dl/", channel: "stable", publicKeyHex: k.pub, version: "1.5.0", fetch: good.fetch });
  assert.equal(wrongVersion.steps.at(-1)?.step, "manifest names this version on this channel");

  const tampered = published(k, "1.4.0");
  tampered.files.set("vyre.tgz", Buffer.concat([tampered.files.get("vyre.tgz") ?? Buffer.alloc(0), Buffer.from("x")]));
  const bad = await smokeRelease({ base: "https://example.test/dl/", channel: "stable", publicKeyHex: k.pub, version: "1.4.0", fetch: tampered.fetch });
  assert.equal(bad.steps.at(-1)?.step, "tarball matches the signed sha256");

  const missing = published(k, "1.4.0");
  missing.files.delete("stable.json.sig");
  assert.equal((await smokeRelease({ base: "https://example.test/dl/", channel: "stable", publicKeyHex: k.pub, version: "1.4.0", fetch: missing.fetch })).steps.at(-1)?.step, "signature is published");
});

test("the command line: tag checks the version against package.json, and pack makes the artifacts and releases.json", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"));
  const log = console.log, err = console.error;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  console.error = () => undefined;
  const saved = process.env["VYRE_IMAGE"];
  try {
    assert.equal(main(["tag", "v1.2.3-dryrun.1"]), 1);
    assert.equal(main(["tag", "v9.9.9"]), 1, "package.json does not say 9.9.9");
    assert.equal(main(["pack"]), 2);
    process.env["VYRE_IMAGE"] = DIGEST;
    assert.equal(main(["pack", out, "0.0.1"]), 0);
    assert.ok(fs.existsSync(path.join(out, "vyre.tgz")) && fs.existsSync(path.join(out, EXTENSION_ZIP)) && fs.existsSync(path.join(out, "vyre-kits.tgz")));
    const rel = JSON.parse(fs.readFileSync(path.join(out, "releases.json"), "utf8")) as Record<string, { version: string }>;
    assert.deepEqual(Object.keys(rel).sort(), ["extension", "kits", "server"]);
  } finally {
    console.log = log; console.error = err;
    if (saved === undefined) delete process.env["VYRE_IMAGE"]; else process.env["VYRE_IMAGE"] = saved;
  }
});
