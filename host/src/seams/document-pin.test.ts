// The socket target is the address that already passed the check, not a later answer for the same name.
import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import tls from "node:tls";
import { documentPin } from "./document-pin.ts";

test("the socket dials the vetted address when a later lookup of the name would return loopback", async (t) => {
  let lookups = 0;
  const lookupOpts: { host: string; all?: boolean; verbatim?: boolean }[] = [];
  t.mock.method(dns, "lookup", async (host: string, opts?: { all?: boolean; verbatim?: boolean }) => {
    lookups += 1;
    lookupOpts.push({ host, all: opts?.all, verbatim: opts?.verbatim });
    if (lookups === 1) return [{ address: "1.2.3.4", family: 4 }];
    return [{ address: "127.0.0.1", family: 4 }];
  });

  const dialed: { host?: string; servername?: string; port?: number }[] = [];
  const fromSocket: string[][] = [];
  t.mock.method(tls, "connect", (options: tls.ConnectionOptions) => {
    dialed.push({ host: options.host, servername: options.servername, port: options.port });
    const found: string[] = [];
    const lookup = options.lookup;
    if (lookup) {
      lookup("docs.example", { all: true }, (_err, addresses) => {
        if (Array.isArray(addresses)) for (const row of addresses) found.push(row.address);
      });
      lookup("docs.example", {}, (_err, address) => {
        if (typeof address === "string") found.push(address);
      });
    }
    fromSocket.push(found);
    throw new Error("stub");
  });

  const deps = documentPin();
  assert.equal(deps.fetch, globalThis.fetch);
  const addresses = await deps.lookup("docs.example");
  assert.deepEqual(addresses, ["1.2.3.4"]);
  assert.equal(lookups, 1);
  assert.deepEqual(lookupOpts[0], { host: "docs.example", all: true, verbatim: true });

  await assert.rejects(
    () => deps.connect({
      url: new URL("https://docs.example/guide.txt"),
      addresses,
      signal: AbortSignal.timeout(1_000),
    }),
    /stub/,
  );

  assert.equal(lookups, 1, "connect does not resolve the name again");
  assert.equal(dialed.length, 1);
  assert.equal(dialed[0]!.host, "1.2.3.4");
  assert.equal(dialed[0]!.servername, "docs.example");
  assert.equal(dialed[0]!.port, 443);
  assert.deepEqual(fromSocket, [["1.2.3.4", "1.2.3.4"]]);
  assert.equal(dialed.some((row) => row.host === "127.0.0.1"), false);
  assert.equal(fromSocket.some((rows) => rows.includes("127.0.0.1")), false);

  const again = await deps.lookup("docs.example");
  assert.deepEqual(again, ["127.0.0.1"]);
  assert.equal(dialed.some((row) => row.host === "127.0.0.1" || row.servername === "127.0.0.1"), false);
});

test("connect fails when there is no address and does not dial", async (t) => {
  let dialed = 0;
  t.mock.method(tls, "connect", () => {
    dialed += 1;
    throw new Error("stub");
  });
  await assert.rejects(
    () => documentPin().connect({
      url: new URL("https://docs.example/guide.txt"),
      addresses: [],
      signal: AbortSignal.timeout(1_000),
    }),
    /No address/,
  );
  assert.equal(dialed, 0);
});
