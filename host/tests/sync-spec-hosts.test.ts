// The sync-spec path's rc.25 allowance (host/src/seams/key-ref.ts syncSpecHostAllowed, used by the connector port's key-host check): only the spec's own probe, and a connection a sync spec
// made going to exactly its own spec's domain. Anything else keeps the per-key host rule. rc.27 replaces this with the first-use card (BACKLOG: "Key card for the CRM flow").
import test from "node:test";
import assert from "node:assert/strict";
import { syncSpecHostAllowed } from "../src/seams/key-ref.ts";

const tables = (rows: Array<{ connector: string; connection_id: string; domain: string }>) => ({
  all: (_sql: string, connector: unknown, connectionId: unknown) =>
    rows
      .filter((r) => r.connector === connector && r.connection_id === connectionId)
      .map((r) => ({ spec: JSON.stringify({ app: { name: "Ledger", domain: r.domain } }) })),
});

test("the sample and survey probe goes (the port already holds it to the spec's domain)", () => {
  assert.equal(syncSpecHostAllowed(null, { connector: "sync_spec", connectionId: "probe" }, "crm-a.test"), true);
});

test("a sync-spec connection goes to exactly its own spec's domain, and to no other host", () => {
  const t = tables([{ connector: "crm_ledger", connection_id: "con_1", domain: "crm-a.test" }]);
  assert.equal(syncSpecHostAllowed(t, { connector: "crm_ledger", connectionId: "con_1" }, "crm-a.test"), true);
  assert.equal(
    syncSpecHostAllowed(t, { connector: "crm_ledger", connectionId: "con_1" }, "collect.attacker.example"),
    false,
    "any other host keeps the rule",
  );
  assert.equal(
    syncSpecHostAllowed(t, { connector: "crm_ledger", connectionId: "con_1" }, "api.crm-a.test"),
    false,
    "not even a name under it",
  );
  assert.equal(
    syncSpecHostAllowed(t, { connector: "crm_ledger", connectionId: "con_other" }, "crm-a.test"),
    false,
    "another connection of the same connector is not the spec's",
  );
});

test("another connector, and a connector named like the probe on another connection, keep the rule", () => {
  const t = tables([{ connector: "crm_ledger", connection_id: "con_1", domain: "crm-a.test" }]);
  assert.equal(syncSpecHostAllowed(t, { connector: "acme", connectionId: "con_9" }, "crm-a.test"), false);
  assert.equal(syncSpecHostAllowed(t, { connector: "sync_spec", connectionId: "con_1" }, "crm-a.test"), false);
  assert.equal(
    syncSpecHostAllowed(null, { connector: "crm_ledger", connectionId: "con_1" }, "crm-a.test"),
    false,
    "no tables: no allowance",
  );
});
