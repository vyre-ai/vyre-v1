// Open web (owner ruling 3 Nov): the "public" rule lets a sandbox reach any public host on any port, by name or public address, through the same proxy that resolves once and connects to the checked
// address; loopback, private, link-local and metadata, CGNAT, this machine's own networks and Vyre's own ports stay closed. A list rule is the old allow-list, held to the same validator. The SSH
// CONNECT helper carries bytes through a tunnel and fails at once, with one line, when the proxy refuses. Real sockets throughout; names resolve through a fake resolver to TEST-NET addresses.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { CONNECT_SOURCE, PUBLIC_RULE, addressRefusal, createEgressProxy, inCidr, isPrivateAddress, ruleFromEnv, toolProxyEnv, validateRule, validateSpec } from "../src/index.ts";
import type { EgressEvent } from "../src/index.ts";
import { echoServer } from "./helpers.ts";

const NAMES: Record<string, string[]> = {
  "github.com": ["203.0.113.10"], "registry.npmjs.org": ["203.0.113.11"], "api.anthropic.com": ["203.0.113.12"],
  "metadata.test.example": ["169.254.169.254"], "lan.example.com": ["10.0.0.5"], "half.example.com": ["203.0.113.13", "192.168.1.4"], "neighbour.example.com": ["198.51.100.7"],
};
const lookup = async (h: string): Promise<string[]> => { const a = NAMES[h]; if (!a) throw new Error("ENOTFOUND"); return a; };
/** This machine sits on 198.51.100.0/24: a neighbour there is its LAN. */
const OWN = () => [{ address: "198.51.100.2", prefix: 24, family: 4 as const }];

async function tunnel(port: number, target: string): Promise<{ status: string; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1");
    let got = "";
    s.on("error", reject);
    s.on("connect", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    const on = (d: Buffer): void => { got += d.toString("latin1"); if (got.includes("\r\n\r\n")) { s.off("data", on); resolve({ status: got.split("\r\n")[0] as string, socket: s }); } };
    s.on("data", on);
  });
}

test("the rule validator: public takes nothing else, a list holds only host names, and nothing else is a rule", () => {
  assert.deepEqual(validateRule({ egress: "public" }), PUBLIC_RULE);
  assert.deepEqual(validateRule({ egress: "list", allow: ["github.com", "*.npmjs.org", "github.com"] }), { egress: "list", allow: ["github.com", "*.npmjs.org"] });
  for (const bad of [null, "public", {}, { egress: "everything" }, { egress: "public", allow: ["x.com"] }, { egress: "list", allow: ["*"] }, { egress: "list", allow: ["10.0.0.1"] },
    { egress: "list", allow: ["localhost"] }, { egress: "list", allow: "github.com" }, { egress: "list", allow: ["github.com"], ports: [22] }]) {
    assert.throws(() => validateRule(bad), /network rule|allow-list/, JSON.stringify(bad));
  }
  assert.equal(ruleFromEnv(undefined), null);
  assert.deepEqual(ruleFromEnv(JSON.stringify({ egress: "public" })), PUBLIC_RULE);
  assert.throws(() => ruleFromEnv("{\"egress\":\"list\",\"allow\":[\"*\"]}"), /not one Vyre writes/);
  // the spec validator holds a rule to the same check, and keeps the allow-list strict
  const spec = { id: "vyre-sbx-dana", person: "usr_dana", kind: "bwrap" as const, mounts: [{ host: "/data/work/a", mode: "rw" as const }], egressHosts: ["api.anthropic.com"] };
  assert.doesNotThrow(() => validateSpec({ ...spec, egressRule: PUBLIC_RULE }, { work: ["/data/work"], scratch: [] }));
  assert.throws(() => validateSpec({ ...spec, egressRule: { egress: "list", allow: ["*"] } }, { work: ["/data/work"], scratch: [] }));
  assert.throws(() => validateSpec({ ...spec, egressHosts: ["*"] }, { work: ["/data/work"], scratch: [] }));
});

test("addresses: only global unicast IPv6 is public, a 6to4 address is its v4 inside, and this machine's networks are refused", () => {
  for (const ip of ["::10.0.0.1", "::a00:1", "2002:0a00:0001::1", "2002:a9fe:a9fe::", "fd00::1", "fe80::1%eth0", "64:ff9b::a00:1", "::ffff:169.254.169.254", "2001:db8::1", "100.64.0.1", "0.0.0.0"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["2606:4700::1111", "2002:cb00:710a::1", "203.0.113.10", "140.82.112.3"]) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(inCidr("198.51.100.200", { address: "198.51.100.2", prefix: 24, family: 4 }), true);
  assert.equal(inCidr("198.51.101.1", { address: "198.51.100.2", prefix: 24, family: 4 }), false);
  assert.equal(inCidr("2a03:b0c0:3:d0::1", { address: "2a03:b0c0:3:d0::5e:1", prefix: 64, family: 6 }), true);
  assert.equal(inCidr("2a03:b0c0:3:d1::1", { address: "2a03:b0c0:3:d0::5e:1", prefix: 64, family: 6 }), false);
  assert.equal(addressRefusal("198.51.100.7", OWN()), "own_network");
  assert.equal(addressRefusal("169.254.169.254", OWN()), "private_address");
  assert.equal(addressRefusal("203.0.113.10", OWN()), null);
});

test("public: any public host on any port is tunnelled to the checked address; inside addresses, this machine's network and Vyre's ports are refused before any connection", async () => {
  const echo = await echoServer();
  const events: EgressEvent[] = [];
  const connected: string[] = [];
  const proxy = createEgressProxy({ allow: [], rule: PUBLIC_RULE, lookup, ownNetworks: OWN, onEvent: (e) => events.push(e), connect: async (h, p, ip) => { connected.push(`${h}:${p}@${ip}`); return net.connect(echo.port, "127.0.0.1"); } });
  const { port } = await proxy.listen();
  try {
    for (const target of ["github.com:443", "github.com:22", "registry.npmjs.org:8443", "203.0.113.20:443", "[2606:4700::1111]:443"]) {
      const t = await tunnel(port, target);
      assert.match(t.status, /^HTTP\/1\.1 200/, target);
      t.socket.write("ping");
      const back = await new Promise<string>((r) => t.socket.once("data", (d) => r(d.toString())));
      assert.equal(back, "ping", target);
      t.socket.destroy();
    }
    assert.deepEqual(connected, ["github.com:443@203.0.113.10", "github.com:22@203.0.113.10", "registry.npmjs.org:8443@203.0.113.11", "203.0.113.20:443@203.0.113.20", "2606:4700::1111:443@2606:4700::1111"]);
    const refused: Array<[string, EgressEvent["reason"]]> = [
      ["127.0.0.1:8420", "bad_port"], ["127.0.0.1:443", "private_address"], ["10.0.0.5:443", "private_address"], ["169.254.169.254:80", "private_address"], ["[::1]:443", "private_address"],
      ["localhost:443", "not_listed"], ["metadata.test.example:80", "private_address"], ["lan.example.com:443", "private_address"], ["half.example.com:443", "private_address"],
      ["neighbour.example.com:443", "own_network"], ["198.51.100.9:22", "own_network"], ["github.com:8420", "bad_port"], ["github.com:2019", "bad_port"], ["nowhere.example.com:443", "no_address"],
    ];
    for (const [target, reason] of refused) {
      const before = connected.length;
      const t = await tunnel(port, target);
      assert.match(t.status, /^HTTP\/1\.1 403/, target);
      t.socket.destroy();
      assert.equal(connected.length, before, `${target}: no connection was opened`);
      const last = events.filter((e) => e.verdict === "deny").pop();
      assert.equal(last?.reason, reason, target);
    }
  } finally { await proxy.close(); await echo.close(); }
});

test("public, plain HTTP: an absolute URL on any port is forwarded; a list rule refuses the same host, and the rule can change under a running proxy", async () => {
  const up = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end(`hello ${q.url}`); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
  const upPort = (up.address() as net.AddressInfo).port;
  let rule: Parameters<typeof createEgressProxy>[0]["rule"] = PUBLIC_RULE;
  const proxy = createEgressProxy({ allow: [], rule: () => rule as never, lookup, ownNetworks: OWN, connect: async () => net.connect(upPort, "127.0.0.1") });
  const { port } = await proxy.listen();
  const get = (url: string): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: url, agent: false }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b })); }).on("error", reject);
  });
  try {
    assert.deepEqual(await get("http://registry.npmjs.org:8080/left-pad"), { status: 200, body: "hello /left-pad" });
    rule = { egress: "list", allow: ["api.anthropic.com"] };
    assert.equal((await get("http://registry.npmjs.org/left-pad")).status, 403, "only the AI providers: a public host is blocked again");
    assert.equal((await get("http://api.anthropic.com/v1")).status, 200);
    assert.equal((await get("http://203.0.113.10/")).status, 403, "a list is by name: an address is refused");
  } finally { await proxy.close(); await new Promise((r) => up.close(r)); }
});

test("a host that does not answer is a bad gateway after the connect limit, not a hang", async () => {
  // a server that accepts nothing: connect() never finishes, so the proxy's own limit ends it
  const proxy = createEgressProxy({ allow: [], rule: PUBLIC_RULE, lookup, ownNetworks: OWN, connectMs: 300, connect: (_h, _p, _ip) => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), 300)) });
  const { port } = await proxy.listen();
  try {
    const t0 = Date.now();
    const t = await tunnel(port, "github.com:443");
    assert.match(t.status, /^HTTP\/1\.1 502/);
    assert.ok(Date.now() - t0 < 3000);
    t.socket.destroy();
  } finally { await proxy.close(); }
});

test("the SSH CONNECT helper carries bytes through the proxy, and a refused host ends it at once with one line", async () => {
  const echo = await echoServer();
  const proxy = createEgressProxy({ allow: [], rule: PUBLIC_RULE, lookup, ownNetworks: OWN, connect: async () => net.connect(echo.port, "127.0.0.1") });
  const { port } = await proxy.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connect-"));
  const helper = path.join(dir, "connect.mjs");
  fs.writeFileSync(helper, CONNECT_SOURCE);
  const run = (host: string, p: number, input: string): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve) => {
    const c = spawn(process.execPath, [helper, String(port), host, String(p)], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; if (out.includes(input)) c.stdin.end(); });
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, out, err }));
    c.stdin.write(input);
    setTimeout(() => c.kill(), 5000).unref();
  });
  try {
    const ok = await run("github.com", 22, "SSH-2.0-OpenSSH_test\r\n");
    assert.equal(ok.out, "SSH-2.0-OpenSSH_test\r\n", "what ssh writes reaches the host and comes back");
    const no = await run("10.0.0.5", 22, "x");
    assert.equal(no.code, 1);
    assert.match(no.err, /10\.0\.0\.5:22 cannot be reached from here \(403 Forbidden\)/);
  } finally { await proxy.close(); await echo.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the tools' variables: every proxy name the usual tools read, and git's ssh command tunnels through the helper", () => {
  const env = toolProxyEnv("http://127.0.0.1:3128", { node: "/usr/bin/node", helper: "/run/vyre-net/connect.mjs", port: 3128, knownHosts: "/home/agent/.vyre-known-hosts" });
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "npm_config_proxy", "npm_config_https_proxy", "PIP_PROXY", "CARGO_HTTP_PROXY"]) assert.equal(env[k], "http://127.0.0.1:3128", k);
  assert.equal(env["NODE_USE_ENV_PROXY"], "1");
  assert.equal(env["NO_PROXY"], "localhost,127.0.0.1");
  const sshHead = process.platform === "win32" ? "'[^']*ssh\\.exe' -F 'NUL'" : "ssh -F '\\/dev\\/null'";
  assert.match(env["GIT_SSH_COMMAND"] ?? "", new RegExp(`^${sshHead} -o 'ProxyCommand="\\/usr\\/bin\\/node" "\\/run\\/vyre-net\\/connect\\.mjs" 3128 %h %p' -o StrictHostKeyChecking=accept-new`));
  assert.equal(toolProxyEnv("http://127.0.0.1:1")["GIT_SSH_COMMAND"], undefined, "no helper, no ssh command");
});
