import assert from "node:assert/strict";
import test from "node:test";
import { connectorLine, shownConnectors, visibleInPalette } from "./trust-view.ts";

test("draft connectors stay with the author and secrets are not listed", () => {
  const rows = shownConnectors([
    { key: "acme", title: "Acme", state: "draft", actions: ["ping"], secrets: [{ name: "Acme_Key", description: "API key" }] },
    { key: "stripe", title: "Stripe", builtin: true, state: "live", actions: ["charge"] },
    { key: "hubspot", title: "HubSpot", state: "live", actions: ["contacts"] },
  ], "space");
  assert.deepEqual(rows.map((row) => row.key), ["stripe", "hubspot"]);
  assert.equal(visibleInPalette("draft", "author"), true);
  assert.equal(visibleInPalette("draft", "space"), false);
  assert.equal(JSON.stringify(rows).includes("Acme_Key"), false);
  const author = shownConnectors([{ key: "acme", title: "Acme", state: "failing_tests", actions: [] }], "author");
  assert.equal(author[0]?.label, "Draft, tests failed");
  assert.equal(connectorLine(author[0]!), "Acme · Draft, tests failed · no actions yet");
});
