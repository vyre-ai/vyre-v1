// A session that starts from a ready-made first message gets a title the agent side recognises, so it loads the connector-builder skill; any other message gets none.
import test from "node:test";
import assert from "node:assert/strict";
import { connectorOpening, BUILD_CONNECTOR_OPENING } from "../../vault/itemenv/automations.ts";
import { openingTitle } from "./data.ts";

test("Add to Automations and Build a connector openings have their titles; other messages have none", () => {
  assert.equal(openingTitle(connectorOpening({ name: "Resend", handle: "#Resend" })), "Add Resend to Automations");
  assert.equal(openingTitle(connectorOpening({ name: "Northwind Lawmatics key", handle: "#Nw_Law" })), "Add Northwind Lawmatics key to Automations");
  assert.equal(openingTitle(BUILD_CONNECTOR_OPENING), "Build a connector");
  assert.equal(openingTitle("Hello there"), undefined);
});
