// A Space reached through the relay is installed with an EMPTY address setting (VYRE_ADDRESS=). Before 16 Nov 2026 that became "https://", and every connector,
// connection and sync call on such a Space threw "Invalid URL" (found on the first relay Space with a CRM to connect). Now the address is "none", the Space's base
// address falls back to its local URL, and the calls answer.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWorld, OWNER } from "../../fixtures/suite/world.ts";
import { loadConfig } from "../src/daemon/config.ts";

const none = { api: () => undefined, seam: () => undefined, members: [], secrets: {} };

test("an empty address setting is no address", () => {
  assert.equal(loadConfig(["--data-dir", "/nowhere"], { VYRE_ADDRESS: "" }).address, null);
  assert.equal(loadConfig(["--data-dir", "/nowhere"], { VYRE_ADDRESS: "   " }).address, null);
  assert.equal(loadConfig(["--data-dir", "/nowhere"], {}).address, null);
  assert.equal(
    loadConfig(["--data-dir", "/nowhere"], { VYRE_ADDRESS: "team.example.com" }).address,
    "team.example.com",
  );
});

test("on a Space started with an empty address the connector, connection and sync lists answer, and a connection can be made", async () => {
  const w = await bootWorld({ prefix: "relay-space", ...none, addressEnv: "" });
  try {
    for (const cap of ["connectors.list", "connections.list", "sync_types.list"]) {
      const r = await w.call(OWNER, cap, {});
      assert.equal(r.status, 200, `${cap}: ${r.text}`);
    }
    const made = await w.call(OWNER, "connections.create", {
      connector: "hubspot",
      title: "hubspot account",
      ownerKind: "space",
      idempotencyKey: w.idem(),
    });
    assert.equal(made.status, 200, made.text);
  } finally {
    await w.stop(true);
  }
});
