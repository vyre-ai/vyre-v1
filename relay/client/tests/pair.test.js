// One pairing stack: invite codes and pair codes both go through pair().
// Types: "relay/client/index.d.ts"
import test from "node:test";
import assert from "node:assert/strict";
import {
  PAIR_BASE,
  pair,
  pairBase,
  serverPair,
  setupPair,
  createPairBroker,
  readPairLink,
  deviceKey,
  shellDeviceKey,
  generateAgreementKey,
  b64,
  HEARTBEAT_MS,
} from "../index.js";

function fakeIndexedDB() {
  const dbs = new Map();
  function makeDb() {
    const stores = new Map();
    return {
      objectStoreNames: { contains: (name) => stores.has(name) },
      createObjectStore(name) {
        if (!stores.has(name)) stores.set(name, new Map());
      },
      transaction(name) {
        const store = stores.get(name);
        if (!store) throw new Error("missing store");
        return {
          objectStore() {
            return {
              get(key) {
                const req = {};
                queueMicrotask(() => {
                  req.result = store.has(key) ? store.get(key) : undefined;
                  req.onsuccess();
                });
                return req;
              },
              put(value, key) {
                const req = {};
                queueMicrotask(() => {
                  store.set(key, value);
                  req.result = key;
                  req.onsuccess();
                });
                return req;
              },
            };
          },
        };
      },
    };
  }
  return {
    open(name) {
      const req = {};
      queueMicrotask(() => {
        let created = false;
        let db = dbs.get(name);
        if (!db) {
          db = makeDb();
          dbs.set(name, db);
          created = true;
        }
        req.result = db;
        if (created && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        req.onsuccess();
      });
      return req;
    },
  };
}

async function echo(connection, remote) {
  connection.deliver = async (ct) => {
    const plain = await remote.recv(ct);
    const msg = JSON.parse(new TextDecoder().decode(plain));
    const reply = new TextEncoder().encode(JSON.stringify({ ok: true, method: msg.method, path: msg.path }));
    return remote.send(reply);
  };
  return connection.request("GET", "/health", null);
}

async function openPair(kind, extra = {}) {
  const space = await generateAgreementKey();
  const broker = createPairBroker();
  const issued = kind === "invite" ? await broker.issueInvite(space) : await broker.issuePairCode(space);
  const opts = {
    spaceFingerprint: issued.fingerprint,
    pairBase: extra.pairBase ?? PAIR_BASE,
    fetch: extra.fetch ?? broker.fetch,
  };
  if (kind === "invite") opts.inviteCode = issued.code;
  else opts.pairCode = issued.code;
  if (extra.indexedDB) opts.indexedDB = extra.indexedDB;
  if (extra.deviceKey) opts.deviceKey = extra.deviceKey;
  if (!extra.deviceKey && !extra.indexedDB && extra.store !== "shell") opts.deviceKey = await generateAgreementKey();
  if (extra.store) opts.store = extra.store;
  if (extra.invoke) opts.invoke = extra.invoke;
  const result = await pair(opts);
  return { result, broker, issued, space };
}

test("PAIR_BASE defaults to vyre.run and a Space can override it", () => {
  assert.equal(PAIR_BASE, "https://vyre.run/pair");
  assert.equal(pairBase(undefined, {}), PAIR_BASE);
  assert.equal(pairBase("https://space.example/pair/", {}), "https://space.example/pair");
  assert.equal(pairBase("", { VYRE_PAIR_BASE: "https://env.example/pair/" }), "https://env.example/pair");
  assert.equal(pairBase("https://arg.example/pair", { VYRE_PAIR_BASE: "https://env.example/pair" }), "https://arg.example/pair");
});

test("serverPair and setupPair are the same function as pair", () => {
  assert.equal(serverPair, pair);
  assert.equal(setupPair, pair);
});

test("pair by invite code pins the Space key and answers a request", async () => {
  const { result, broker } = await openPair("invite");
  assert.equal(result.stack, "pair");
  assert.equal(result.kind, "invite");
  assert.equal(result.pairBase, PAIR_BASE);
  assert.equal(result.connection.heartbeatMs, HEARTBEAT_MS);
  assert.equal(result.devicePublic.length, 32);
  const body = await echo(result.connection, broker.responder());
  assert.equal(body.ok, true);
  assert.equal(body.method, "GET");
  assert.equal(body.path, "/health");
});

test("pair by pair code uses the same stack", async () => {
  const { result, broker } = await openPair("pair", { pairBase: "https://office.example/pair/" });
  assert.equal(result.stack, "pair");
  assert.equal(result.kind, "pair");
  assert.equal(result.pairBase, "https://office.example/pair");
  const body = await echo(result.connection, broker.responder());
  assert.equal(body.ok, true);
});

test("an invite link carries the address, the code and the fingerprint", async () => {
  const space = await generateAgreementKey();
  const broker = createPairBroker();
  const issued = await broker.issueInvite(space);
  const link = `https://space.example/pair?code=${issued.code}&fp=${issued.fingerprint}&addr=https://northwind.example`;
  const parsed = readPairLink(link);
  assert.equal(parsed.pairBase, "https://space.example/pair");
  assert.equal(parsed.inviteCode, issued.code);
  assert.equal(parsed.spaceFingerprint, issued.fingerprint);
  assert.equal(parsed.address, "https://northwind.example");
  const urls = [];
  const fetch = async (url, init) => {
    urls.push(url);
    return broker.fetch(url, init);
  };
  const result = await pair({ link, fetch, deviceKey: await generateAgreementKey() });
  assert.equal(result.kind, "invite");
  assert.equal(result.address, "https://northwind.example");
  assert.equal(result.pairBase, "https://space.example/pair");
  assert.equal(urls[0], "https://space.example/pair/v1/pair");
  assert.equal(urls[1], "https://space.example/pair/v1/pair/finish");
  const again = await broker.issueInvite(space);
  const link2 = `https://space.example/pair?code=${again.code}&fp=${again.fingerprint}&addr=https://northwind.example`;
  const urls2 = [];
  const fetch2 = async (url, init) => {
    urls2.push(url);
    return broker.fetch(url, init);
  };
  const overridden = await pair({
    link: link2,
    pairBase: "https://override.example/pair",
    fetch: fetch2,
    deviceKey: await generateAgreementKey(),
  });
  assert.equal(overridden.pairBase, "https://override.example/pair");
  assert.equal(urls2[0], "https://override.example/pair/v1/pair");
});

test("a code works once, and the two kinds do not cross", async () => {
  const space = await generateAgreementKey();
  const broker = createPairBroker();
  const invite = await broker.issueInvite(space);
  const pairCode = await broker.issuePairCode(space);
  const device = await generateAgreementKey();
  const base = { spaceFingerprint: invite.fingerprint, pairBase: PAIR_BASE, fetch: broker.fetch, deviceKey: device };
  await pair({ ...base, inviteCode: invite.code });
  await assert.rejects(() => pair({ ...base, inviteCode: invite.code }), /unknown_code/);
  await assert.rejects(() => pair({ ...base, inviteCode: pairCode.code, spaceFingerprint: pairCode.fingerprint }), /unknown_code/);
  await pair({ ...base, pairCode: pairCode.code, spaceFingerprint: pairCode.fingerprint });
  await assert.rejects(() => pair({ ...base, pairCode: pairCode.code, spaceFingerprint: pairCode.fingerprint }), /unknown_code/);
});

test("a mismatched pin is refused and does not spend the code", async () => {
  const space = await generateAgreementKey();
  const broker = createPairBroker();
  const issued = await broker.issueInvite(space);
  const device = await generateAgreementKey();
  await assert.rejects(
    () => pair({
      inviteCode: issued.code,
      spaceFingerprint: "ab".repeat(32),
      pairBase: PAIR_BASE,
      fetch: broker.fetch,
      deviceKey: device,
    }),
    /fingerprint_mismatch/,
  );
  const result = await pair({
    inviteCode: issued.code,
    spaceFingerprint: issued.fingerprint,
    pairBase: PAIR_BASE,
    fetch: broker.fetch,
    deviceKey: device,
  });
  assert.equal(result.kind, "invite");
});

test("a space key that misses the pinned fingerprint is refused before finish", async () => {
  const space = await generateAgreementKey();
  const other = await generateAgreementKey();
  const broker = createPairBroker();
  const issued = await broker.issueInvite(space);
  const urls = [];
  const fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith("/finish")) throw new Error("finish must not run");
    const res = await broker.fetch(url, init);
    const data = JSON.parse(await res.text());
    data.spacePublic = b64(other.publicKey);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  await assert.rejects(
    () => pair({
      inviteCode: issued.code,
      spaceFingerprint: issued.fingerprint,
      pairBase: "https://space.example/pair",
      fetch,
      deviceKey: await generateAgreementKey(),
    }),
    /pinned fingerprint/,
  );
  assert.deepEqual(urls, ["https://space.example/pair/v1/pair"]);
});

test("pair rejects an empty call and a call that passes both codes", async () => {
  const device = await generateAgreementKey();
  const fetch = async () => {
    throw new Error("fetch must not run");
  };
  await assert.rejects(() => pair({ fetch, deviceKey: device }), /invite code or a pair code/);
  await assert.rejects(
    () => pair({
      inviteCode: "aa",
      pairCode: "bb",
      spaceFingerprint: "ab".repeat(32),
      fetch,
      deviceKey: device,
    }),
    /not both/,
  );
  await assert.rejects(() => readPairLink("not a url"), /not a URL/);
});

test("the default device key is a non-extractable IndexedDB key", async () => {
  const idb = fakeIndexedDB();
  let shellCalls = 0;
  const key = await deviceKey({
    indexedDB: idb,
    invoke: async () => {
      shellCalls += 1;
      throw new Error("shell");
    },
  });
  assert.equal(shellCalls, 0);
  assert.equal(key.source, "indexeddb");
  assert.equal(key.privateKey.extractable, false);
  assert.equal(key.publicKey.length, 32);
  await assert.rejects(() => crypto.subtle.exportKey("jwk", key.privateKey));
  const again = await deviceKey({ indexedDB: idb });
  assert.deepEqual(again.publicKey, key.publicKey);
  assert.equal(again.privateKey, key.privateKey);
  const { result, broker } = await openPair("invite", { indexedDB: fakeIndexedDB() });
  const body = await echo(result.connection, broker.responder());
  assert.equal(body.ok, true);
  await assert.rejects(() => deviceKey({ indexedDB: null }), /IndexedDB/);
});

test("shellDeviceKey is opt-in and still pairs", async () => {
  const fresh = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const jwk = await crypto.subtle.exportKey("jwk", fresh.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", fresh.publicKey));
  let calls = 0;
  const invoke = async (command) => {
    calls += 1;
    assert.equal(command, "device_key");
    return jwk;
  };
  const key = await shellDeviceKey(invoke);
  assert.equal(calls, 1);
  assert.equal(key.source, "shell");
  assert.equal(key.privateKey.extractable, false);
  assert.deepEqual(key.publicKey, raw);
  await assert.rejects(() => crypto.subtle.exportKey("jwk", key.privateKey));
  const { result, broker } = await openPair("pair", { deviceKey: key, pairBase: "https://shell.example/pair" });
  assert.equal(result.kind, "pair");
  const body = await echo(result.connection, broker.responder());
  assert.equal(body.ok, true);
  const via = await deviceKey({ store: "shell", invoke });
  assert.equal(via.source, "shell");
  assert.equal(calls, 2);
});
