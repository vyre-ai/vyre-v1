// @ts-check
// The setup page's half of the setup session (setup.js) and its own channel to the server it sets up (setupchannel.js). The relay and the
// server are the test box and a fake fetch; the cryptography is checked against independent WebCrypto calls written from the file's own description.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createSetupKey, setupFingerprint, setupCode, parseSetupCode, setupDerive, resolveSetup, setupHello, setupWords, openMailboxLine, mailboxReader, plainText, SETUP_CODE_LEN,
} from "../setup.js";
import { connectSetup } from "../setupchannel.js";
import { openChannel, request } from "../client.js";
import { webCrypto } from "../webcrypto.js";
import { WORDS } from "../words.js";
import { base64url, concat, fromBase64url, fromUtf8, utf8 } from "../bytes.js";
import { crypto, fakeFetch, memoryBox, ROUTE, serveWith, ticketRecord } from "./box.js";

const subtle = globalThis.crypto.subtle;
const SECRET = Uint8Array.from({ length: 16 }, (_, i) => 40 + i);
const sha = async (/** @type {Uint8Array} */ b) => new Uint8Array(await subtle.digest("SHA-256", b));
const code = async (/** @type {() => Promise<unknown>} */ fn) => { try { await fn(); } catch (e) { return /** @type {any} */ (e).code; } return "none"; };

test("setup key: P-256, the private half cannot be read, and the code is the secret and the key's fingerprint", async () => {
  const key = await createSetupKey();
  assert.equal(key.spki.length, 91, "a P-256 SPKI");
  assert.equal(key.privateKey.extractable, false);
  await assert.rejects(subtle.exportKey("pkcs8", key.privateKey));
  const fp = await setupFingerprint(key.spki);
  assert.deepEqual(fp, (await sha(concat(utf8("vyre-setup-key\n"), key.spki))).slice(0, 16));
  const c = await setupCode(SECRET, key.spki);
  assert.equal(c.length, SETUP_CODE_LEN);
  assert.deepEqual(fromBase64url(c), concat(SECRET, fp));
  const parsed = parseSetupCode(c);
  assert.deepEqual(parsed?.secret, SECRET);
  assert.deepEqual(parsed?.fp, fp);
  await assert.rejects(setupCode(new Uint8Array(15), key.spki), e => /** @type {any} */ (e).code === "bad_input");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // the last character of a 32-byte base64url code carries two unused bits: a spelling that sets them is not the canonical code
  const sloppy = c.slice(0, -1) + alphabet[alphabet.indexOf(c.slice(-1)) + 1];
  for (const bad of ["", c.slice(1), c + "A", c.replace(/.$/, "!"), /** @type {any} */ (null), sloppy]) assert.equal(parseSetupCode(bad), null, String(bad));
});

test("setup derive: the relay sees a locator and a mailbox write key, and every key has its own tag", async () => {
  const d = await setupDerive(SECRET);
  const tagged = (/** @type {string} */ tag) => sha(concat(utf8(`${tag}\n`), SECRET));
  assert.deepEqual(d.loc, await tagged("vyre-pair-loc"));
  assert.deepEqual(d.sec, await tagged("vyre-pair-sec"));
  assert.deepEqual(d.mac, await tagged("vyre-pair-mac"));
  assert.deepEqual(d.enc, await tagged("vyre-pair-enc"));
  assert.deepEqual(d.mbxw, await tagged("vyre-setup-mbx-w"));
  assert.deepEqual(d.mbxenc, await tagged("vyre-setup-mbx-enc"));
  assert.deepEqual(d.mbxmac, await tagged("vyre-setup-mbx-mac"));
  assert.equal(new Set(Object.values(d).map(base64url)).size, 7, "no two derived keys are the same");
});

test("resolveSetup: the secret stands in for a ticket, so the box's sealed offer opens with it", async () => {
  const box = await crypto.generateKeyPair();
  const rec = await ticketRecord(crypto, SECRET, { v: 1, relay: "wss://relay.test", route: ROUTE, box: base64url(box.publicKey), name: "new server", exp: Date.now() + 60_000 });
  const found = await resolveSetup(SECRET, { relay: "wss://relay.test", crypto, fetch: fakeFetch(new Map([[rec.loc, { record: rec.record, mac: rec.mac }]])) });
  assert.equal(found.name, "new server");
  assert.deepEqual(found.offer.box, box.publicKey);
  assert.equal(found.offer.secret, base64url((await setupDerive(SECRET)).sec), "the pairing secret is the derived one");
  assert.equal(rec.loc, base64url((await setupDerive(SECRET)).loc));
  const contested = async () => ({ status: 409, ok: false, json: async () => ({}) });
  assert.equal(await code(() => resolveSetup(SECRET, { relay: "wss://relay.test", crypto, fetch: contested })), "contested");
});

test("setup hello: signed with the page key over the route and this handshake's static key", async () => {
  const key = await createSetupKey();
  const noiseStatic = new Uint8Array(32).fill(6);
  const hello = await setupHello({ ...key, route: ROUTE, noiseStatic, secret: SECRET });
  assert.equal(hello.v, 1);
  assert.equal(hello.name, "setup page");
  assert.equal(hello.setup.key, base64url(key.spki));
  assert.equal(hello.pair, base64url((await setupDerive(SECRET)).sec));
  const pub = await subtle.importKey("spki", key.spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verify = (/** @type {Uint8Array} */ msg) => subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromBase64url(hello.setup.sig), msg);
  assert.equal(await verify(concat(utf8(`vyre-setup-hello\n${ROUTE}\n`), noiseStatic)), true);
  assert.equal(await verify(concat(utf8(`vyre-setup-hello\n${ROUTE}\n`), new Uint8Array(32).fill(7))), false, "a hello from another Noise key does not verify");
  assert.equal(await verify(concat(utf8("vyre-setup-hello\nother\n"), noiseStatic)), false, "nor for another route");
  const later = await setupHello({ ...key, route: ROUTE, noiseStatic, name: "Alex's laptop" });
  assert.equal(later.name, "Alex's laptop");
  assert.equal("pair" in later, false, "the pairing secret rides on the first connection only");
});

test("setup words: four words of the box's key and the secret, the same on the box's screen", async () => {
  const boxStatic = new Uint8Array(32).fill(2);
  const words = await setupWords(boxStatic, SECRET);
  assert.equal(words.length, 4);
  const h = await sha(concat(utf8("vyre-setup-words\n"), boxStatic, SECRET));
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits = bits * 256n + BigInt(h[i]);
  const want = [0n, 1n, 2n, 3n].map(i => WORDS[Number((bits >> (37n - 11n * i)) & 2047n)]);
  assert.deepEqual(words, want);
  assert.notDeepEqual(words, await setupWords(new Uint8Array(32).fill(3), SECRET));
  assert.notDeepEqual(words, await setupWords(boxStatic, new Uint8Array(16)));
});

/** One mailbox line as the install script makes it: base64url(iv16 || AES-CTR ciphertext || HMAC(seq || iv || ciphertext)). */
async function seal(/** @type {Awaited<ReturnType<typeof setupDerive>>} */ keys, /** @type {number} */ seq, /** @type {string} */ text) {
  const iv = new Uint8Array(16).fill(seq + 1);
  const ck = await subtle.importKey("raw", keys.mbxenc, { name: "AES-CTR" }, false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-CTR", counter: iv, length: 128 }, ck, utf8(text)));
  const sb = new Uint8Array(4);
  new DataView(sb.buffer).setUint32(0, seq);
  const hk = await subtle.importKey("raw", keys.mbxmac, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle.sign("HMAC", hk, concat(sb, iv, ct)));
  return base64url(concat(iv, ct, mac));
}

test("mailbox lines: only an untampered line at its own position opens, and it opens as plain text", async () => {
  const keys = await setupDerive(SECRET);
  const line = await seal(keys, 0, "Installing Docker, step one of five");
  assert.equal(await openMailboxLine(keys, 0, line), "Installing Docker, step one of five");
  assert.equal(await openMailboxLine(keys, 1, line), null, "the same line at another position");
  const raw = fromBase64url(line);
  for (const at of [0, 20, raw.length - 1]) {
    const bent = raw.slice();
    bent[at] ^= 1;
    assert.equal(await openMailboxLine(keys, 0, base64url(bent)), null, `byte ${at}`);
  }
  assert.equal(await openMailboxLine(keys, 0, base64url(raw.slice(0, 40))), null, "too short");
  assert.equal(await openMailboxLine(keys, 0, "!!"), null, "not base64url");
  assert.equal(await openMailboxLine({ ...keys, mbxmac: new Uint8Array(32) }, 0, line), null, "another secret");
  const sneaky = await seal(keys, 2, "ok‮\u0000​done");
  assert.equal(await openMailboxLine(keys, 2, sneaky), "okdone", "bidi, control and zero-width characters are removed");
  assert.equal(plainText("x".repeat(2000)).length, 1024);
});

/** The relay's mailbox: serves lines after a position to a reader whose signature verifies, as the worker does. */
function mailbox(/** @type {{ lines: { i: number, line: string }[], status?: number }} */ state, /** @type {Uint8Array} */ spki) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const calls = [];
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, headers: init.headers });
    if (state.status) return { status: state.status, ok: false, json: async () => ({}) };
    const u = new URL(url);
    const loc = u.searchParams.get("loc") ?? "", after = Number(u.searchParams.get("after"));
    const pub = await subtle.importKey("spki", fromBase64url(init.headers["x-vyre-setup-key"]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const okSig = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromBase64url(init.headers["x-vyre-setup-sig"]), utf8(`vyre-setup-read\n${loc}\n${init.headers["x-vyre-setup-ts"]}\n${after}`));
    if (!okSig || init.headers["x-vyre-setup-key"] !== base64url(spki)) return { status: 401, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => ({ lines: state.lines.filter(l => !l || l.i >= after) }) };
  };
  return { fetch, calls };
}

test("mailbox reader: signs each long poll, checks each line in order, and stops on anything wrong", async () => {
  const key = await createSetupKey();
  const keys = await setupDerive(SECRET);
  const state = { lines: [{ i: 0, line: await seal(keys, 0, "Checking the disk") }, { i: 1, line: await seal(keys, 1, "Pulling images") }], status: 0 };
  const relay = mailbox(state, key.spki);
  const reader = await mailboxReader({ relay: "wss://relay.test", secret: SECRET, key, fetch: relay.fetch, now: () => 1234 });
  assert.deepEqual(await reader.next(), ["Checking the disk", "Pulling images"]);
  assert.equal(reader.seq, 2);
  const first = new URL(relay.calls[0].url);
  assert.equal(first.origin + first.pathname, "https://relay.test/v1/setup/mbx");
  assert.equal(first.searchParams.get("loc"), base64url(keys.loc));
  assert.equal(first.searchParams.get("after"), "0");
  assert.equal(first.searchParams.get("wait"), "20");
  assert.equal(relay.calls[0].headers["x-vyre-setup-ts"], "1234");
  state.lines.push({ i: 2, line: await seal(keys, 2, "Done") });
  assert.deepEqual(await reader.next(5), ["Done"]);
  assert.equal(new URL(relay.calls[1].url).searchParams.get("after"), "2");
  assert.equal(new URL(relay.calls[1].url).searchParams.get("wait"), "5");
  assert.deepEqual(await reader.next(), [], "nothing new after the long poll");

  const read = async (/** @type {{ lines: any[], status?: number }} */ s) => {
    const r = await mailboxReader({ relay: "wss://relay.test", secret: SECRET, key, fetch: mailbox({ status: 0, ...s }, key.spki).fetch });
    return code(() => r.next());
  };
  assert.equal(await read({ lines: [{ i: 1, line: await seal(keys, 1, "skipped one") }] }), "out_of_order");
  assert.equal(await read({ lines: [{ i: 0, line: await seal(keys, 5, "wrong position") }] }), "bad_line");
  assert.equal(await read({ lines: [null] }), "out_of_order");
  assert.equal(await read({ lines: [], status: 409 }), "contested");
  assert.equal(await read({ lines: [], status: 401 }), "unauthorized");
  assert.equal(await read({ lines: [], status: 429 }), "rate_limited");
  assert.equal(await read({ lines: [], status: 503 }), "mailbox_failed");
  // another page key: the relay's signature check fails and the reader reports it
  const stranger = await createSetupKey();
  const impostor = await mailboxReader({ relay: "wss://relay.test", secret: SECRET, key: stranger, fetch: mailbox({ lines: [], status: 0 }, key.spki).fetch });
  assert.equal(await code(() => impostor.next()), "unauthorized");
});

test("setup channel: the page's own connection to the server, admitted only for the page's key", async () => {
  const box = await crypto.generateKeyPair();
  const key = await createSetupKey();
  /** @type {any[]} */
  const events = [{ id: 1, type: "setup.step", payload: { n: 1 } }];
  let eventReads = 0;
  /** @type {string[]} */
  const seen = [];
  const relay = memoryBox({
    box,
    admit: async (pub, hello) => {
      const verifyKey = await subtle.importKey("spki", fromBase64url(hello.setup.key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, fromBase64url(hello.setup.sig), concat(utf8(`vyre-setup-hello\n${ROUTE}\n`), pub));
      if (!ok || hello.setup.key !== base64url(key.spki)) throw new Error("not the page that made the code");
      seen.push(hello.pair);
      return { v: 1, box: { name: "new server" }, device: "setup1" };
    },
    serve: serveWith((s, head, body) => {
      const say = (/** @type {number} */ status, /** @type {any} */ json) => { s.ch.respond(s, { status, headers: { "content-type": "application/json" } }); s.write(utf8(JSON.stringify(json))); s.end(); };
      if (head.path === "/v1/tools/setup.finish") return say(403, { error: { code: "setup_over", message: "The setup session is over." } });
      if (head.path.startsWith("/v1/tools/")) return say(200, { data: { tool: decodeURIComponent(head.path.slice("/v1/tools/".length)), input: JSON.parse(fromUtf8(body)) } });
      if (head.path.startsWith("/v1/events?")) {
        eventReads++;
        const q = new URL(`http://x${head.path}`).searchParams;
        return say(200, { data: events.filter(e => e.type === q.get("type") && e.id > Number(q.get("since"))) });
      }
      return say(404, {});
    }),
  });
  const lib = { openChannel, request, setupHello, webCrypto, utf8 };
  const offer = { relay: "wss://relay.test", route: ROUTE, box: box.publicKey };
  const chan = await connectSetup(lib, { offer, key, secret: SECRET, WebSocket: relay.WebSocket });
  assert.equal(seen[0], base64url((await setupDerive(SECRET)).sec), "the first connection carries the pairing secret");
  assert.deepEqual(await chan.call("setup.check", { disk: true }), { tool: "setup.check", input: { disk: true } });
  assert.deepEqual(await chan.call("a/b"), { tool: "a/b", input: {} }, "tool names are encoded into the path");
  await assert.rejects(chan.call("setup.finish"), e => /** @type {any} */ (e).code === "setup_over" && /** @type {any} */ (e).status === 403 && /over/.test(/** @type {Error} */ (e).message));
  assert.deepEqual(await chan.events("setup.step", 0), [{ id: 1, type: "setup.step", payload: { n: 1 } }]);
  assert.deepEqual(await chan.events("setup.step", 1), []);
  assert.deepEqual(await chan.events("other", -5), []);

  /** @type {any[]} */
  const heard = [];
  let ended = /** @type {Error | null | undefined} */ (undefined);
  const readsBefore = eventReads;
  const stop = chan.follow("setup.step", e => heard.push(e.id), err => { ended = err; }, 5);
  while (eventReads === readsBefore) await new Promise(r => setTimeout(r, 2));   // follow has taken its starting point
  events.push({ id: 2, type: "setup.step", payload: { n: 2 } });
  for (let i = 0; i < 200 && heard.length < 1; i++) await new Promise(r => setTimeout(r, 5));
  stop();
  assert.deepEqual(heard, [2], "only events after the follow began");
  assert.equal(ended, undefined);

  let closedWith = "";
  chan.onClose(reason => { closedWith = reason; });
  chan.close();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(closedWith, "done");
  assert.doesNotThrow(() => chan.close());

  // another page's key is not admitted
  const stranger = await createSetupKey();
  await assert.rejects(connectSetup(lib, { offer, key: stranger, secret: SECRET, WebSocket: relay.WebSocket, timeout: 2000 }), /not the page that made the code/);
});
