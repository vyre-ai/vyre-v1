// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { agoShort, brandOf, dotOf, dotTip, markOf, pageState, progressOf, recordsLine, replacedLine, savedTip } from "./model.ts";

const base = { state: "syncing" as const, pending: 0, conflicts: 0, schemaChanges: 0 };

test("the dot: needs you beats paused beats syncing beats live", () => {
  assert.equal(dotOf(base), "live");
  assert.equal(dotOf({ ...base, pending: 2 }), "syncing");
  assert.equal(dotOf({ ...base, state: "initial" }), "syncing");
  assert.equal(dotOf({ ...base, state: "paused", pending: 2 }), "paused");
  assert.equal(dotOf({ ...base, state: "paused", conflicts: 1 }), "needs");
  assert.equal(dotOf({ ...base, state: "error" }), "needs");
  assert.equal(dotOf({ ...base, schemaChanges: 3 }), "needs");
});

test("the dot's tooltip says what is going on in a few words", () => {
  assert.equal(dotTip(base, "Ledger"), "In step with Ledger");
  assert.equal(dotTip({ ...base, state: "initial" }, "Ledger"), "Bringing in from Ledger");
  assert.equal(dotTip({ ...base, pending: 1 }, "Ledger"), "Sending 1 change to Ledger");
  assert.equal(dotTip({ ...base, conflicts: 2, schemaChanges: 1 }, "Ledger"), "Ledger: 2 changes to decide, 1 field change to review");
  assert.equal(dotTip({ ...base, state: "paused" }, "Ledger"), "Sync with Ledger is paused");
  assert.equal(dotTip({ ...base, state: "error" }, "Ledger"), "Ledger needs you to sign in again");
});

test("time is short: seconds, minutes, hours, days", () => {
  const now = 1_000_000_000;
  assert.deepEqual([2_000, 90_000, 3 * 3_600_000, 2 * 86_400_000, 100].map((d) => agoShort(now - d, now)), ["2 s", "2 min", "3 h", "2 d", "1 s"]);
  assert.equal(savedTip("HubSpot", now - 2000, now), "Saved to HubSpot 2 s ago");
  assert.equal(savedTip("HubSpot", undefined, now), "Saved to HubSpot");
});

test("the mark beside a field: lock for what the app owns, then saving, failed, saved", () => {
  const now = 1_000_000_000;
  const f = { dir: "both" as const, state: "synced" as const, history: 0 };
  assert.deepEqual(markOf({ ...f, dir: "pull" }, "Ledger", now), { kind: "lock", tip: "Read from Ledger. Change it there." });
  assert.deepEqual(markOf({ ...f, state: "saving" }, "Ledger", now), { kind: "saving", tip: "Saving to Ledger" });
  assert.deepEqual(markOf({ ...f, state: "failed", error: "The app answered 500." }, "Ledger", now), { kind: "failed", tip: "Could not save to Ledger: The app answered 500. Press to try again." });
  assert.deepEqual(markOf({ ...f, at: now - 2000 }, "Ledger", now), { kind: "saved", tip: "Saved to Ledger 2 s ago" });
  assert.equal(markOf({ ...f, dir: "off" }, "Ledger", now).kind, "none");
  assert.equal(markOf({ ...f, state: "local" }, "Ledger", now).kind, "local");
});

test("history lines say who replaced the value", () => {
  const now = 10_000_000;
  assert.equal(replacedLine({ historyId: "1", value: "a", replacedBy: "app", actor: "sync:x", at: now - 120_000 }, "Ledger", now), "Replaced by Ledger 2 min ago");
  assert.equal(replacedLine({ historyId: "2", value: "a", replacedBy: "you", actor: "source:x" }, "Ledger", now), "Your newer change replaced it");
});

test("logos come from the app's name, then its host, else a letter", () => {
  assert.equal(brandOf({ title: "HubSpot" }), "hubspot");
  assert.equal(brandOf({ title: "Acme", domain: "api.lawmatics.com" }), "lawmatics");
  assert.equal(brandOf({ title: "Ledger", domain: "crm-a.test" }), null);
  assert.equal(brandOf(undefined, "crm_hubspot"), "hubspot");
});

test("counts and progress", () => {
  assert.equal(recordsLine(1240, 4812), "1,240 of 4,812");
  assert.equal(recordsLine(1, undefined), "1 record");
  assert.equal(progressOf(1240, 4812)?.toFixed(2), "0.26");
  assert.equal(progressOf(5, undefined), null);
  assert.equal(progressOf(9, 4), 1);
  assert.equal(pageState({ state: "syncing", paused: true, pending: 0, conflicts: 0, schemaChanges: 0 }), "paused");
});
