// A package carries the definition and nothing else. Import makes a Personal Draft and lists what the importer still has to connect.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import { alice, bob, node } from "../fixtures/seed.ts";

const definition = {
  triggers: [{ key: "manual" }],
  nodes: [
    node("ask", "connector_request", { connector: "stripe", action: "ping", connectionId: "con_source1", input: { account: "#Stripe.account" } }, { next: ["again"] }),
    node("again", "connector_request", { connector: "stripe", action: "ping", connectionId: "con_source1" }, { next: ["other"] }),
    node("other", "connector_request", { connector: "slack", action: "ping", connectionId: "con_source2" }),
  ],
};

async function exported() {
  const h = harness({ calls: { "connections.list": () => ({ connections: [{ connectionId: "con_mine1" }, { connectionId: "con_mine2" }] }) } });
  const made = await h.call("automations.create", { name: "Welcome", definition }, alice);
  const out = await h.call("automations.packages.export", { automationId: made.automation.id, name: "Welcome pack" }, alice);
  return { h, id: made.automation.id as string, pkg: out.package };
}

test("an export holds no connection id, no key and no Vault value", async () => {
  const { h, pkg } = await exported();
  assert.equal(pkg.name, "Welcome pack");
  assert.deepEqual(pkg.requires.connections.map((c: { slot: string; stepIds: string[] }) => [c.slot, c.stepIds]), [["con_slot1", ["ask", "again"]], ["con_slot2", ["other"]]]);
  assert.deepEqual(pkg.requires.vault, ["#Stripe.account"]);
  const stored = (h.db.all("SELECT definition FROM automations_packages WHERE id = ?", pkg.id) as { definition: string }[])[0]!.definition;
  assert.doesNotMatch(stored, /con_source/);
  assert.match(stored, /con_slot1/);
});

test("an AI step loses its personal key and the package says so", async () => {
  const h = harness();
  const made = await h.call("automations.create", {
    name: "Reply", definition: { triggers: [{ key: "manual" }], nodes: [node("think", "ai", { prompt: "Write a reply" }, { ai: { keyId: "vit_personal1", agentId: "agt_helper1" } })] },
  }, alice);
  const { package: pkg } = await h.call("automations.packages.export", { automationId: made.automation.id }, alice);
  assert.deepEqual(pkg.requires.keys, ["think"]);
  const stored = (h.db.all("SELECT definition FROM automations_packages WHERE id = ?", pkg.id) as { definition: string }[])[0]!.definition;
  assert.doesNotMatch(stored, /vit_personal1/);
});

test("import makes a Personal Draft with the importer's own connections and lists what is left", async () => {
  const { h, pkg } = await exported();
  const out = await h.call("automations.packages.import", { packageId: pkg.id, connections: { con_slot1: "con_mine1" } }, alice);
  assert.equal(out.automation.kind, "personal");
  assert.equal(out.automation.status, "draft");
  assert.equal(out.automation.name, "Welcome pack");
  const ids = out.automation.definition.nodes.map((n: { input: { connectionId: string } }) => n.input.connectionId);
  assert.deepEqual(ids, ["con_mine1", "con_mine1", "con_slot2"]);
  assert.deepEqual(out.needs.connections.map((c: { slot: string }) => c.slot), ["con_slot2"]);
  assert.deepEqual(out.needs.vault, ["#Stripe.account"]);
});

test("a connection the importer cannot use is refused", async () => {
  const { h, pkg } = await exported();
  await assert.rejects(h.call("automations.packages.import", { packageId: pkg.id, connections: { con_slot1: "con_notmine" } }, alice), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(h.call("automations.packages.import", { packageId: pkg.id, connections: { con_slot9: "con_mine1" } }, alice), (e) => codeOf(e) === "validation.bad_input");
});

test("a package belongs to the person who exported it", async () => {
  const { h, pkg } = await exported();
  assert.equal((await h.call("automations.packages.list", {}, alice)).packages.length, 1);
  assert.equal((await h.call("automations.packages.list", {}, bob)).packages.length, 0);
  await assert.rejects(h.call("automations.packages.import", { packageId: pkg.id }, bob), (e) => codeOf(e) === "validation.not_found");
});
