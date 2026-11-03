// A turn on a person's own computer reaches Vyre's tools at its Space's own address (lane l-runson): the rule's `space` opens exactly that host and port, even when it is on the LAN or this machine,
// whatever the rest of the rule says; any other port of that host, and any other private address, stays closed.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createEgressProxy, spaceTarget, validateRule } from "../src/index.ts";

async function connectVia(proxyPort: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxyPort, "127.0.0.1");
    let got = "";
    s.on("error", reject);
    s.on("connect", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.on("data", (d: Buffer) => { got += d.toString("latin1"); if (got.includes("\r\n\r\n")) { s.destroy(); resolve(got.split("\r\n")[0] as string); } });
  });
}

test("the Space's own address is reachable under any rule; its other ports and other private addresses are not", async () => {
  const space = net.createServer((c) => c.end());
  await new Promise<void>((ok) => space.listen(0, "127.0.0.1", ok));
  const port = (space.address() as net.AddressInfo).port;
  for (const base of [{ egress: "list" as const, allow: ["api.anthropic.com"] }, { egress: "public" as const }]) {
    const rule = validateRule({ ...base, space: `127.0.0.1:${port}` });
    const proxy = createEgressProxy({ allow: [], rule });
    const { port: pp } = await proxy.listen();
    try {
      assert.match(await connectVia(pp, `127.0.0.1:${port}`), / 200 /, `${base.egress}: the Space is reached`);
      assert.match(await connectVia(pp, `127.0.0.1:${port + 1 > 65535 ? port - 1 : port + 1}`), / 40[03] /, `${base.egress}: another port of that host is not`);
      assert.match(await connectVia(pp, "10.0.0.5:443"), / 40[03] /, `${base.egress}: another private address is not`);
    } finally { await proxy.close(); }
  }
  space.close();
});

test("a rule's space is host:port and nothing else; an address is written the same way the proxy compares it", () => {
  assert.deepEqual(validateRule({ egress: "public", space: "mla.vyre.run:443" }), { egress: "public", space: "mla.vyre.run:443" });
  assert.throws(() => validateRule({ egress: "public", space: "mla.vyre.run" }), /host:port/);
  assert.throws(() => validateRule({ egress: "public", space: "http://x:1" }), /host:port/);
  assert.equal(spaceTarget("https://MLA.vyre.run"), "mla.vyre.run:443");
  assert.equal(spaceTarget("http://192.168.1.20:8420/"), "192.168.1.20:8420");
  assert.equal(spaceTarget("ftp://x"), null);
});
