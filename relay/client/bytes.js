// Byte helpers for the relay client. No node:crypto and no third-party imports.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text) {
  return encoder.encode(text);
}

export function utf8Decode(bytes) {
  return decoder.decode(bytes);
}

export function concat(...parts) {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function equalText(a, b) {
  const left = String(a);
  const right = String(b);
  const n = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < n; i++) {
    const x = i < left.length ? left.charCodeAt(i) : 0;
    const y = i < right.length ? right.charCodeAt(i) : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

export function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export function b64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

export function fromB64(text) {
  const s = String(text).replace(/\s/g, "");
  if (s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(s)) throw new Error("bad base64");
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]);
    const b = B64.indexOf(s[i + 1]);
    const c = s[i + 2] === "=" ? -1 : B64.indexOf(s[i + 2]);
    const d = s[i + 3] === "=" ? -1 : B64.indexOf(s[i + 3]);
    if (a < 0 || b < 0 || (s[i + 2] !== "=" && c < 0) || (s[i + 3] !== "=" && d < 0)) throw new Error("bad base64");
    const cc = c < 0 ? 0 : c;
    const dd = d < 0 ? 0 : d;
    const n = (a << 18) | (b << 12) | (cc << 6) | dd;
    out.push((n >> 16) & 255);
    if (c >= 0) out.push((n >> 8) & 255);
    if (d >= 0) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

export function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  const s = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return fromB64(s + pad);
}

export function webcrypto() {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) throw new Error("WebCrypto is required");
  return crypto;
}

export async function sha256(bytes) {
  const digest = await webcrypto().subtle.digest("SHA-256", bytes.slice());
  return new Uint8Array(digest);
}
