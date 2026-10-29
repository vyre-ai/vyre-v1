// The desktop app's own updates (V1-SPEC 3.13 Install, ARCH 7.13): Tauri's updater reads a JSON feed, downloads the artifact it names and checks a minisign signature over it before it installs anything.
// That signature is made here with the Vyre release key, the one key the servers already trust, in the isolated `sign` job; so the desktop adds no secret and no second trust root.
//
//   The build (desktop.yml) writes "<128 hex>  <name>" next to each update artifact: the BLAKE2b-512 digest minisign signs ("prehashed" ED signatures), not the 100 MB file. Only that line travels through sign.
//   `sign` turns each digest into a minisign signature and writes desktop-<channel>.json in Tauri's static format. `publish` attaches the artifacts after checking them against the same digests.
//   The app (src-tauri/src/updater.rs) reads desktop-stable.json from the newest release, or desktop-beta.json from the rolling `channel-beta` release when it is itself a prerelease build.
//
// minisign signature file: "untrusted comment: ..." / base64("ED" + key id (8) + Ed25519(BLAKE2b-512(file))) / "trusted comment: ..." / base64(Ed25519(signature + trusted comment)).
// Tauri wants the whole file as one base64 line, both for the public key in tauri.conf.json and for the signature in the feed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { publicKeyBytes, publicKeyHexOf } from "./sign.ts";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** What each update artifact is called on the release and which platform of Tauri's feed it serves. The Mac build is Apple silicon (the hosted runner), the Windows one is x64. */
export const UPDATE_ARTIFACTS: Readonly<Record<string, string>> = { "Vyre.app.tar.gz": "darwin-aarch64", "VyreSetup.exe": "windows-x86_64" };

export const blake2b512 = (data: Uint8Array): Buffer => crypto.createHash("blake2b512").update(data).digest();

/** The digest line the build writes beside an artifact. */
export function digestLine(file: string): string {
  return `${blake2b512(fs.readFileSync(file)).toString("hex")}  ${path.basename(file)}\n`;
}

/** minisign's key id for a public key: eight bytes. minisign makes them random; ours come from the key itself, so the same key always has the same id. */
export function keyIdBytes(publicKey: Uint8Array): Buffer {
  return crypto.createHash("sha256").update(publicKey).digest().subarray(0, 8);
}
const idHex = (id: Buffer): string => Buffer.from(id).reverse().toString("hex").toUpperCase();

/** The minisign public key file for a raw Ed25519 key. */
export function minisignPublicKey(publicKey: Uint8Array): string {
  const id = keyIdBytes(publicKey);
  return `untrusted comment: minisign public key: ${idHex(id)}\n${Buffer.concat([Buffer.from("Ed"), id, publicKey]).toString("base64")}\n`;
}
/** What goes in tauri.conf.json `plugins.updater.pubkey`. */
export const minisignPublicKeyBase64 = (publicKey: Uint8Array): string => Buffer.from(minisignPublicKey(publicKey)).toString("base64");

/** A minisign signature file over a file whose BLAKE2b-512 digest is `digestHex`. Refuses a key that is not the pinned one. */
export function minisignSign(o: { digestHex: string; fileName: string; privateKeyPem: string; pinnedPublicKey: string | Uint8Array; seconds: number }): string {
  if (!/^[0-9a-f]{128}$/.test(o.digestHex)) throw new Error("a digest is 128 hex characters (BLAKE2b-512)");
  const publicKey = publicKeyBytes(o.pinnedPublicKey);
  const key = crypto.createPrivateKey(o.privateKeyPem);
  if (publicKeyHexOf(o.privateKeyPem) !== Buffer.from(publicKey).toString("hex")) throw new Error("the signing key is not the pinned release key: nothing was signed");
  const id = keyIdBytes(publicKey);
  const signature = crypto.sign(null, Buffer.from(o.digestHex, "hex"), key);
  const trusted = `timestamp:${Math.floor(o.seconds)}\tfile:${o.fileName}`;
  const global = crypto.sign(null, Buffer.concat([signature, Buffer.from(trusted)]), key);
  return `untrusted comment: signature from the Vyre release key\n${Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
}

/** The check Tauri's updater makes (minisign-verify): prehashed signature over the digest, then the signature over the trusted comment. */
export function minisignVerify(o: { digestHex: string; signatureText: string; publicKey: Uint8Array }): boolean {
  try {
    const lines = o.signatureText.split("\n");
    if (!lines[0]?.startsWith("untrusted comment:") || !lines[2]?.startsWith("trusted comment: ")) return false;
    const body = Buffer.from(lines[1] ?? "", "base64");
    if (body.length !== 74 || body.subarray(0, 2).toString() !== "ED" || !body.subarray(2, 10).equals(keyIdBytes(o.publicKey))) return false;
    const signature = body.subarray(10), global = Buffer.from(lines[3] ?? "", "base64");
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, o.publicKey]), format: "der", type: "spki" });
    const trusted = Buffer.from((lines[2] ?? "").slice("trusted comment: ".length));
    return crypto.verify(null, Buffer.from(o.digestHex, "hex"), pub, signature) && crypto.verify(null, Buffer.concat([signature, trusted]), pub, global);
  } catch { return false; }
}

/** The signature as the feed and the `.sig` asset carry it: the whole minisign file, base64, on one line. */
export const signatureAsset = (signatureText: string): string => Buffer.from(signatureText).toString("base64");

export interface DesktopFeedInput { version: string; channel: string; notes: string; pubDate: string; platforms: Record<string, { url: string; signature: string }> }
/** Tauri's static update JSON. The updater compares `version` with its own and downloads the url of its platform. */
export function desktopFeed(i: DesktopFeedInput): string {
  if (Object.keys(i.platforms).length === 0) throw new Error("a desktop feed names at least one platform");
  return `${JSON.stringify({ version: i.version, notes: i.notes, pub_date: i.pubDate, platforms: i.platforms }, null, 2)}\n`;
}

/** Sidecars in `dir` ("<digest>  <name>" in <name>.b2) read back as { name: digest }. A malformed or unknown one throws: nothing unexplained gets signed. */
export function readDigests(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".b2")).sort()) {
    const name = f.slice(0, -3);
    if (!(name in UPDATE_ARTIFACTS)) throw new Error(`${f} is not a known update artifact`);
    const m = /^([0-9a-f]{128})  (.+)\n?$/.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!m || m[2] !== name) throw new Error(`${f} is malformed`);
    out[name] = m[1]!;
  }
  return out;
}

/** In the sign job: a .sig per digest, and desktop-<channel>.json. Returns the files written. */
export function signDesktop(o: { dir: string; version: string; channel: string; tag: string; repo: string; privateKeyPem: string; pinnedPublicKey: string | Uint8Array; now: () => Date }): string[] {
  const digests = readDigests(o.dir);
  if (Object.keys(digests).length === 0) throw new Error("no update digests to sign");
  const platforms: Record<string, { url: string; signature: string }> = {};
  const written: string[] = [];
  for (const [name, digestHex] of Object.entries(digests)) {
    const text = minisignSign({ digestHex, fileName: name, privateKeyPem: o.privateKeyPem, pinnedPublicKey: o.pinnedPublicKey, seconds: o.now().getTime() / 1000 });
    const asset = signatureAsset(text);
    fs.writeFileSync(path.join(o.dir, `${name}.sig`), `${asset}\n`);
    written.push(`${name}.sig`);
    platforms[UPDATE_ARTIFACTS[name]!] = { url: `https://github.com/${o.repo}/releases/download/${o.tag}/${name}`, signature: asset };
  }
  const feed = `desktop-${o.channel}.json`;
  fs.writeFileSync(path.join(o.dir, feed), desktopFeed({ version: o.version, channel: o.channel, notes: `Vyre ${o.version}`, pubDate: o.now().toISOString(), platforms }));
  return [...written, feed];
}

/** In the publish job: every artifact in `artifacts` is the file its digest in `dir` was made from. Returns the names checked. */
export function checkDesktopArtifacts(dir: string, artifacts: string): string[] {
  const names = Object.keys(readDigests(dir));
  for (const name of names) {
    const file = path.join(artifacts, name);
    if (!fs.existsSync(file)) throw new Error(`${name} is not there to attach`);
    const want = readDigests(dir)[name]!;
    if (blake2b512(fs.readFileSync(file)).toString("hex") !== want) throw new Error(`${name} is not the file that was signed`);
  }
  return names;
}
