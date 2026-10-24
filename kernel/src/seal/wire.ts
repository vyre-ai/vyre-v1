// What the kernel, the host and any signer agree on byte for byte (ported from 0.6 kernel/seal/wire.js; the presence-proof bytes are not carried over, v1 has no presence proofs).
// Sorted-key JSON, no whitespace, so every implementation produces the same bytes. The vectors in ./vectors are shared with the native signers.
import crypto from "node:crypto";

/** JSON with keys sorted at every level, no whitespace, undefined dropped. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** sha-256 as base64url. */
export const sha256b64 = (s: string | Uint8Array): string => crypto.createHash("sha256").update(s).digest("base64url");

/**
 * sha-256 (base64url) of the canonical payload a person approves: `{ op, space, fields }`. The fields are NESTED, so a field named op or space can never stand for the real one.
 * Used by the Gate: an approval token is good for one payload hash only.
 */
export const payloadHash = (op: string, space: string, fields: Record<string, unknown>): string => sha256b64(canonical({ op, space, fields }));

/** Constant-time comparison of two MAC strings. */
export function sameMac(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** HMAC-SHA-256 of text, base64url. */
export const hmac = (key: Uint8Array | string, text: string): string => crypto.createHmac("sha256", key).update(text).digest("base64url");
