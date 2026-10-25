// WebCrypto subset the device layer uses. Typed here so sync needs no DOM lib; Node 20+, browsers and Hermes (with a polyfill) all fit.
export interface CryptoKeyLike { readonly extractable: boolean; readonly type: string; readonly algorithm: { name: string } }

export interface SubtleLike {
  generateKey(alg: { name: string; length: number }, extractable: boolean, usages: string[]): Promise<CryptoKeyLike>;
  importKey(format: "raw", data: Uint8Array, alg: string | { name: string }, extractable: boolean, usages: string[]): Promise<CryptoKeyLike>;
  encrypt(alg: { name: string; iv: Uint8Array; additionalData?: Uint8Array }, key: CryptoKeyLike, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(alg: { name: string; iv: Uint8Array; additionalData?: Uint8Array }, key: CryptoKeyLike, data: Uint8Array): Promise<ArrayBuffer>;
  deriveBits(alg: { name: string; hash: string; salt: Uint8Array; info: Uint8Array }, key: CryptoKeyLike, bits: number): Promise<ArrayBuffer>;
}

export interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues<T extends Uint8Array>(array: T): T;
}

export function defaultCrypto(): CryptoLike {
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!c || !c.subtle) throw new Error("WebCrypto is not available on this device");
  return c;
}

const enc = new TextEncoder();
export const utf8 = (s: string): Uint8Array => enc.encode(s);

export function toHex(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
