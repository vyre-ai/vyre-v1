// @reads /modules/connectors/handlers/runtime.ts
// @reads /modules/connectors/handlers/oauth.ts
// @reads /modules/connectors/handlers/syncspec.ts
// @reads /modules/connectors/impl.ts
// @reads /modules/connectors/handlers/grant-port.ts
// THE CLASS BEHIND REVIEW ITEM B (b-connect3, 16 Nov 2026): every place a connector's secret leaves toward a host. The sends of this module are listed here, each with the check that stands before it. A new send that is not
// listed fails this test, so the next person who adds one has to say which rule decides where it goes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, root), "utf8");
const SEND = /\b(?:ctx|port)\.http\(|\bawait http\(|\bhttp\(url\.toString\(\)/g;

test("the sends of the connectors module are exactly the listed ones, and each has its host check before it", () => {
  const found: Record<string, number> = {};
  const files = [
    ...readdirSync(new URL("handlers/", root)).map((f) => `handlers/${f}`),
    "impl.ts",
    "discover.ts",
    "syncspec.ts",
  ].filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const n = (
      read(f)
        .replace(/^\s*\/\/.*$/gm, "")
        .match(SEND) ?? []
    ).length;
    if (n > 0) found[f] = n;
  }
  assert.deepEqual(found, {
    // the connector's one send: checkEgress against the declared domains, then the connection's own host record, then fill and send
    "handlers/runtime.ts": 1,
    // the token exchange and the revoke: both go through checkEgress on the connector's declared URL
    "handlers/oauth.ts": 2,
    // the door a live connector's request goes through: the host's port checks the domains and where each filled key may go; an unpublished connector may never carry a filled key
    "impl.ts": 4,
    // the token trade of an app that issues its own OAuth client: checkEgress against the declared domains, then the send
    "handlers/grant-port.ts": 1,
  });
  const run = read("handlers/runtime.ts");
  const egress = run.indexOf("checkEgress(u.toString(), def.domains)");
  const record = run.indexOf("FROM cn_connection_hosts WHERE connection_id");
  const send = run.indexOf("res = await http(url.toString()");
  assert.ok(
    egress > 0 && record > egress && send > record,
    "runtime: domains, then the connection's host record, then the send",
  );
  const oauth = read("handlers/oauth.ts");
  for (const m of oauth.matchAll(/await ctx\.http\(eg\.url\.toString\(\)/g))
    assert.ok(
      oauth.lastIndexOf("checkEgress(", m.index) > oauth.lastIndexOf("async ", m.index) - 4000,
      "oauth: checkEgress before the send",
    );
  const imp = read("impl.ts");
  assert.match(
    imp,
    /This connector is not live, so it cannot send a Vault key/,
    "an unpublished connector cannot send a Vault key",
  );
});
