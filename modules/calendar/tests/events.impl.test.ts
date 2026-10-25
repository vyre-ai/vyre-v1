// The module entry: every capability the manifest declares for calendar has a handler, and the handlers answer through the entry the host loads.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { at, contractErrors, harness, seedCalendar } from "../fixtures/harness.ts";

test("impl serves exactly the capabilities the manifest declares for calendar", () => {
  const declared = [...new Set(registry.capabilities.filter((c) => c.module === "calendar").map((c) => c.name))].sort();
  assert.equal(declared.length, 19);
  assert.deepEqual(Object.keys(handlers).sort(), declared);
});

test("a write and a read go through the entry the host loads and answer in the frozen shapes", async () => {
  const h = harness();
  seedCalendar(h, "cld_work01");
  const ctx = h.ctx as never;
  const made = await handlers["calendar.create_event"]!(ctx, { calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11), idempotencyKey: "idem_1" });
  assert.deepEqual(contractErrors("calendar.create_event", "out", made), []);
  const listed = await handlers["calendar.list_events"]!(ctx, { from: at(1, 0), to: at(2, 0) });
  assert.deepEqual(contractErrors("calendar.list_events", "out", listed), []);
  assert.equal((listed as { events: unknown[] }).events.length, 1);
  const health = await handlers["calendar.health"]!(ctx, {});
  assert.deepEqual(contractErrors("calendar.health", "out", health), []);
});
