import test from "node:test";
import assert from "node:assert/strict";
import { TIME_ZONES, ZONE_LABELS, zoneLabel } from "./space-zones.ts";

test("a common zone reads as its time and city", () => {
  assert.equal(zoneLabel("America/Los_Angeles"), "Pacific Time, Los Angeles");
  assert.equal(zoneLabel("Asia/Kuala_Lumpur"), "Malaysia Time, Kuala Lumpur");
  assert.equal(zoneLabel("UTC"), "UTC");
});

test("a zone not in the list falls back to its id with the underscores taken out", () => {
  assert.equal(zoneLabel("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos Aires");
  assert.equal(zoneLabel(""), "");
});

test("every listed zone has a label with a city, and the list is the label keys", () => {
  assert.deepEqual([...TIME_ZONES], Object.keys(ZONE_LABELS));
  for (const id of TIME_ZONES) if (id !== "UTC") assert.match(zoneLabel(id), /Time, /);
});
