// Device key. The default store is a non-extractable X25519 key in IndexedDB.
// shellDeviceKey(invoke) is the Tauri path. An ad-hoc signed shell does not use it unless asked.
import { fromB64url, webcrypto } from "./bytes.js";

export const DEVICE_DB = "vyre-relay";
export const DEVICE_STORE = "device-key";
export const DEVICE_RECORD = "device";

export async function generateAgreementKey() {
  const subtle = webcrypto().subtle;
  const pair = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey, source: "memory" };
}

async function importNonExtractable(jwk) {
  const key = await webcrypto().subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "X25519", x: jwk.x, d: jwk.d, key_ops: ["deriveBits"], ext: false },
    { name: "X25519" },
    false,
    ["deriveBits"],
  );
  if (key.extractable) throw new Error("device key was extractable");
  return key;
}

async function createDeviceKey() {
  const fresh = await generateAgreementKey();
  const jwk = await webcrypto().subtle.exportKey("jwk", fresh.privateKey);
  const privateKey = await importNonExtractable(jwk);
  return { privateKey, publicKey: fresh.publicKey, source: "indexeddb" };
}

function openDatabase(idb) {
  return new Promise((resolve, reject) => {
    const req = idb.open(DEVICE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error("IndexedDB is required for the device key"));
  });
}

function requestOf(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error("IndexedDB is required for the device key"));
  });
}

export async function indexedDbDeviceKey(opts = {}) {
  const idb = opts.indexedDB === undefined ? globalThis.indexedDB : opts.indexedDB;
  if (!idb || typeof idb.open !== "function") throw new TypeError("IndexedDB is required for the device key");
  const db = await openDatabase(idb);
  const existing = await requestOf(db.transaction(DEVICE_STORE, "readonly").objectStore(DEVICE_STORE).get(DEVICE_RECORD));
  if (existing && existing.privateKey && existing.publicKey) {
    return {
      privateKey: existing.privateKey,
      publicKey: new Uint8Array(existing.publicKey),
      source: "indexeddb",
    };
  }
  const created = await createDeviceKey();
  await requestOf(
    db.transaction(DEVICE_STORE, "readwrite").objectStore(DEVICE_STORE).put(
      { privateKey: created.privateKey, publicKey: created.publicKey },
      DEVICE_RECORD,
    ),
  );
  return created;
}

export async function shellDeviceKey(invoke) {
  if (typeof invoke !== "function") throw new TypeError("shellDeviceKey requires invoke");
  const material = await invoke("device_key");
  if (!material || material.kty !== "OKP" || material.crv !== "X25519" || typeof material.d !== "string" || typeof material.x !== "string") {
    throw new TypeError("shell device_key must return an X25519 JWK");
  }
  const privateKey = await importNonExtractable(material);
  const publicKey = fromB64url(material.x);
  if (publicKey.length !== 32) throw new TypeError("shell device_key public key must be 32 bytes");
  return { privateKey, publicKey, source: "shell" };
}

export async function deviceKey(opts = {}) {
  if (opts.store === "shell") return shellDeviceKey(opts.invoke);
  if (opts.store !== undefined && opts.store !== "indexeddb") {
    throw new TypeError("device key store must be indexeddb or shell");
  }
  return indexedDbDeviceKey(opts);
}
