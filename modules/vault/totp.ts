// One-time codes (RFC 6238, built on RFC 4226): the current code of a TOTP seed, computed where the seed lives so the seed itself never goes anywhere. The seed is a base32 text, or an otpauth address
// (otpauth://totp/Label?secret=...&algorithm=SHA256&digits=8&period=60) that carries its own algorithm, digit count and period; the defaults are SHA1, 6 digits and 30 seconds.
import { createHmac } from "node:crypto";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";
export interface TotpParams {
  secret: Buffer;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** base32 text (spaces, hyphens, case and padding ignored) as bytes; null when it is not base32. */
export function decodeBase32(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean === "") return null;
  let bits = 0;
  let val = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out.length > 0 ? Buffer.from(out) : null;
}

/** The seed as stored (base32, or an otpauth address) read into what a code needs; null when it is neither. */
export function parseSeed(stored: string): TotpParams | null {
  const text = stored.trim();
  let secretText = text;
  let algorithm: TotpAlgorithm = "SHA1";
  let digits = 6;
  let period = 30;
  if (/^otpauth:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== "totp") return null;
    secretText = url.searchParams.get("secret") ?? "";
    const a = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
    if (a !== "SHA1" && a !== "SHA256" && a !== "SHA512") return null;
    algorithm = a;
    const d = Number(url.searchParams.get("digits") ?? "6");
    if (!Number.isInteger(d) || d < 6 || d > 8) return null;
    digits = d;
    const p = Number(url.searchParams.get("period") ?? "30");
    if (!Number.isInteger(p) || p < 15 || p > 300) return null;
    period = p;
  }
  const secret = decodeBase32(secretText);
  return secret ? { secret, algorithm, digits, period } : null;
}

/** The code of one time step (RFC 4226 dynamic truncation). */
export function codeAtStep(p: TotpParams, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac(p.algorithm.toLowerCase(), p.secret).update(msg).digest();
  const o = (h[h.length - 1] as number) & 15;
  const n =
    (((h[o] as number) & 127) << 24) |
    ((h[o + 1] as number) << 16) |
    ((h[o + 2] as number) << 8) |
    (h[o + 3] as number);
  return String(n % 10 ** p.digits).padStart(p.digits, "0");
}

/** The code at a moment, and how many milliseconds of its window are left. */
export function codeAt(p: TotpParams, nowMs: number): { code: string; leftMs: number } {
  const periodMs = p.period * 1000;
  return { code: codeAtStep(p, Math.floor(nowMs / periodMs)), leftMs: periodMs - (nowMs % periodMs) };
}

/** A code with at least `minLeftMs` of its window left: with less, the next window's code and how long to wait for it (so a code typed a moment later is still good when the site checks it). */
export function codeToType(stored: string, nowMs: number, minLeftMs = 5000): { code: string; waitMs: number } | null {
  const p = parseSeed(stored);
  if (!p) return null;
  const now = codeAt(p, nowMs);
  if (now.leftMs >= minLeftMs) return { code: now.code, waitMs: 0 };
  const at = nowMs + now.leftMs;
  return { code: codeAt(p, at).code, waitMs: now.leftMs };
}

/**
 * Is this field a TOTP seed (not a code and not a password)? An item of the kind totp; a field whose value is an otpauth:// address; or a field named exactly totp or totp_secret. A field named otp, 2fa or mfa is a seed
 * only by those rules (a recovery or backup code kept under such a name is a stored value like any other and is filled exactly as it is stored).
 */
export function isSeedField(kind: string, key: string, value = ""): boolean {
  return kind === "totp" || /^otpauth:\/\/totp\b/i.test(value.trim()) || /^(totp|totp_secret)$/i.test(key);
}
