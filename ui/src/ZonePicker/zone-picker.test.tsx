// The zone picker: its button says the zone, the city and the time there; the sheet lists cities with offset and time, ticks the current one, finds by city, and choosing another calls onChange once.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../testing/dom.ts";
import { ZonePicker, zoneLine } from "./index.tsx";

const NOW = Date.parse("2026-11-04T22:28:00Z");   // 2:28 PM Pacific

test("the button reads like the row: name, city, time now", () => {
  assert.equal(zoneLine("America/Los_Angeles", NOW), "Pacific Time, Los Angeles, 2:28 PM");
  assert.equal(zoneLine("UTC", NOW), "Coordinated Universal Time, UTC, 10:28 PM");
  assert.equal(zoneLine("Not/AZone", NOW), "Not/AZone");
});

test("pressing it opens a sheet with city, UTC offset and the time there, ticks the current zone, finds by city, and choosing another calls onChange with its id", async () => {
  installDom();
  const got: string[] = [];
  const root = await mount(createRoot, <ZonePicker value="America/Los_Angeles" now={NOW} onChange={(z) => got.push(z)} testID="zp" extra={{ label: "Use this computer's time zone", onSelect: () => got.push("device") }} />);
  assert.match(textOf(find(root, "zp")), /Pacific Time, Los Angeles, 2:28 PM/);
  assert.equal(find(root, "zone-sheet"), null);
  await press(find(root, "zp"));
  await flush();
  const la = find(root, "zone-row-America/Los_Angeles");
  assert.ok(la, "the current zone is a row");
  assert.match(textOf(la), /Los Angeles/);
  assert.match(textOf(la), /UTC-8/);
  assert.match(textOf(la), /2:28 PM/);
  assert.match(textOf(la), /\u2713/, "the current one is ticked");
  assert.ok(find(root, "zone-extra"), "the extra row leads the list");
  await typeInto(find(root, "zone-search"), "karachi");
  await flush();
  assert.equal(find(root, "zone-row-America/Los_Angeles"), null, "the search narrows the list");
  const khi = find(root, "zone-row-Asia/Karachi");
  assert.ok(khi);
  assert.match(textOf(khi), /UTC\+5/);
  assert.match(textOf(khi), /3:28 AM/);
  await press(khi);
  await flush();
  assert.deepEqual(got, ["Asia/Karachi"]);
  assert.equal(find(root, "zone-sheet"), null, "choosing closes the sheet");
  await press(find(root, "zp"));
  await flush();
  await press(find(root, "zone-row-America/Los_Angeles"));
  assert.deepEqual(got, ["Asia/Karachi"], "the same zone is not a change");
  await press(find(root, "zp"));
  await flush();
  await press(find(root, "zone-extra"));
  assert.deepEqual(got, ["Asia/Karachi", "device"]);
});
