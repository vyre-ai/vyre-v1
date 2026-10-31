// @ts-check
// Phone access on the relay Worker (relay/worker/phone.js) against the fake Workers runtime: a box claims <name>.vyre.run over its control socket, the gateway answers the
// name with the shell, "is asleep" while the box is offline, and the old redirect for a name nobody claimed here.

import test from "node:test";
import assert from "node:assert/strict";
import worker, * as W from "../index.js";
import { createRuntime } from "../fake-cf.js";
import { forgetUnclaimed } from "../phone.js";
import * as wire from "./wire.js";

const { newRouteKey, routeId, authMessage, signRoute } = wire;

/** @param {any} t @param {{ hibernateEveryEvent?: boolean, names?: (name: string) => string | Error, dns?: (name: string) => boolean | Error, wildcard?: boolean }} [o] */
function world(t, o = {}) {
  forgetUnclaimed();
  const asked = /** @type {string[]} */ ([]);
  const rt = createRuntime({
    worker, Class: W.RouteRelay, classes: { TICKETS: W.PairTicket, CODES: W.CodeSlot, SIGNIN: W.SigninSlot, HOSTS: W.HostSlot }, hibernateEveryEvent: o.hibernateEveryEvent,
    env: {
      NAMES_FETCH: async (/** @type {string} */ u) => {
        const name = new URL(u).searchParams.get("name") || "";
        asked.push(name);
        const v = (o.names || (() => "ok"))(name);
        if (v instanceof Error) throw v;
        return new Response(JSON.stringify({ data: { name, status: v } }), { status: 200 });
      },
      // live DNS: a name with an A or CNAME record of its own is a real host
      DOH_FETCH: async (/** @type {string} */ u) => {
        const q = new URL(u).searchParams.get("name") || "";
        const label = q.split(".")[0] || "";
        const v = label.startsWith("zz-") ? false : (o.dns || (() => false))(label);
        if (v instanceof Error) throw v;
        // with the proxied wildcard in place every name, claimed or not, gets the zone's proxy addresses; only a host with an address of its own differs
        const proxied = o.wildcard === false ? [] : [{ name: q, type: 1, data: "104.21.25.72" }, { name: q, type: 1, data: "172.67.223.243" }];
        return new Response(JSON.stringify({ Status: 0, ...(v ? { Answer: [{ name: q, type: 1, data: "203.0.113.9" }] } : proxied.length ? { Answer: proxied } : {}) }), { status: 200 });
      },
      // the host's own origin, for names no route holds
      ORIGIN_FETCH: async (/** @type {Request} */ r) => new Response(`origin of ${new URL(r.url).hostname}`, { status: r.url.includes("down.") ? 522 : 200 }),
      ASSETS: { fetch: async (/** @type {Request} */ r) => {
        const p = new URL(r.url).pathname;
        return p === "/__vyre/boot.js" ? new Response("boot()", { headers: { "content-type": "text/javascript" } }) : p === "/__vyre/sw.js" ? new Response("sw()", { headers: { "content-type": "application/octet-stream" } }) : new Response(null, { status: 404 });
      } },
    },
  });
  t.after(async () => { await rt.settle(); assert.deepEqual(rt.errors.map(String), [], "no errors inside the Worker"); });
  return Object.assign(rt, { asked });
}

function sock(rt, path) {
  const ws = new rt.WebSocket(`ws://relay.test${path}`);
  ws.binaryType = "arraybuffer";
  const queue = [], waiters = [];
  ws.onmessage = e => { const v = typeof e.data === "string" ? e.data : Buffer.from(e.data); const w = waiters.shift(); w ? w(v) : queue.push(v); };
  return {
    ws,
    open: () => new Promise((res, rej) => { ws.onopen = () => res(undefined); ws.onerror = rej; }),
    next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(res => waiters.push(res)),
    json: async function () { return JSON.parse(String(await this.next())); },
  };
}

/** A box that has signed its route and been told it is ready. */
async function box(rt) {
  const key = newRouteKey(), route = routeId(key.pub);
  const s = sock(rt, `/v1/box?route=${route}`);
  await s.open();
  const ch = await s.json();
  s.ws.send(JSON.stringify({ t: "auth", pub: key.pub.toString("base64url"), sig: signRoute(key.priv, authMessage(route, Buffer.from(ch.n, "base64url"))).toString("base64url") }));
  assert.equal((await s.json()).t, "ready");
  const say = async (/** @type {any} */ m) => { s.ws.send(JSON.stringify(m)); return s.json(); };
  return { s, route, say, close: () => s.ws.close(1000, "bye") };
}

for (const hibernateEveryEvent of [false, true]) {
  const mode = hibernateEveryEvent ? " (hibernating after every event)" : "";

  test(`a box claims a name once, and only its own route can hold it${mode}`, async t => {
    const rt = world(t, { hibernateEveryEvent });
    const a = await box(rt), b = await box(rt);
    assert.deepEqual(await a.say({ t: "host.status" }), { t: "host", op: "status", status: "none" });
    assert.deepEqual(await a.say({ t: "host.claim", name: "alex-phone", label: "Home laptop" }), { t: "host", op: "claim", status: "claimed", name: "alex-phone", label: "Home laptop" });
    assert.deepEqual(rt.asked, ["alex-phone"]);
    // the same route says it again: still its own, the directory is not asked twice
    assert.equal((await a.say({ t: "host.claim", name: "alex-phone", label: "Home laptop" })).status, "claimed");
    assert.deepEqual(rt.asked, ["alex-phone"]);
    assert.equal((await a.say({ t: "host.status" })).name, "alex-phone");
    // another route is told the name is taken, and the directory is not even asked
    assert.equal((await b.say({ t: "host.claim", name: "alex-phone" })).status, "taken");
    assert.deepEqual(rt.asked, ["alex-phone"]);
    // one name per route until it is released
    assert.deepEqual(await a.say({ t: "host.claim", name: "other-name" }), { t: "host", op: "claim", status: "has_name", name: "alex-phone" });
  });

  test(`a released name is a tombstone: only the route that held it can take it back${mode}`, async t => {
    const rt = world(t, { hibernateEveryEvent });
    const a = await box(rt), b = await box(rt);
    await a.say({ t: "host.claim", name: "alex-phone", label: "Home laptop" });
    assert.equal((await a.say({ t: "host.release" })).status, "released");
    assert.equal((await a.say({ t: "host.status" })).status, "none");
    assert.equal((await b.say({ t: "host.claim", name: "alex-phone" })).status, "taken", "never reassigned");
    // the gateway no longer serves it: the request goes to the host's own origin
    assert.equal(await (await rt.fetch("https://alex-phone.vyre.run/")).text(), "origin of alex-phone.vyre.run");
    // the holder takes it back, or picks another name
    assert.equal((await a.say({ t: "host.claim", name: "alex-phone", label: "Laptop" })).status, "claimed");
    assert.equal((await a.say({ t: "host.release" })).status, "released");
    assert.equal((await a.say({ t: "host.claim", name: "second-name" })).status, "claimed");
  });
}

test("the names directory decides a new name: taken, reserved, invalid and silent all refuse", async t => {
  const rt = world(t, { names: n => n === "taken-one" ? "taken" : n === "reserved-one" ? "reserved" : n === "silent-one" ? new Error("down") : "ok" });
  const a = await box(rt);
  assert.equal((await a.say({ t: "host.claim", name: "taken-one" })).status, "taken");
  assert.equal((await a.say({ t: "host.claim", name: "reserved-one" })).status, "reserved");
  assert.equal((await a.say({ t: "host.claim", name: "silent-one" })).status, "unavailable", "fails closed");
  for (const bad of ["a", "Bad Name", "-lead", "relay", "names", "x".repeat(40), "emoji-\u{1F600}"]) assert.equal((await a.say({ t: "host.claim", name: bad })).status, "invalid", bad);
  assert.equal((await a.say({ t: "host.status" })).status, "none", "nothing was kept");
  assert.equal((await a.say({ t: "host.claim", name: "fine-one" })).status, "claimed");
});

test("a route claims at most ten times a day", async t => {
  const rt = world(t, { names: () => "taken" });
  const a = await box(rt);
  for (let i = 0; i < 10; i++) assert.equal((await a.say({ t: "host.claim", name: `try-${i}-name` })).status, "taken");
  assert.equal((await a.say({ t: "host.claim", name: "try-last-name" })).status, "limited");
});

test("the gateway: the shell while the box is online, '<nickname> is asleep' while it is not", async t => {
  const rt = world(t);
  const a = await box(rt);
  await a.say({ t: "host.claim", name: "alex-phone", label: "Home <laptop> ‮" });
  const shell = await rt.fetch("https://alex-phone.vyre.run/some/page?x=1");
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert.match(html, /<script src="\/__vyre\/boot\.js"><\/script>/);
  assert.match(html, /Home &lt;laptop&gt;/, "the nickname is escaped and stripped of bidi marks");
  assert.doesNotMatch(html, /‮/);
  const csp = shell.headers.get("content-security-policy") || "";
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self' wss:\/\/relay\.vyre\.run/);
  assert.equal(shell.headers.get("cache-control"), "no-store");
  const info = await (await rt.fetch("https://alex-phone.vyre.run/__vyre/info.json")).json();
  assert.deepEqual(info, { name: "alex-phone", label: "Home <laptop>", route: a.route, relay: "wss://relay.vyre.run", online: true });
  // assets: found, the service worker may scope the origin, a missing file is a plain 404, and a write is refused
  assert.equal(await (await rt.fetch("https://alex-phone.vyre.run/__vyre/boot.js")).text(), "boot()");
  const sw = await rt.fetch("https://alex-phone.vyre.run/__vyre/sw.js");
  assert.equal(sw.headers.get("service-worker-allowed"), "/");
  assert.match(sw.headers.get("content-type") || "", /javascript/);
  assert.equal((await rt.fetch("https://alex-phone.vyre.run/__vyre/nope.js")).status, 404);
  // the box goes away: asleep, with a retry hint; the shell's own info says offline
  a.close();
  await rt.settle();
  const asleep = await rt.fetch("https://alex-phone.vyre.run/");
  assert.equal(asleep.status, 503);
  assert.equal(asleep.headers.get("retry-after"), "20");
  assert.match(await asleep.text(), /Home &lt;laptop&gt; is asleep/);
  assert.equal((await (await rt.fetch("https://alex-phone.vyre.run/__vyre/info.json")).json()).online, false);
});

test("the gateway leaves every host no route holds alone: the request goes to its own origin untouched", async t => {
  const rt = world(t);
  assert.equal((await rt.fetch("https://relay.vyre.run/health")).status, 200);
  assert.equal((await rt.fetch("http://relay.test/health")).status, 200);
  // a download bucket, a site, a tunnel: no HostSlot, so the origin answers, and the second look is the cache's
  for (const host of ["dl", "www", "prototype", "tracker", "nobody-here"]) assert.equal(await (await rt.fetch(`https://${host}.vyre.run/some/file?x=1`)).text(), `origin of ${host}.vyre.run`, host);
  assert.equal(await (await rt.fetch("https://dl.vyre.run/again")).text(), "origin of dl.vyre.run");
  // the shell's paths are not an origin's
  assert.equal((await rt.fetch("https://nobody-here.vyre.run/__vyre/boot.js")).status, 404);
  // a Cloudflare error from the origin is a name nobody holds
  assert.equal((await rt.fetch("https://down.vyre.run/")).status, 404);
  // a failing lookup never takes a host down: the origin answers
  rt.env.HOSTS = { idFromName: () => { throw new Error("boom"); }, get: () => { throw new Error("boom"); } };
  assert.equal(await (await rt.fetch("https://dl-other.vyre.run/")).text(), "origin of dl-other.vyre.run");
  // two labels deep is not a phone address, and not ours
  assert.equal(await (await rt.fetch("https://a.b-name.vyre.run/")).text(), "origin of a.b-name.vyre.run");
});

test("a claim never takes a host that already has an address of its own, with or without the proxied wildcard", async t => {
  for (const wildcard of [true, false]) {
  const rt = world(t, { wildcard, dns: n => n === "docs-site" || n === "dns-down" ? (n === "dns-down" ? new Error("down") : true) : false });
  const a = await box(rt);
  assert.equal((await a.say({ t: "host.claim", name: "docs-site" })).status, "taken");
  assert.equal((await a.say({ t: "host.claim", name: "dns-down" })).status, "unavailable");
  for (const n of ["dl", "prototype", "tracker", "www", "tess"]) assert.equal((await a.say({ t: "host.claim", name: n })).status, "invalid", n);
  assert.equal((await a.say({ t: "host.claim", name: "free-name" })).status, "claimed", "a name that only gets the wildcard's answer is free");
  }
});

test("a staging Worker serves one named host so the whole path runs without the wildcard", async t => {
  const rt = world(t);
  rt.env.STAGE_HOST = "phone-stage.vyre.run";
  rt.env.STAGE_NAME = "stage-phone";
  const a = await box(rt);
  await a.say({ t: "host.claim", name: "stage-phone", label: "Stage box" });
  assert.equal((await rt.fetch("https://phone-stage.vyre.run/")).status, 200);
  assert.equal((await rt.fetch("https://phone-stage.vyre.run/health")).status, 200, "the staging host is the relay's too");
  assert.equal((await rt.fetch("https://phone-stage.vyre.run/__vyre/nope")).status, 404);
  assert.equal((await rt.fetch("https://stage-phone.vyre.run/")).status, 404, "only the staging host answers there");
});

test("a label the deploy fenced from the zone is never a phone name: no claim, and the gateway hands it on", async t => {
  const rt = world(t);
  rt.env.FENCE_HOSTS = "newhost, status-page";
  const a = await box(rt);
  assert.equal((await a.say({ t: "host.claim", name: "newhost" })).status, "reserved");
  assert.equal((await a.say({ t: "host.claim", name: "status-page" })).status, "reserved");
  assert.equal(await (await rt.fetch("https://newhost.vyre.run/x")).text(), "origin of newhost.vyre.run");
  assert.equal((await a.say({ t: "host.claim", name: "not-fenced" })).status, "claimed");
});
