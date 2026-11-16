// Fathom is built in as code (lib/builtin-connectors.ts) only while the connect card is on (lib/connect-switch.ts). Off (the default, rc.28): a fresh Space's connector list is exactly the registry's built-ins, as on
// rc.27, and Fathom is neither listed, found, nor seeded. On: it is there. The file seeds Fathom and nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kit } from "../fixtures/kit.ts";
import { seedBuiltins } from "../projections.ts";
import { CODE_BUILTINS } from "../../../lib/builtin-connectors.ts";

const registry = (): string[] =>
  (
    JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as {
      connectors: { key: string }[];
    }
  ).connectors
    .map((c) => c.key)
    .sort();

test("the file seeds Fathom and nothing else", () => {
  assert.deepEqual(
    CODE_BUILTINS.map((c) => c.key),
    ["fathom"],
  );
});

test("off: a fresh Space lists exactly the registry's built-ins, and Fathom is not there", async () => {
  process.env["VYRE_CONNECT_CARD"] = "0";
  const k = kit();
  const all = await k.hs["connectors.list"](k.ctx, {});
  assert.deepEqual(all.connectors.map((c) => c.key).sort(), registry());
  assert.equal(
    all.connectors.some((c) => c.key === "fathom"),
    false,
  );
  assert.deepEqual((await k.hs["connectors.for_service"](k.ctx, { service: "Fathom" })).found, false);
});

test("on (VYRE_CONNECT_CARD=1): Fathom is built in as well", async () => {
  process.env["VYRE_CONNECT_CARD"] = "1";
  try {
    const k = kit();
    const all = await k.hs["connectors.list"](k.ctx, {});
    assert.deepEqual(all.connectors.map((c) => c.key).sort(), [...registry(), "fathom"].sort());
  } finally {
    delete process.env["VYRE_CONNECT_CARD"];
  }
});

test("a connector a person made under a key a release now makes built in moves aside, with its connections, and the built-in takes the key (nothing is dropped, nothing shadows)", async () => {
  process.env["VYRE_CONNECT_CARD"] = "1";
  try {
    const k = kit();
    const mine = {
      key: "fathom",
      title: "Fathom",
      mode: "api",
      scope: "person",
      version: "1.0.0",
      auth: { type: "api_key", secret: "api_key", header: "X-Api-Key" },
      domains: ["api.mine.example"],
      secrets: [{ name: "api_key", description: "key" }],
      actions: [{ name: "ping", url: "https://api.mine.example/p" }],
    };
    k.tx.run("DELETE FROM cn_connectors WHERE key = 'fathom'");
    k.tx.run(
      "INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES ('fathom', 'Fathom', 'api', 'person', 0, '1.0.0', 'live', ?, 1, 1)",
      JSON.stringify(mine),
    );
    k.tx.run(
      "INSERT INTO cn_connections (connection_id, connector, title, owner_kind, owner_id, state, created_at) VALUES ('con_mine', 'fathom', 'Mine', 'person', 'usr_dana', 'active', 1)",
    );
    // the next start of the server seeds again, from a handle that has not seeded yet
    seedBuiltins({ ...k.deps, tx: Object.create(k.tx) });
    const all = await k.hs["connectors.list"](k.ctx, {});
    const fathom = all.connectors.find((c) => c.key === "fathom")!;
    assert.equal(fathom.builtin, true, "the built-in has the key");
    const aside = all.connectors.find((c) => c.key === "fathom-yours")!;
    assert.ok(aside, "the person-made one is kept under another key");
    assert.equal(aside.builtin, false);
    assert.equal(
      k.tx.get<{ connector: string }>("SELECT connector FROM cn_connections WHERE connection_id = 'con_mine'")!
        .connector,
      "fathom-yours",
      "its connection stays with it",
    );
    assert.equal(
      JSON.parse(k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = 'fathom-yours'")!.def).domains[0],
      "api.mine.example",
    );
  } finally {
    delete process.env["VYRE_CONNECT_CARD"];
  }
});
