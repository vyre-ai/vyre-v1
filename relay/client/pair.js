// One pairing stack. Invite codes and pair codes both call pair().
// PAIR_BASE defaults to https://vyre.run/pair. A Space overrides it. Nothing depends on us.
import { b64, equalText, fromB64, hex, sha256, utf8, webcrypto } from "./bytes.js";
import { connect } from "./connect.js";
import { createInitiator, createResponder } from "./noise.js";
import { deviceKey } from "./shellkey.js";

export const PAIR_BASE = "https://vyre.run/pair";

export class PairError extends Error {
  constructor(message) {
    super(message);
    this.name = "PairError";
  }
}

function envPairBase(env) {
  const source = env !== undefined ? env : (globalThis.process && globalThis.process.env) || {};
  const value = source.VYRE_PAIR_BASE;
  return typeof value === "string" ? value : "";
}

export function pairBase(override, env) {
  const raw = (typeof override === "string" && override) || envPairBase(env) || PAIR_BASE;
  return String(raw).replace(/\/+$/, "");
}

export async function fingerprintOf(publicKey) {
  return hex(await sha256(publicKey));
}

export function readPairLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new PairError("invite link is not a URL");
  }
  return {
    pairBase: pairBase(`${url.origin}${url.pathname}`),
    inviteCode: url.searchParams.get("code") || "",
    spaceFingerprint: url.searchParams.get("fp") || "",
    address: url.searchParams.get("addr") || "",
  };
}

function http(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createPairBroker() {
  const tables = { invite: new Map(), pair: new Map() };
  let last = null;

  async function issue(kind, key) {
    const fingerprint = await fingerprintOf(key.publicKey);
    const code = hex(webcrypto().getRandomValues(new Uint8Array(8)));
    tables[kind].set(code, {
      privateKey: key.privateKey,
      publicKey: key.publicKey.slice(),
      fingerprint,
    });
    return { code, fingerprint, kind };
  }

  function begin(body) {
    const table = tables[body.kind];
    const rec = table && table.get(body.code);
    if (!rec) return http(404, { error: "unknown_code" });
    if (!equalText(rec.fingerprint, body.spaceFingerprint)) return http(409, { error: "fingerprint_mismatch" });
    return http(200, { spacePublic: b64(rec.publicKey), spaceFingerprint: rec.fingerprint });
  }

  async function finish(body) {
    const table = tables[body.kind];
    const rec = table && table.get(body.code);
    if (!rec) return http(404, { error: "unknown_code" });
    if (!equalText(rec.fingerprint, body.spaceFingerprint)) return http(409, { error: "fingerprint_mismatch" });
    table.delete(body.code);
    let message1;
    try {
      message1 = fromB64(body.message1);
    } catch {
      return http(400, { error: "bad_message" });
    }
    try {
      const responder = await createResponder({
        localPrivate: rec.privateKey,
        localPublic: rec.publicKey,
        prologue: utf8(rec.fingerprint),
      });
      const read = await responder.read(message1);
      last = read.session;
      return http(200, { message2: b64(read.message2) });
    } catch {
      return http(400, { error: "handshake" });
    }
  }

  return {
    issueInvite(key) {
      return issue("invite", key);
    },
    issuePairCode(key) {
      return issue("pair", key);
    },
    responder() {
      return last;
    },
    async fetch(url, init) {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      if (path.endsWith("/v1/pair/finish")) return finish(body);
      if (path.endsWith("/v1/pair")) return begin(body);
      return http(404, { error: "unknown_path" });
    },
  };
}

function normalize(opts) {
  const fromLink = opts.link ? readPairLink(opts.link) : {};
  return {
    inviteCode: opts.inviteCode || fromLink.inviteCode || "",
    pairCode: opts.pairCode || "",
    spaceFingerprint: String(opts.spaceFingerprint || fromLink.spaceFingerprint || "").toLowerCase(),
    pairBase: opts.pairBase || fromLink.pairBase || "",
    address: opts.address || fromLink.address || "",
    fetch: opts.fetch,
    deviceKey: opts.deviceKey,
    indexedDB: opts.indexedDB,
    store: opts.store,
    invoke: opts.invoke,
  };
}

async function post(fetchImpl, url, body) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new PairError("pair response was not json");
    }
  }
  if (!res.ok) throw new PairError(typeof data.error === "string" ? data.error : "pair_failed");
  return data;
}

export async function pair(opts = {}) {
  const input = normalize(opts);
  if (input.inviteCode && input.pairCode) throw new PairError("pass an invite code or a pair code, not both");
  if (!input.inviteCode && !input.pairCode) throw new PairError("pass an invite code or a pair code");
  if (!/^[0-9a-f]{64}$/.test(input.spaceFingerprint)) throw new PairError("a pinned space fingerprint is required");
  const kind = input.inviteCode ? "invite" : "pair";
  const code = input.inviteCode || input.pairCode;
  const base = pairBase(input.pairBase);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("pair requires fetch");
  const device = input.deviceKey ?? await deviceKey({
    indexedDB: input.indexedDB,
    store: input.store,
    invoke: input.invoke,
  });
  const started = await post(fetchImpl, `${base}/v1/pair`, {
    kind,
    code,
    spaceFingerprint: input.spaceFingerprint,
  });
  let spacePublic;
  try {
    spacePublic = fromB64(started.spacePublic);
  } catch {
    throw new PairError("space key was not 32 bytes");
  }
  if (spacePublic.length !== 32) throw new PairError("space key was not 32 bytes");
  const got = await fingerprintOf(spacePublic);
  if (!equalText(got, input.spaceFingerprint)) throw new PairError("space key does not match the pinned fingerprint");
  const initiator = await createInitiator({
    localPrivate: device.privateKey,
    localPublic: device.publicKey,
    remotePublic: spacePublic,
    prologue: utf8(input.spaceFingerprint),
  });
  const done = await post(fetchImpl, `${base}/v1/pair/finish`, {
    kind,
    code,
    spaceFingerprint: input.spaceFingerprint,
    message1: b64(initiator.message1),
  });
  let message2;
  try {
    message2 = fromB64(done.message2);
  } catch {
    throw new PairError("handshake");
  }
  let session;
  try {
    session = await initiator.finish(message2);
  } catch {
    throw new PairError("handshake");
  }
  const connection = await connect({ session });
  return {
    stack: "pair",
    kind,
    pairBase: base,
    address: input.address,
    spaceFingerprint: input.spaceFingerprint,
    devicePublic: device.publicKey,
    connection,
  };
}

export const serverPair = pair;
export const setupPair = pair;
