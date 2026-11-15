// Fathom is built in as code (lib/builtin-connectors.ts) only while the connect card is on (lib/connect-switch.ts). Off (the default, rc.28): a fresh Space's connector list is exactly the registry's built-ins, as on
// rc.27, and Fathom is neither listed, found, nor seeded. On: it is there. The file seeds Fathom and nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kit } from "../fixtures/kit.ts";
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
