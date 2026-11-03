// The public half and the private half of a person's own X25519 pair, for the Vault's key port (modules/vault/handlers/crypto.ts, enc=3): a Mine item saved while the person's key is not on this node
// is sealed to their public key, and opened again with their private key once their person key is here. Both come from the key bundle their client made (client/src/crypto/keys.ts): publicKey is the raw
// 32-byte X25519 key, privateKeyWrapped is version (1) | salt (16) | nonce (12) | AES-256-GCM(personKey, PKCS8 private key, purpose "private-key"). The server never had the private key before: it opens it
// here only with the person key the person's own client handed over (the keyring), for one call, and keeps nothing.
import crypto from "node:crypto";

type Db = { all(sql: string, ...args: unknown[]): unknown[] };
const PRIVATE_AAD = Buffer.from("vyre/person-key/v1/private-key");
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const b64url = (b: Buffer): string => b.toString("base64url");

function bundleOf(db: Db | null, personId: string): { publicKey?: string; privateKeyWrapped?: string } | null {
  if (!db) return null;
  try {
    const row = db.all("SELECT keys_json FROM identity_accounts WHERE person_id = ?", personId)[0] as { keys_json?: string } | undefined;
    return row?.keys_json ? (JSON.parse(row.keys_json) as { publicKey?: string; privateKeyWrapped?: string }) : null;
  } catch { return null; }
}

/** The person's public key (raw, base64url), or null when they have no real bundle here (32 bytes that are a point on the curve). */
export function publicKeyOf(db: Db | null, personId: string): string | null {
  const raw = bundleOf(db, personId)?.publicKey;
  if (typeof raw !== "string") return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) return null;
  try { crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64url(key) }, format: "jwk" }); } catch { return null; }
  return b64url(key);
}

/** The person's private key (raw, base64url), opened with their person key; null when the blob does not open with it. The caller wipes the person key. */
export function privateKeyOf(db: Db | null, personId: string, personKey: Uint8Array): string | null {
  const wrapped = bundleOf(db, personId)?.privateKeyWrapped;
  if (typeof wrapped !== "string" || personKey.length !== 32) return null;
  const blob = Buffer.from(wrapped, "base64");
  if (blob.length < 1 + 16 + 12 + 16 || blob[0] !== 1) return null;
  const nonce = blob.subarray(17, 29), body = blob.subarray(29);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", personKey, nonce);
    d.setAAD(PRIVATE_AAD);
    d.setAuthTag(body.subarray(body.length - 16));
    const pkcs8 = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    try {
      if (pkcs8.length !== 48 || !pkcs8.subarray(0, 16).equals(X25519_PKCS8)) return null;
      return b64url(pkcs8.subarray(16));
    } finally { pkcs8.fill(0); }
  } catch { return null; }
}
