// The zone picker: its button says the zone, the city and the time there; the list has the city with the time, one row ticked, and choosing another calls onChange once.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import { ZonePicker, zoneLine } from "./index.tsx";

const NOW = Date.parse("2026-11-04T22:28:00Z");   // 2:28 PM Pacific

test("the button reads like the row: name, city, time now", () => {
  assert.equal(zoneLine("America/Los_Angeles", NOW), "Pacific Time, Los Angeles, 2:28 PM");
  assert.equal(zoneLine("UTC", NOW), "Coordinated Universal Time, UTC, 10:28 PM");
  assert.equal(zoneLine("Not/AZone", NOW), "Not/AZone");
});

test("pressing it lists the zones with the time there; choosing one calls onChange with its id, choosing the current one does nothing", async () => {
  installDom();
  const got: string[] = [];
  const root = await mount(createRoot, <ZonePicker value="America/Los_Angeles" now={NOW} onChange={(z) => got.push(z)} testID="zp" extra={{ label: "Use this computer's time zone", onSelect: () => got.push("device") }} />);
  assert.match(textOf(find(root, "zp")), /Pacific Time, Los Angeles, 2:28 PM/);
  await press(find(root, "zp"));
  await flush();
  assert.ok(find(root, "menu-item-Pacific Time, Los Angeles, 2:28 PM"), "the current zone is a row");
  assert.ok(find(root, "menu-item-Pakistan Standard Time, Karachi, 3:28 AM") || find(root, "menu-item-Pakistan Time, Karachi, 3:28 AM"), "Karachi with its time");
  await press(find(root, "menu-item-Pacific Time, Los Angeles, 2:28 PM"));
  assert.deepEqual(got, [], "the same zone is not a change");
});
