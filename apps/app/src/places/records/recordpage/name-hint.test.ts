// The name a tapped row leaves for the page that opens: remembered by record, and forgotten on sign-out (clearStored), so the next person sees none of it.
import test from "node:test";
import assert from "node:assert/strict";
import { clearRecordNames, recordNameHint, rememberRecordName } from "./name-hint.ts";

test("a remembered name comes back for its record only, an empty one is not kept, and clearing forgets all", () => {
  rememberRecordName("rec_1", "Northwind");
  rememberRecordName("rec_2", "   ");
  assert.equal(recordNameHint("rec_1"), "Northwind");
  assert.equal(recordNameHint("rec_2"), "");
  assert.equal(recordNameHint("rec_3"), "");
  clearRecordNames();
  assert.equal(recordNameHint("rec_1"), "");
});

test("clearStored (a sign-out) forgets the names", async () => {
  const { clearStored } = await import("../../../shell/session/stored.ts");
  rememberRecordName("rec_9", "Harbor Studio");
  const store = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  clearStored(store as never);
  assert.equal(recordNameHint("rec_9"), "");
});
