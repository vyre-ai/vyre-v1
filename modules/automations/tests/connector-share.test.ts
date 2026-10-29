// A shared connector keeps tested actions and drops the key.
import test from "node:test";
import assert from "node:assert/strict";
import { shareConnector, connectorShares } from "../handlers/connector-share.ts";
import type { LevelDb } from "../connector-level.ts";
import type { AutoCtx } from "../projections.ts";

const SECRET = "sk_live_SECRET";

function db(): LevelDb & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    all(sql: string, ...args: unknown[]) {
      if (sql.includes("automations_connector_levels")) {
        return args[0] === "stripe-listcustomers" ? [{ level: "tested" }] : [];
      }
      return rows;
    },
    run(_sql: string, ...args: unknown[]) {
      rows.push({ action_key: args[0], app_name: args[1], title: args[2], level: args[3], updated_at: args[4] });
      return { changes: 1 };
    },
  };
}

test("only a tested action is shared, and the key is not stored", () => {
  const store = db();
  const ctx = { db: store, now: () => 9 } as AutoCtx;
  const shared = shareConnector(ctx, {
    appName: "Stripe",
    vaultItemId: "vit_stripe",
    keyValue: SECRET,
    actions: [
      { key: "stripe-listcustomers", title: "Stripe: List customers", level: "draft" },
      { key: "stripe-createcustomer", title: "Stripe: Create customer" },
      { key: "stripe-secret", title: `Stripe: ${SECRET}` },
    ],
  });
  assert.deepEqual(shared, {
    appName: "Stripe",
    actions: [{ key: "stripe-listcustomers", title: "Stripe: List customers", level: "draft" }],
  });
  assert.equal(JSON.stringify(shared).includes(SECRET), false);
  assert.equal(JSON.stringify(store.rows).includes(SECRET), false);
  assert.equal(JSON.stringify(store.rows).includes("vit_stripe"), false);
  assert.deepEqual(connectorShares(ctx), { connectors: [shared] });
});
