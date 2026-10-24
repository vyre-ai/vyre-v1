// Relay fuzz tests. The 0.6 suite targeted Node 22. This file targets Node 24.
// Types: "relay/client/index.d.ts"
import test from "node:test";
import assert from "node:assert/strict";
import {
  b64,
  fromB64,
  utf8,
  utf8Decode,
  WORDS,
  entropyToWords,
  wordsToEntropy,
  generateSeed,
  createInitiator,
  createResponder,
  connect,
  RelaySocket,
  generateAgreementKey,
  HEARTBEAT_MS,
} from "../index.js";

test("targets Node 24", () => {
  const major = Number(process.versions.node.split(".")[0]);
  assert.equal(major, 24);
});

test("base64 round-trips the standard vectors", () => {
  const vectors = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];
  for (const [text, encoded] of vectors) {
    assert.equal(b64(utf8(text)), encoded);
    assert.equal(utf8Decode(fromB64(encoded)), text);
  }
  for (let n = 0; n < 64; n++) {
    const raw = crypto.getRandomValues(new Uint8Array(n));
    assert.deepEqual(fromB64(b64(raw)), raw);
  }
});

async function agreement() {
  return generateAgreementKey();
}

async function handshake() {
  const local = await agreement();
  const remote = await agreement();
  const prologue = utf8("fingerprint");
  const responder = await createResponder({
    localPrivate: remote.privateKey,
    localPublic: remote.publicKey,
    prologue,
  });
  const initiator = await createInitiator({
    localPrivate: local.privateKey,
    localPublic: local.publicKey,
    remotePublic: remote.publicKey,
    prologue,
  });
  assert.equal(initiator.message1.length, 96);
  const read = await responder.read(initiator.message1);
  assert.equal(read.message2.length, 48);
  assert.deepEqual(read.remotePublic, local.publicKey);
  const session = await initiator.finish(read.message2);
  return { initiator: session, responder: read.session, local, remote, prologue, responderBox: responder };
}

test("noise fuzz: random payloads round-trip and a flipped tag is rejected", async () => {
  const { initiator, responder } = await handshake();
  for (let i = 0; i < 24; i++) {
    const ab = crypto.getRandomValues(new Uint8Array(i * 7));
    const ba = crypto.getRandomValues(new Uint8Array((i * 5) % 200));
    assert.deepEqual(await responder.recv(await initiator.send(ab)), ab);
    assert.deepEqual(await initiator.recv(await responder.send(ba)), ba);
  }
  const { initiator: a, responder: b } = await handshake();
  const plain = utf8("catch-up");
  const ct = await a.send(plain);
  const bad = new Uint8Array(ct);
  bad[bad.length - 1] ^= 0xff;
  await assert.rejects(() => b.recv(bad), /decrypt/);
  assert.deepEqual(await b.recv(ct), plain);
});

test("noise fuzz: truncated and random handshakes fail cleanly", async () => {
  const remote = await agreement();
  const prologue = utf8("fingerprint");
  for (const len of [0, 1, 32, 95, 97, 200]) {
    const box = await createResponder({
      localPrivate: remote.privateKey,
      localPublic: remote.publicKey,
      prologue,
    });
    const junk = crypto.getRandomValues(new Uint8Array(len));
    await assert.rejects(() => box.read(junk), (err) => {
      assert.equal(err.name, "NoiseError");
      return true;
    });
  }
  const box = await createResponder({
    localPrivate: remote.privateKey,
    localPublic: remote.publicKey,
    prologue,
  });
  await assert.rejects(() => box.read(crypto.getRandomValues(new Uint8Array(96))), /decrypt|handshake/);
});

test("seed word fuzz: entropy round-trips and a flipped checksum is rejected", async () => {
  assert.equal(WORDS.length, 2048);
  for (const size of [16, 32]) {
    const zeros = new Uint8Array(size);
    const phrase = await entropyToWords(zeros);
    assert.deepEqual(await wordsToEntropy(phrase), zeros);
    const parts = phrase.split(" ");
    const last = WORDS.indexOf(parts[parts.length - 1]);
    parts[parts.length - 1] = WORDS[last ^ 1];
    await assert.rejects(() => wordsToEntropy(parts.join(" ")), /bad checksum/);
    for (let i = 0; i < 16; i++) {
      const entropy = crypto.getRandomValues(new Uint8Array(size));
      const words = await entropyToWords(entropy);
      assert.equal(words.split(" ").length, size === 16 ? 12 : 24);
      assert.deepEqual(await wordsToEntropy(words), entropy);
    }
  }
  const generated = await generateSeed(12);
  assert.equal(generated.split(" ").length, 12);
  const generated24 = await generateSeed(24);
  assert.equal((await wordsToEntropy(generated24)).length, 32);
  const parts = generated.split(" ");
  parts[0] = "notaword";
  await assert.rejects(() => wordsToEntropy(parts.join(" ")), /unknown seed word/);
  await assert.rejects(() => wordsToEntropy("baba"), /12 or 24/);
  await assert.rejects(() => entropyToWords(new Uint8Array(15)), /16 or 32/);
  await assert.rejects(() => generateSeed(15), /12 or 24/);
});

test("frame fuzz: split writes reassemble and a zero length is rejected", () => {
  const payload = crypto.getRandomValues(new Uint8Array(80));
  const frame = RelaySocket.encode(2, payload);
  const sock = new RelaySocket();
  let offset = 0;
  while (offset < frame.length) {
    const n = 1 + (frame[offset] % 5);
    sock.push(frame.subarray(offset, Math.min(frame.length, offset + n)));
    offset += n;
  }
  const got = sock.drain();
  assert.equal(got.length, 1);
  assert.equal(got[0].type, 2);
  assert.deepEqual(got[0].payload, payload);
  assert.throws(() => new RelaySocket().push(new Uint8Array([0, 0, 0])), /frame/);
  for (let i = 0; i < 30; i++) {
    const junk = crypto.getRandomValues(new Uint8Array(48));
    const trial = new RelaySocket();
    try {
      trial.push(junk);
      trial.drain();
    } catch (err) {
      assert.equal(err.name, "RelayError");
    }
  }
});

test("heartbeat is 15 seconds and events catch up by number", async () => {
  const { initiator, responder, local, remote, prologue } = await handshake();
  const box = await createResponder({
    localPrivate: remote.privateKey,
    localPublic: remote.publicKey,
    prologue,
  });
  let remoteSession = null;
  const connection = await connect({
    localPrivate: local.privateKey,
    localPublic: local.publicKey,
    remotePublic: remote.publicKey,
    prologue,
    exchange: async (message1) => {
      const read = await box.read(message1);
      remoteSession = read.session;
      return read.message2;
    },
  });
  assert.equal(connection.heartbeatMs, HEARTBEAT_MS);
  assert.ok(connection.tick(0));
  assert.equal(connection.tick(14999), null);
  assert.ok(connection.tick(15000));
  connection.pushEvent("doc.updated", { id: "rec_1" });
  connection.pushEvent("doc.updated", { id: "rec_2" });
  connection.pushEvent("doc.updated", { id: "rec_3" });
  assert.deepEqual(connection.catchUp(1).map((ev) => ev.n), [2, 3]);
  connection.deliver = async (ct) => {
    const plain = await remoteSession.recv(ct);
    return remoteSession.send(plain);
  };
  const echoed = await connection.request("POST", "/sync", { cursor: 1 });
  assert.equal(echoed.method, "POST");
  assert.equal(echoed.path, "/sync");
  assert.deepEqual(echoed.body, { cursor: 1 });
  assert.ok(initiator);
  assert.ok(responder);
});
