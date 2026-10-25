// Lane L3 goes live (P-L3_LIVE): the records handler table against the frozen manifest. Records is NOT flipped to live yet: 11 of the 29 capabilities have no handler,
// and a live module with a missing handler refuses the whole boot. STILL_MISSING is the work of the follow-up packet (P-L3_REC2); when it lands the list is emptied, the
// assertion below becomes the exact-set check the other modules have, and host/modules.json flips `records` to live.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { consumers, handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "records").map((c) => c.name).sort();
const STILL_MISSING = ["records.changes", "records.completeness", "records.gap_check", "records.page_prefs.get", "records.page_prefs.set", "records.relate", "records.relations_map", "records.value_source", "records.values.pending", "records.values.review", "records.view"];

test("records live: every capability has a handler except the named gap, and the gap has none", () => {
  assert.equal(mine.length, 29);
  const have = Object.keys(handlers).sort();
  assert.deepEqual([...have, ...STILL_MISSING].sort(), mine);
  for (const name of have) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
  for (const name of STILL_MISSING) assert.equal((handlers as Record<string, unknown>)[name], undefined, `${name} is a known gap, not a half-done handler`);
});

test("records live: the site table consumer listens to both site table events", () => {
  assert.deepEqual(consumers["records.site_tables"].on, ["site.table_created", "site.table_promoted"]);
  assert.equal(typeof consumers["records.site_tables"].run, "function");
});
