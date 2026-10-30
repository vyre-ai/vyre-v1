// A connector action is tested only when a stored row says so. Input cannot say tested.
import test from "node:test";
import assert from "node:assert/strict";
import { publishAllowed } from "../connector-breadth.ts";
import { recordConnectorLevel, storedLevel } from "../connector-level.ts";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";

const DRAFT_REASON = "A drafted action cannot be published.";
const FIELD = "sk_live_SECRET";

function definition(key: string, claimed: "draft" | "tested"): Record<string, unknown> {
  return {
    triggers: [{ key: "manual" }],
    nodes: [{ id: "list-customers", key, title: "Stripe: List customers", input: { connectorLevel: claimed } }],
  };
}

async function refused(p: Promise<unknown>, code: string, reason: string, message: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    assert.equal(reasonOf(e), reason);
    assert.equal((e as { message?: string }).message, message);
    return true;
  });
}

async function save(h: Harness, key: string, claimed: "draft" | "tested"): Promise<string> {
  const made = await h.call("automations.create", { name: key, definition: definition(key, claimed) }, alice);
  return made.automation.id as string;
}

test("a stored tested row lets publishAllowed see tested", async () => {
  const h = harness();
  const key = "stripe-listcustomers";
  recordConnectorLevel(h.db, key, "tested", h.now());
  const level = storedLevel(h.db, key);
  assert.equal(level, "tested");
  assert.equal(storedLevel(h.db, "stripe-createcustomer"), undefined);
  if (level !== "tested") return;
  assert.deepEqual(publishAllowed(level), { ok: true });
  const id = await save(h, key, "tested");
  const on = await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  assert.equal(on.automation.status, "on");
  const draftedInput = await save(h, key, "draft");
  const still = await h.call("automations.set_enabled", { automationId: draftedInput, enabled: true }, alice);
  assert.equal(still.automation.status, "on");
});

test("no stored row treats input connectorLevel tested as draft", async () => {
  const h = harness();
  const key = "stripe-listcustomers";
  assert.equal(storedLevel(h.db, key), undefined);
  const decision = publishAllowed("draft");
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.equal(decision.reason, DRAFT_REASON);
  const id = await save(h, key, "tested");
  await refused(
    h.call("automations.set_enabled", { automationId: id, enabled: true }, alice),
    "validation.precondition_failed",
    "draft",
    decision.reason,
  );
  const still = await h.call("automations.get", { automationId: id }, alice);
  assert.notEqual(still.automation.status, "on");
});

test("the stored row never contains a field value", () => {
  const h = harness();
  recordConnectorLevel(h.db, "stripe-listcustomers", "tested", h.now());
  const rows = h.db.all("SELECT * FROM automations_connector_levels") as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.deepEqual(Object.keys(row).sort(), ["action_key", "level", "updated_at"]);
  assert.equal(row["action_key"], "stripe-listcustomers");
  assert.equal(row["level"], "tested");
  assert.equal(row["updated_at"], h.now());
  assert.equal(JSON.stringify(rows).includes(FIELD), false);
  const cols = h.db.all("PRAGMA table_info(automations_connector_levels)") as { name: string }[];
  assert.deepEqual(cols.map((col) => col.name), ["action_key", "level", "updated_at"]);
});
