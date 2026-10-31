// Which steps use which Vault item: read by handle from the step input, only for Automations the caller can see, never a value.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bob, create, goodDefinition, node } from "../fixtures/seed.ts";
import { vaultUsage } from "../handlers/vault-usage.ts";

const SENTINEL = "sk_live_SECRET_VALUE";

async function mk(h: ReturnType<typeof harness>, name: string, nodes: ReturnType<typeof node>[], who = alice): Promise<string> {
  const def = goodDefinition({ nodes });
  return (await h.call("automations.create", create({ name, definition: def }), who)).automation.id as string;
}

test("a step that names #Acme_API.api_key counts as a use of the item #Acme_API, with the step title", async () => {
  const h = harness();
  const id = await mk(h, "Sync invoices", [node("n1", "http_request", { method: "GET", url: "https://api.acme.example/v1/invoices", auth: { kind: "bearer", handle: "#Acme_API.api_key" } }, { title: "Read invoices" })]);
  const out = vaultUsage(h.ctxFor("automations.vault_usage", alice), {});
  assert.deepEqual(out, { uses: [{ handle: "#Acme_API", automations: [{ automationId: id, name: "Sync invoices", status: "draft", steps: [{ nodeId: "n1", title: "Read invoices" }] }] }] });
  assert.equal(JSON.stringify(out).includes(SENTINEL), false);
});

test("one item asked for returns only that item; a step without a title shows its kind", async () => {
  const h = harness();
  await mk(h, "Two keys", [
    node("n1", "http_request", { method: "GET", url: "https://a.example/x", auth: { kind: "bearer", handle: "#Acme_API" } }),
    node("n2", "http_request", { method: "GET", url: "https://b.example/x", auth: { kind: "bearer", handle: "#Other_Key.token" } }),
  ]);
  const one = vaultUsage(h.ctxFor("automations.vault_usage", alice), { handle: "#Acme_API.api_key" });
  assert.equal(one.uses.length, 1);
  assert.equal(one.uses[0]!.handle, "#Acme_API");
  assert.deepEqual(one.uses[0]!.automations[0]!.steps, [{ nodeId: "n1", title: "http_request" }]);
  assert.deepEqual(vaultUsage(h.ctxFor("automations.vault_usage", alice), { handle: "#Nobody" }), { uses: [] });
});

test("an Automation the caller cannot see is not listed", async () => {
  const h = harness();
  await mk(h, "Private", [node("n1", "http_request", { method: "GET", url: "https://a.example/x", auth: { kind: "bearer", handle: "#Acme_API" } })]);
  assert.deepEqual(vaultUsage(h.ctxFor("automations.vault_usage", bob), {}), { uses: [] });
});
