// The egress proxy's mechanics, on real sockets: plain HTTP is forwarded with its hop-by-hop headers removed, tunnels carry a megabyte intact, the allow-list can change under a running proxy,
// the connection limit and idle timeout hold, and what it reports about a connection is its host, port and verdict, never a path, a header or a byte.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createEgressProxy } from "../src/index.ts";
import type { EgressEvent } from "../src/index.ts";
import { echoServer, httpUpstream, rawExchange } from "./helpers.ts";

const PUBLIC = async (): Promise<string[]> => ["203.0.113.10"];

async function tunnel(proxyPort: number, target: string): Promise<{ status: string; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxyPort, "127.0.0.1");
    let got = "";
    s.on("error", reject);
    s.on("connect", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    const onData = (d: Buffer): void => {
      got += d.toString("latin1");
      if (got.includes("\r\n\r\n")) { s.off("data", onData); resolve({ status: got.split("\r\n")[0] as string, socket: s }); }
    };
    s.on("data", onData);
  });
}

function viaProxy(proxyPort: number, absolute: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: proxyPort, method: o.method ?? "GET", path: absolute, headers: o.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on("error", reject);
    if (o.body !== undefined) r.write(o.body);
    r.end();
  });
}

test("plain HTTP is forwarded to the address that was checked, with the proxy's own headers removed and the body intact", async () => {
  const up = await httpUpstream();
  const events: EgressEvent[] = [];
  const connected: Array<[string, number, string]> = [];
  const proxy = createEgressProxy({
    allow: ["api.anthropic.com"], lookup: PUBLIC, onEvent: (e) => events.push(e),
    connect: async (h, p, ip) => { connected.push([h, p, ip]); return net.connect(up.port, "127.0.0.1"); },
  });
  const { port } = await proxy.listen();
  try {
    const r = await viaProxy(port, "http://api.anthropic.com/v1/x?y=1", { method: "POST", body: "payload", headers: { Host: "api.anthropic.com", "Proxy-Authorization": "Basic c2VjcmV0", "X-Custom": "kept", Connection: "keep-alive", "Content-Length": "7" } });
    assert.equal(r.status, 200);
    assert.equal(r.body, "upstream says hello");
    assert.equal(r.headers["x-upstream"], "yes");
    assert.deepEqual(connected, [["api.anthropic.com", 80, "203.0.113.10"]], "the connection went to the address that passed the check");
    const seen = up.seen[0]!;
    assert.deepEqual([seen.method, seen.url, seen.body], ["POST", "/v1/x?y=1", "payload"]);
    assert.equal(seen.headers["host"], "api.anthropic.com");
    assert.equal(seen.headers["x-custom"], "kept");
    assert.equal(seen.headers["proxy-authorization"], undefined, "the proxy's own credentials do not travel");
    assert.equal(seen.headers["connection"], "close");
    assert.deepEqual(events.map((e) => [e.verdict, e.host, e.port, e.reason]), [["allow", "api.anthropic.com", 80, "ok"]]);
  } finally { await proxy.close(); await up.close(); }
});

test("plain HTTP to a host that is not listed, an https URL, and a request that is not for a proxy are refused without a connection", async () => {
  const up = await httpUpstream();
  let connects = 0;
  const events: EgressEvent[] = [];
  const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: PUBLIC, onEvent: (e) => events.push(e), connect: async () => { connects++; return net.connect(up.port, "127.0.0.1"); } });
  const { port } = await proxy.listen();
  try {
    assert.equal((await viaProxy(port, "http://evil.example.com/")).status, 403);
    assert.equal((await viaProxy(port, "http://api.anthropic.com:8080/")).status, 403, "a port that is not 80 or 443");
    assert.equal((await viaProxy(port, "http://93.184.216.34/")).status, 403);
    assert.equal((await viaProxy(port, "https://api.anthropic.com/")).status, 400, "https goes through CONNECT");
    assert.equal((await viaProxy(port, "/just/a/path")).status, 400, "origin form: this is a proxy");
    assert.equal(connects, 0);
    assert.equal(up.seen.length, 0);
    assert.deepEqual(events.map((e) => e.reason), ["not_listed", "bad_port", "not_listed", "bad_request", "bad_request"]);
  } finally { await proxy.close(); await up.close(); }
});

test("what the proxy reports is host, port, verdict and reason, and nothing else", async () => {
  const events: EgressEvent[] = [];
  const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: PUBLIC, onEvent: (e) => events.push(e), connect: async () => { throw new Error("no route"); } });
  const { port } = await proxy.listen();
  try {
    await rawExchange(port, "CONNECT evil.example.com:443 HTTP/1.1\r\nAuthorization: Bearer sk-secret\r\n\r\n", { until: /\r\n\r\n/ });
    await rawExchange(port, "CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ });
    assert.deepEqual(events.map((e) => Object.keys(e).sort()), [["host", "port", "reason", "verdict"], ["host", "port", "reason", "verdict"]]);
    assert.deepEqual(events.map((e) => e.reason), ["not_listed", "unreachable"]);
    assert.equal(JSON.stringify(events).includes("sk-secret"), false);
  } finally { await proxy.close(); }
});

test("a tunnel carries a megabyte both ways intact", async () => {
  const up = await echoServer();
  const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: PUBLIC, connect: async () => net.connect(up.port, "127.0.0.1") });
  const { port } = await proxy.listen();
  try {
    const { status, socket } = await tunnel(port, "api.anthropic.com:443");
    assert.match(status, /200/);
    const total = 1024 * 1024;
    const chunk = Buffer.alloc(16 * 1024);
    let sent = 0;
    let received = 0;
    let bad = 0;
    const done = new Promise<void>((resolve) => {
      socket.on("data", (d: Buffer) => {
        for (let i = 0; i < d.length; i++) if (d[i] !== ((received + i) >> 4) % 251) bad++;
        received += d.length;
        if (received >= total) resolve();
      });
    });
    while (sent < total) {
      for (let i = 0; i < chunk.length; i++) chunk[i] = ((sent + i) >> 4) % 251;
      if (!socket.write(Buffer.from(chunk))) await new Promise((r) => socket.once("drain", r));
      sent += chunk.length;
    }
    await done;
    assert.equal(received, total);
    assert.equal(bad, 0, "every byte came back as it went");
    socket.destroy();
  } finally { await proxy.close(); await up.close(); }
});

test("the allow-list can change under a running proxy: the next connection sees the new list", async () => {
  const up = await echoServer();
  let list: string[] = ["a.example.com"];
  const proxy = createEgressProxy({ allow: () => list, lookup: PUBLIC, connect: async () => net.connect(up.port, "127.0.0.1") });
  const { port } = await proxy.listen();
  try {
    assert.match((await tunnel(port, "a.example.com:443")).status, /200/);
    list = ["b.example.com"];
    assert.match(await rawExchange(port, "CONNECT a.example.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ }), /^HTTP\/1\.1 403/);
    assert.match((await tunnel(port, "b.example.com:443")).status, /200/);
  } finally { await proxy.close(); await up.close(); }
});

test("names that do not resolve, or resolve to nothing, are refused as such; a listed host that cannot be reached is a bad gateway", async () => {
  const events: EgressEvent[] = [];
  const mk = (lookup: (h: string) => Promise<readonly string[]>, connect?: () => Promise<net.Socket>) =>
    createEgressProxy({ allow: ["api.anthropic.com"], lookup, onEvent: (e) => events.push(e), ...(connect ? { connect } : {}) });
  for (const [lookup, expect] of [
    [async () => { throw new Error("ENOTFOUND"); }, "no_address"],
    [async () => [], "no_address"],
  ] as const) {
    const proxy = mk(lookup);
    const { port } = await proxy.listen();
    try { assert.match(await rawExchange(port, "CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ }), /^HTTP\/1\.1 403/); } finally { await proxy.close(); }
    assert.equal(events.at(-1)?.reason, expect);
  }
  const proxy = mk(PUBLIC, async () => { throw new Error("ECONNREFUSED"); });
  const { port } = await proxy.listen();
  try { assert.match(await rawExchange(port, "CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ }), /^HTTP\/1\.1 502/); } finally { await proxy.close(); }
  assert.equal(events.at(-1)?.reason, "unreachable");
});

test("the connection limit holds and frees when a tunnel closes; an idle tunnel is closed", async () => {
  const up = await echoServer();
  const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: PUBLIC, maxConnections: 2, idleMs: 300, connect: async () => net.connect(up.port, "127.0.0.1") });
  const { port } = await proxy.listen();
  try {
    const a = await tunnel(port, "api.anthropic.com:443");
    const b = await tunnel(port, "api.anthropic.com:443");
    const t0 = Date.now();
    const bClosed = new Promise<void>((r) => b.socket.once("close", () => r()));
    assert.equal(proxy.stats().open, 2);
    assert.match(await rawExchange(port, "CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ }), /^HTTP\/1\.1 503/);
    a.socket.destroy();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(proxy.stats().open, 1);
    const c = await tunnel(port, "api.anthropic.com:443");
    assert.match(c.status, /200/);

    await bClosed;
    const waited = Date.now() - t0;
    assert.ok(waited < 1500, `the idle tunnel was closed after ${waited} ms`);
    c.socket.destroy();
  } finally { await proxy.close(); await up.close(); }
});

test("close ends every open tunnel and the proxy stops listening", async () => {
  const up = await echoServer();
  const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: PUBLIC, connect: async () => net.connect(up.port, "127.0.0.1") });
  const { port } = await proxy.listen();
  const a = await tunnel(port, "api.anthropic.com:443");
  const closed = new Promise<void>((r) => a.socket.once("close", () => r()));
  await proxy.close();
  await closed;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(proxy.stats().open, 0);
  await assert.rejects(() => tunnel(port, "api.anthropic.com:443"));
  await up.close();
});

test("malformed requests are answered with 400 and counted, not crashed on", async () => {
  const events: EgressEvent[] = [];
  const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: PUBLIC, onEvent: (e) => events.push(e) });
  const { port } = await proxy.listen();
  try {
    for (const raw of ["GARBAGE\r\n\r\n", "CONNECT\r\n\r\n", "CONNECT api.anthropic.com HTTP/1.1\r\n\r\n", "CONNECT api.anthropic.com:99999 HTTP/1.1\r\n\r\n", "CONNECT api.anthropic.com:abc HTTP/1.1\r\n\r\n"]) {
      const res = await rawExchange(port, raw, { until: /\r\n\r\n/ });
      assert.match(res, /^HTTP\/1\.1 (400|403) /, JSON.stringify(raw));
    }
    assert.equal(events.length, 5);
    assert.ok(events.every((e) => e.verdict === "deny"));
    assert.match(await rawExchange(port, "CONNECT evil.example.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ }), /^HTTP\/1\.1 403/, "and it still answers");
  } finally { await proxy.close(); }
});
