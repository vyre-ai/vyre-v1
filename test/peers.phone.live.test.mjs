// The phone reaches any awake computer of a Personal Space (lane l-multidevice, increment 4). Two booted daemons linked to the relay Worker itself, run on the fake Workers runtime
// (relay/worker/fake-cf.js), and a phone stand-in that does what relay/client/shell does: read /__vyre/info.json, then open the end-to-end channel to the route it names, pinned to the box key
// from the person's own link. A claims alex-phone.vyre.run and tells the relay its other computer; the phone reaches A; with A asleep it reaches B under the same pin; with both asleep the page
// says so and lists both, with when each was last seen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import worker, * as W from "../relay/worker/index.js";
import { createRuntime } from "../relay/worker/fake-cf.js";
import { forgetUnclaimed } from "../relay/worker/phone.js";
import { openChannel, request } from "../relay/client/client.js";
import { webCrypto } from "../relay/client/webcrypto.js";
import { OWNER, boot, call, pause, seededDir, stageSecond } from "./peers-kit.mjs";

const RELAY = "ws://relay.test";
const fromB64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));

function relayWorld() {
  forgetUnclaimed();
  return createRuntime({
    worker, Class: W.RouteRelay, classes: { TICKETS: W.PairTicket, CODES: W.CodeSlot, SIGNIN: W.SigninSlot, HOSTS: W.HostSlot },
    env: {
      NAMES_FETCH: async (u) => new Response(JSON.stringify({ data: { name: new URL(u).searchParams.get("name"), status: "ok" } }), { status: 200 }),
      DOH_FETCH: async (u) => new Response(JSON.stringify({ Status: 0, Answer: [{ name: new URL(u).searchParams.get("name"), type: 1, data: "104.21.25.72" }] }), { status: 200 }),
      ORIGIN_FETCH: async () => new Response("origin", { status: 200 }),
      ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    },
  });
}

/** The phone: what the shell's service worker does for one request. */
async function phone(rt, box, p) {
  const info = await (await rt.fetch("https://alex-phone.vyre.run/__vyre/info.json")).json();
  const crypto = webCrypto();
  const { channel } = await openChannel({ relay: RELAY, route: info.route, box, keys: await crypto.generateKeyPair(), crypto, WebSocket: rt.WebSocket, hello: { v: 1, kind: "web" }, timeout: 8_000 });
  try {
    const res = await request(channel, { method: "POST", path: p, headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` } }, new TextEncoder().encode(JSON.stringify({ idempotencyKey: `ph-${Math.random()}` })));
    return { route: info.route, status: res.status, body: JSON.parse(await res.text()) };
  } finally { channel.close(1000, "done"); }
}

test("the phone reaches whichever computer is awake under one pin, and the asleep page lists every computer", { timeout: 60_000 }, async () => {
  const rt = relayWorld();
  let A = null, B = null;
  try {
    const dirA = seededDir();
    A = await boot(dirA, ["--relay", RELAY, "--peer-name", "Office iMac"], { seams: { relayWebSocket: rt.WebSocket } });
    A.db.run("INSERT INTO identity_accounts (person_id, username, name, verifier, keys_json, created_at) VALUES ('usr_olivia', 'olivia', 'Olivia', 'v', '{}', 1)");
    await A.peers.tick();
    const { dirB } = await stageSecond(A, dirA);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", RELAY, "--peer-name", "Home laptop"], { seams: { relayWebSocket: rt.WebSocket } });
    await B.peers.tick();
    const routeA = A.db.all("SELECT route FROM network_peer WHERE name = 'Office iMac'")[0].route;
    const routeB = A.db.all("SELECT route FROM network_peer WHERE name = 'Home laptop'")[0].route;

    // A claims the phone address and tells the relay about B
    const claimed = await call(A, "/v1/network/phone_claim", { name: "alex-phone", nickname: "Office iMac" });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    await A.pollCommands();
    for (let i = 0; i < 50 && A.db.all("SELECT state FROM network_phone WHERE id = 1")[0]?.state !== "claimed"; i++) { await pause(50); await A.pollCommands(); }
    assert.equal(A.db.all("SELECT state FROM network_phone WHERE id = 1")[0]?.state, "claimed");
    await A.peers.tick();
    await rt.settle();

    // the person's own link pins the Space's box key, the same on both computers
    const box = fromB64u(JSON.parse(fs.readFileSync(path.join(dirA, "relay.key"), "utf8")).boxPub);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dirB, "relay.key"), "utf8")).boxPub, JSON.parse(fs.readFileSync(path.join(dirA, "relay.key"), "utf8")).boxPub);

    const viaA = await phone(rt, box, "/v1/network/peers");
    assert.equal(viaA.route, routeA, "both awake: the name's own computer");
    assert.equal(viaA.status, 200, JSON.stringify(viaA.body));
    assert.equal(viaA.body.data.computers.find((c) => c.self).name, "Office iMac");

    // A sleeps: the phone goes to B, under the same pin
    await A.stop(); A = null;
    await rt.settle();
    const page = await rt.fetch("https://alex-phone.vyre.run/");
    assert.equal(page.status, 200, "the shell opens: another computer is awake");
    const viaB = await phone(rt, box, "/v1/network/peers");
    assert.equal(viaB.route, routeB, "the phone dials the computer that is awake");
    assert.equal(viaB.status, 200, JSON.stringify(viaB.body));
    assert.equal(viaB.body.data.computers.find((c) => c.self).name, "Home laptop");

    // both asleep: one honest page, every computer and when each was last seen
    await B.stop(); B = null;
    await rt.settle();
    const asleep = await rt.fetch("https://alex-phone.vyre.run/");
    assert.equal(asleep.status, 503);
    const html = await asleep.text();
    assert.match(html, /Your computers are asleep/);
    assert.match(html, /Office iMac: last seen just now/);
    assert.match(html, /Home laptop: last seen just now/);
  } finally {
    await B?.stop();
    await A?.stop();
  }
});
