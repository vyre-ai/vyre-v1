// Noise_IK_25519_AESGCM_SHA256. WebCrypto only: X25519, HMAC-SHA256, AES-GCM.
import { concat, sha256, webcrypto } from "./bytes.js";

const PROTOCOL = "Noise_IK_25519_AESGCM_SHA256";

export class NoiseError extends Error {
  constructor(message) {
    super(message);
    this.name = "NoiseError";
  }
}

function nonceFor(n) {
  const out = new Uint8Array(12);
  let value = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[11 - i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

async function hmac(keyBytes, data) {
  const subtle = webcrypto().subtle;
  const key = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await subtle.sign("HMAC", key, data.slice());
  return new Uint8Array(sig);
}

async function hkdf(ck, ikm, count) {
  const temp = await hmac(ck, ikm);
  const out = [];
  let prev = new Uint8Array(0);
  for (let i = 1; i <= count; i++) {
    prev = await hmac(temp, concat(prev, Uint8Array.of(i)));
    out.push(prev);
  }
  return out;
}

async function importPublic(bytes) {
  if (bytes.length !== 32) throw new NoiseError("public key must be 32 bytes");
  return webcrypto().subtle.importKey("raw", bytes.slice(), { name: "X25519" }, true, []);
}

async function dh(privateKey, publicBytes) {
  const pub = await importPublic(publicBytes);
  const bits = await webcrypto().subtle.deriveBits({ name: "X25519", public: pub }, privateKey, 256);
  return new Uint8Array(bits);
}

async function generateEphemeral() {
  const kp = await webcrypto().subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await webcrypto().subtle.exportKey("raw", kp.publicKey));
  return { privateKey: kp.privateKey, publicKey };
}

async function aeadEncrypt(keyBytes, n, ad, plain) {
  const subtle = webcrypto().subtle;
  const key = await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: nonceFor(n), additionalData: ad },
    key,
    plain,
  );
  return new Uint8Array(ct);
}

async function aeadDecrypt(keyBytes, n, ad, ct) {
  const subtle = webcrypto().subtle;
  const key = await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: nonceFor(n), additionalData: ad },
    key,
    ct,
  );
  return new Uint8Array(plain);
}

class Transport {
  constructor(sendKey, recvKey) {
    this.sendKey = sendKey;
    this.recvKey = recvKey;
    this.ns = 0;
    this.nr = 0;
  }

  async send(plain) {
    const ct = await aeadEncrypt(this.sendKey, this.ns, new Uint8Array(0), plain.slice());
    this.ns += 1;
    return ct;
  }

  async recv(ct) {
    let plain;
    try {
      plain = await aeadDecrypt(this.recvKey, this.nr, new Uint8Array(0), ct.slice());
    } catch {
      throw new NoiseError("decrypt");
    }
    this.nr += 1;
    return plain;
  }
}

class Symmetric {
  constructor(h) {
    this.ck = h.slice();
    this.h = h.slice();
    this.k = null;
    this.n = 0;
  }

  async mixHash(data) {
    this.h = await sha256(concat(this.h, data));
  }

  async mixKey(ikm) {
    const [ck, k] = await hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.k = k;
    this.n = 0;
  }

  async encrypt(plain) {
    const bytes = plain.slice();
    if (this.k === null) {
      await this.mixHash(bytes);
      return bytes;
    }
    const ad = this.h.slice();
    const ct = await aeadEncrypt(this.k, this.n, ad, bytes);
    await this.mixHash(ct);
    this.n += 1;
    return ct;
  }

  async decrypt(ct) {
    const bytes = ct.slice();
    if (this.k === null) {
      await this.mixHash(bytes);
      return bytes;
    }
    const ad = this.h.slice();
    let plain;
    try {
      plain = await aeadDecrypt(this.k, this.n, ad, bytes);
    } catch {
      throw new NoiseError("decrypt");
    }
    await this.mixHash(bytes);
    this.n += 1;
    return plain;
  }

  async split(initiator) {
    const [k1, k2] = await hkdf(this.ck, new Uint8Array(0), 2);
    if (initiator) return new Transport(k1, k2);
    return new Transport(k2, k1);
  }
}

async function symmetric(prologue) {
  const name = new TextEncoder().encode(PROTOCOL);
  if (name.length > 32) throw new NoiseError("protocol name");
  const h = new Uint8Array(32);
  h.set(name);
  const state = new Symmetric(h);
  await state.mixHash(prologue);
  return state;
}

export async function createInitiator(opts) {
  const localPublic = opts.localPublic.slice();
  const remotePublic = opts.remotePublic.slice();
  const prologue = (opts.prologue ?? new Uint8Array(0)).slice();
  const state = await symmetric(prologue);
  await state.mixHash(remotePublic);
  const eph = await generateEphemeral();
  await state.mixHash(eph.publicKey);
  await state.mixKey(await dh(eph.privateKey, remotePublic));
  const staticCt = await state.encrypt(localPublic);
  await state.mixKey(await dh(opts.localPrivate, remotePublic));
  const payloadCt = await state.encrypt(new Uint8Array(0));
  const message1 = concat(eph.publicKey, staticCt, payloadCt);
  return {
    message1,
    async finish(message2) {
      if (!(message2 instanceof Uint8Array) || message2.length !== 48) throw new NoiseError("handshake");
      const re = message2.subarray(0, 32);
      const ct = message2.subarray(32);
      await state.mixHash(re);
      await state.mixKey(await dh(eph.privateKey, re));
      await state.mixKey(await dh(opts.localPrivate, re));
      const payload = await state.decrypt(ct);
      if (payload.length !== 0) throw new NoiseError("handshake");
      return state.split(true);
    },
  };
}

export async function createResponder(opts) {
  const localPublic = opts.localPublic.slice();
  const prologue = (opts.prologue ?? new Uint8Array(0)).slice();
  const state = await symmetric(prologue);
  await state.mixHash(localPublic);
  return {
    async read(message1) {
      if (!(message1 instanceof Uint8Array) || message1.length !== 96) throw new NoiseError("handshake");
      const e = message1.subarray(0, 32);
      const staticCt = message1.subarray(32, 80);
      const payloadCt = message1.subarray(80);
      await state.mixHash(e);
      await state.mixKey(await dh(opts.localPrivate, e));
      const remotePublic = await state.decrypt(staticCt);
      if (remotePublic.length !== 32) throw new NoiseError("handshake");
      await state.mixKey(await dh(opts.localPrivate, remotePublic));
      const payload = await state.decrypt(payloadCt);
      if (payload.length !== 0) throw new NoiseError("handshake");
      const eph = await generateEphemeral();
      await state.mixHash(eph.publicKey);
      await state.mixKey(await dh(eph.privateKey, e));
      await state.mixKey(await dh(eph.privateKey, remotePublic));
      const outPayload = await state.encrypt(new Uint8Array(0));
      const message2 = concat(eph.publicKey, outPayload);
      return { remotePublic, message2, session: await state.split(false) };
    },
  };
}
