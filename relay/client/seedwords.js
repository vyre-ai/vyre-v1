// Seed phrases: 12 or 24 words, SHA-256 checksum, same shape as a BIP39 phrase.
import { sha256, webcrypto } from "./bytes.js";
import { WORDS, wordIndex } from "./words.js";

export { WORDS };

export class SeedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeedError";
  }
}

function bitsFromBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(2).padStart(8, "0");
  return out;
}

function bitsToBytes(bits) {
  if (bits.length % 8 !== 0) throw new SeedError("entropy must be 16 or 32 bytes");
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export async function entropyToWords(entropy) {
  if (!(entropy instanceof Uint8Array) || (entropy.length !== 16 && entropy.length !== 32)) {
    throw new SeedError("entropy must be 16 or 32 bytes");
  }
  const hash = await sha256(entropy);
  const checksumBits = entropy.length / 4;
  const bits = bitsFromBytes(entropy) + bitsFromBytes(hash).slice(0, checksumBits);
  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    const idx = Number.parseInt(bits.slice(i, i + 11), 2);
    const word = WORDS[idx];
    if (!word) throw new SeedError("entropy must be 16 or 32 bytes");
    words.push(word);
  }
  return words.join(" ");
}

export async function wordsToEntropy(phrase) {
  const parts = String(phrase).trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 12 && parts.length !== 24) throw new SeedError("seed phrase must be 12 or 24 words");
  let bits = "";
  for (const word of parts) {
    const idx = wordIndex(word);
    if (idx < 0) throw new SeedError("unknown seed word");
    bits += idx.toString(2).padStart(11, "0");
  }
  const checksumBits = parts.length === 12 ? 4 : 8;
  const entropy = bitsToBytes(bits.slice(0, bits.length - checksumBits));
  const hash = await sha256(entropy);
  const expect = bitsFromBytes(hash).slice(0, checksumBits);
  if (expect !== bits.slice(bits.length - checksumBits)) throw new SeedError("bad checksum");
  return entropy;
}

export async function generateSeed(count = 12) {
  if (count !== 12 && count !== 24) throw new SeedError("seed phrase must be 12 or 24 words");
  const entropy = webcrypto().getRandomValues(new Uint8Array(count === 12 ? 16 : 32));
  return entropyToWords(entropy);
}
