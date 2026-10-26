// Lane L3 goes live (P-L3_LIVE, P-L3_REC2): the records handler table against the frozen manifest, an exact-set check like the other modules have.
// All 29 capabilities have a handler, and host/modules.json lists records as live.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registry } from "../../../generated/registry.ts";
import { consumers, handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "records").map((c) => c.name).sort();

test("records live: every capability of the manifest has a handler, and no handler is outside it", () => {
  assert.equal(mine.length, 31);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
  for (const name of mine) assert.equal(typeof (handlers as Record<string, unknown>)[name], "function", `${name} has a handler function`);
});

test("records live: host/modules.json serves records live", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../../../host/modules.json", import.meta.url), "utf8")) as { modules: { id: string; status: string }[] };
  assert.equal(file.modules.find((m) => m.id === "records")?.status, "live");
});

test("records live: the site table consumer listens to both site table events, the value consumer to proposals", () => {
  assert.deepEqual(consumers["records.site_tables"].on, ["site.table_created", "site.table_promoted"]);
  assert.equal(typeof consumers["records.site_tables"].run, "function");
  assert.deepEqual(consumers["records.value_source"].on, ["record.value_proposed"]);
  assert.equal(typeof consumers["records.value_source"].run, "function");
});
