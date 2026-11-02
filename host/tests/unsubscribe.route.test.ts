// The unsubscribe link for a person with no account: a page that never unsubscribes on a plain fetch, one POST that does, and nothing about the Space on either. /p/u/ on a phone address is the same route.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createUnsubscribeRoute } from "../src/routes/unsubscribe.ts";
import { createPublicPathRoute } from "../src/routes/public-path.ts";
import { publicPathOk } from "../src/seams/relay.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

async function serve(unsubscribe: (t: string) => Promise<boolean>): Promise<{ url: string; close(): void }> {
  const route = createUnsubscribeRoute({ unsubscribe });
  const path = createPublicPathRoute({ forms: () => null, origin: () => null, unsubscribe: () => route });
  const server = http.createServer((req, res) => { if (path.handle(req, res) || route.handle(req, res)) return; res.writeHead(200, { "content-type": "text/html" }); res.end("<title>the app shell</title>"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test("a plain fetch of the link changes nothing: a mail scanner does not unsubscribe anyone", async () => {
  const asked: string[] = [];
  const s = await serve(async (t) => { asked.push(t); return true; });
  try {
    for (const path of [`/u/${TOKEN}`, `/p/u/${TOKEN}`]) {
      const get = await fetch(s.url + path);
      assert.equal(get.status, 200, path);
      const html = await get.text();
      assert.doesNotMatch(html, /the app shell/, "not the app");
      assert.match(html, /method="post"/);
      assert.match(html, /\.submit\(\)/, "one click for a person: the page sends itself");
      assert.equal((await fetch(s.url + path, { method: "HEAD" })).status, 200);
    }
    assert.deepEqual(asked, []);
  } finally { s.close(); }
});

test("POST unsubscribes at both addresses, and the confirmation is plain and says nothing of the Space", async () => {
  const asked: string[] = [];
  const s = await serve(async (t) => { asked.push(t); return true; });
  try {
    for (const path of [`/u/${TOKEN}`, `/p/u/${TOKEN}`]) {
      const res = await fetch(s.url + path, { method: "POST", headers: { cookie: "session=x" }, body: "List-Unsubscribe=One-Click" });
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.match(html, /You are unsubscribed/);
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer", "the token stays out of any next request");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("x-robots-tag"), "noindex");
    }
    assert.deepEqual(asked, [TOKEN, TOKEN]);
  } finally { s.close(); }
});

test("a bad link says so and a failure keeps the person subscribed and says so: neither claims it worked", async () => {
  const bad = await serve(async () => false);
  const down = await serve(async () => { throw new Error("contacts is down"); });
  try {
    const no = await fetch(`${bad.url}/u/${TOKEN}`, { method: "POST" });
    assert.equal(no.status, 404);
    assert.match(await no.text(), /does not work/);
    const failed = await fetch(`${down.url}/u/${TOKEN}`, { method: "POST" });
    assert.equal(failed.status, 503);
    assert.match(await failed.text(), /still subscribed/);
  } finally { bad.close(); down.close(); }
});

test("nothing else moves: other paths fall through, and the relay carries the address", async () => {
  const s = await serve(async () => true);
  try {
    assert.match(await (await fetch(`${s.url}/u/short`)).text(), /the app shell/);
    assert.match(await (await fetch(`${s.url}/u/${TOKEN}/more`)).text(), /the app shell/);
    assert.equal((await fetch(`${s.url}/u/${TOKEN}`, { method: "DELETE" })).status, 405);
    assert.equal(publicPathOk(`/p/u/${TOKEN}`), true);
  } finally { s.close(); }
});
