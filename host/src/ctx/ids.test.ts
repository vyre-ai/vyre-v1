// Event ids in the contract's form, and the commit wrapper that applies it.
import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_ID, eventIdOf, mintEventId, normalizeEvent, withEventIds } from "../ids.ts";
import type { CommitBatch } from "../invoke.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";

const ev = (id: string, o: Partial<EventEnvelope> = {}): EventEnvelope => ({
  seq: 0, id, type: "record.updated", sv: 1, hlc: "h", at: 1, traceId: "a".repeat(32), actor: "usr_a", depth: 0, label: 0, vis: "space", enc: 0, payload: {}, ...o,
});

test("minted event ids match evt_[a-z0-9]+ and sort by time", () => {
  const a = mintEventId(1_000_000), b = mintEventId(2_000_000), c = mintEventId(3_000_000);
  for (const id of [a, b, c]) assert.match(id, EVENT_ID);
  assert.ok(a < b && b < c, "ids sort in time order");
  assert.notEqual(mintEventId(5), mintEventId(5), "same millisecond, still unique");
});

test("a dashed host id becomes the contract form, and the mapping is stable", () => {
  const raw = "evt_0190a1b2-c3d4-4e5f-8a6b-7c8d9e0f1a2b";
  assert.equal(eventIdOf(raw), "evt_0190a1b2c3d44e5f8a6b7c8d9e0f1a2b");
  assert.equal(eventIdOf(eventIdOf(raw)), eventIdOf(raw));
  assert.equal(eventIdOf("EVT_ABC-123"), "evt_abc123");
});

test("normalizeEvent fixes id and cause and leaves a good event as it is", () => {
  const good = ev("evt_abc123");
  assert.equal(normalizeEvent(good), good);
  const fixed = normalizeEvent(ev("evt_0190-aa", { cause: "evt_0190-bb" }));
  assert.equal(fixed.id, "evt_0190aa");
  assert.equal(fixed.cause, "evt_0190bb");
  const noCause = normalizeEvent(ev("evt_0190-aa"));
  assert.equal("cause" in noCause, false);
});

test("withEventIds hands the log events with contract ids and keeps the rest of the batch", async () => {
  let seen: CommitBatch | undefined;
  const commit = withEventIds(async (b) => { seen = b; return b.events.map((e, i) => ({ ...e, seq: i + 1 })); });
  const batch: CommitBatch = { cap: "x.y", v: 1, principal: "usr_a", events: [ev("evt_aa-bb"), ev("evt_cc-dd", { cause: "evt_aa-bb" })], audit: null };
  const stored = await commit(batch);
  assert.deepEqual(stored.map((e) => e.id), ["evt_aabb", "evt_ccdd"]);
  assert.equal(stored[1]!.cause, "evt_aabb", "a cause still points at the event it named");
  assert.equal(seen?.cap, "x.y");
  assert.equal(batch.events[0]!.id, "evt_aa-bb", "the caller's batch is not changed");
  for (const e of stored) assert.match(e.id, EVENT_ID);
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.
