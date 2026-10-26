// Ed25519 signing of release manifests. The signature covers SIGNATURE_PREFIX + the exact manifest text and is base64 of the 64 raw bytes: the format the server verifies
// (modules/updates/handlers/channels.ts verifySignature). The private key exists only in the GitHub Environment `release`; it is read from the environment, never an argument or a file,
// and a signature is released only after it verifies under the public key the servers pin, so a wrong secret fails the release instead of shipping a signature nobody trusts.
import crypto from "node:crypto";

export const SIGNATURE_PREFIX = "vyre-release-sums\n";
export const SIGNING_KEY_ENV = "VYRE_SIGNING_KEY";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** The pinned public key as 32 raw bytes, from hex, base64 or a PEM. */
export function publicKeyBytes(key: string | Uint8Array): Uint8Array {
  if (typeof key !== "string") { if (key.length !== 32) throw new Error("an Ed25519 public key is 32 bytes"); return key; }
  const t = key.trim();
  const raw = t.includes("BEGIN PUBLIC KEY")
    ? crypto.createPublicKey(t).export({ type: "spki", format: "der" }).subarray(SPKI_ED25519_PREFIX.length)
    : /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (raw.length !== 32) throw new Error("an Ed25519 public key is 32 bytes");
  return new Uint8Array(raw);
}

function publicKeyObject(raw: Uint8Array): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
}

export function verifyManifest(manifest: string, signatureB64: string, key: string | Uint8Array): boolean {
  const sig = Buffer.from(signatureB64.trim(), "base64");
  if (sig.length !== 64) return false;
  try { return crypto.verify(null, Buffer.from(SIGNATURE_PREFIX + manifest), publicKeyObject(publicKeyBytes(key)), sig); } catch { return false; }
}

/** Sign `manifest` with a PKCS8 PEM private key and refuse to return a signature the pinned key does not accept. */
export function signManifest(manifest: string, privateKeyPem: string, pinnedPublicKey: string | Uint8Array): string {
  if (privateKeyPem.trim() === "") throw new Error(`no signing key: ${SIGNING_KEY_ENV} is only set in the release environment`);
  const sig = crypto.sign(null, Buffer.from(SIGNATURE_PREFIX + manifest), crypto.createPrivateKey(privateKeyPem)).toString("base64");
  if (!verifyManifest(manifest, sig, pinnedPublicKey)) throw new Error("the signing key is not the pinned release key: nothing was signed");
  return sig;
}

/** The public half of a signing key, as 64 hex characters: what gets compiled into the servers (the updates module's releaseKey) and printed once by the release job. Never the private half. */
export function publicKeyHexOf(privateKeyPem: string): string {
  const der = crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(SPKI_ED25519_PREFIX.length)).toString("hex");
}

/** A short id for a public key (first 16 hex of its sha256), for logs and the feed, so a key change is visible without printing the key. */
export function keyId(publicKeyHex: string): string {
  return crypto.createHash("sha256").update(Buffer.from(publicKeyHex, "hex")).digest("hex").slice(0, 16);
}
