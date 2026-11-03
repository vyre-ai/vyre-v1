// The crypto of a person's own X25519 pair as their client bundles it (client/src/crypto/keys.ts), for the host's key port (host/src/seams/person-keys.ts): whether 32 raw bytes are a public key on
// the curve, and the private key opened from its wrapped blob with the person key. Crypto stays in the kernel (boundary B3); the host only reads the rows.
import crypto from "node:crypto";

const PRIVATE_AAD = Buffer.from("vyre/person-key/v1/private-key");
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");

/** True when `key` (32 raw bytes) is an X25519 public key. */
export function isX25519Public(key: Uint8Array): boolean {
  if (key.length !== 32) return false;
  try { crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(key).toString("base64url") }, format: "jwk" }); return true; } catch { return false; }
}

/**
 * The raw X25519 private key (32 bytes) inside `blob`: version (1) | salt (16) | nonce (12) | AES-256-GCM(personKey, PKCS8 private key, purpose "private-key"). Null when the blob does not open with
 * this person key or holds no X25519 key. The caller wipes the person key and the answer.
 */
export function openPrivateKeyBlob(blob: Uint8Array, personKey: Uint8Array): Buffer | null {
  if (personKey.length !== 32 || blob.length < 1 + 16 + 12 + 16 || blob[0] !== 1) return null;
  const b = Buffer.from(blob);
  const nonce = b.subarray(17, 29), body = b.subarray(29);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", personKey, nonce);
    d.setAAD(PRIVATE_AAD);
    d.setAuthTag(body.subarray(body.length - 16));
    const pkcs8 = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    try {
      if (pkcs8.length !== 48 || !pkcs8.subarray(0, 16).equals(X25519_PKCS8)) return null;
      return Buffer.from(pkcs8.subarray(16));
    } finally { pkcs8.fill(0); }
  } catch { return null; }
}
