// The relay's version from its /health (a fake relay over HTTP), kept beside this Space server's own for the Console's Relay card.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchRelayVersion, relayHealthUrl, relayVersionWatch, storeInfo } from "./relay-version.ts";
import { openDb } from "./sqlite.ts";
import type { FetchFn } from "../platform/probes.ts";

const real: FetchFn = (url, init) => fetch(url, init as RequestInit) as never;
function fakeRelay(reply: (url: string) => { status?: number; body: string }): Promise<{ url: string; hits: string[]; close(): void }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(req.url ?? ""); const r = reply(req.url ?? ""); res.writeHead(r.status ?? 200, { "content-type": "application/json" }); res.end(r.body); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, close: () => server.close() })));
}

test("the health address comes from the address the box dials", () => {
  assert.equal(relayHealthUrl("wss://relay.vyre.run/box?x=1"), "https://relay.vyre.run/health");
  assert.equal(relayHealthUrl("ws://127.0.0.1:8787"), "http://127.0.0.1:8787/health");
  assert.equal(relayHealthUrl("not a url"), null);
});

test("a relay that says its version is read; one that says none, errors, or is not there gives null", async () => {
  const relay = await fakeRelay((u) => (u === "/health" ? { body: JSON.stringify({ ok: true, version: "1.4.1" }) } : { status: 404, body: "{}" }));
  try {
    assert.equal(await fetchRelayVersion(relay.url, real), "1.4.1");
    assert.deepEqual(relay.hits, ["/health"]);
  } finally { relay.close(); }
  const old = await fakeRelay(() => ({ body: JSON.stringify({ ok: true }) }));
  try { assert.equal(await fetchRelayVersion(old.url, real), null, "an older relay says no version"); } finally { old.close(); }
  const bad = await fakeRelay(() => ({ body: JSON.stringify({ version: "<script>" }) }));
  try { assert.equal(await fetchRelayVersion(bad.url, real), null, "a version with odd characters is not kept"); } finally { bad.close(); }
  assert.equal(await fetchRelayVersion("http://127.0.0.1:1", real, 500), null);
  assert.equal(await fetchRelayVersion(relay.url, null), null);
});

test("the watch asks the relay about every five minutes and stores what it says", async () => {
  const relay = await fakeRelay(() => ({ body: JSON.stringify({ version: "1.4.0" }) }));
  const raw = openDb(":memory:", {});
  raw.exec("CREATE TABLE network_info (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)");
  let t = 1_000_000;
  try {
    const watch = relayVersionWatch({ relay: relay.url, fetch: real, db: raw, now: () => t });
    watch(); watch();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(relay.hits.length, 1, "twice in a row is one question");
    assert.deepEqual(JSON.parse(JSON.stringify(raw.all("SELECT key, value FROM network_info"))), [{ key: "relay_version", value: "1.4.0" }]);
    t += 60_000; watch();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(relay.hits.length, 1, "not again within five minutes");
    t += 300_000; watch();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(relay.hits.length, 2);
    storeInfo(raw, "space_version", "1.4.1", t);
    assert.equal(raw.all("SELECT value FROM network_info WHERE key = 'space_version'").length, 1);
  } finally { relay.close(); }
});
