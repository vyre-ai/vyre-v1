// The Space's gate.* settings reach the Gate: the settings module announces a change and the Gate keeps the copy it reads. Nothing else ever wrote gate_policy.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { HOUR, NOW, as, bot, parkInput } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";
import { findHold, readPolicy } from "../projections.ts";

const announce = (h: ReturnType<typeof harness>, payload: Record<string, unknown>): Promise<string[]> => consumers["gate.settings_sync"].run({ db: h.db } as never, { payload });

test("changing a gate setting changes when a hold times out and when the approver is emailed", async () => {
  const h = harness();
  assert.deepEqual(await announce(h, { key: "gate.timeout_hours", scope: "space", after: 6 }), ["gate.timeout_hours"]);
  await announce(h, { key: "gate.email_backstop_hours", scope: "space", after: 2 });
  const r = await h.call("gate.park", parkInput({}), as(bot));
  assert.deepEqual(h.schedules.map((s) => s.at), [NOW + 6 * HOUR, NOW + 2 * HOUR]);
  assert.equal(findHold(h.db, r.holdId)!.expiresAt, NOW + 6 * HOUR);
});

test("a reset goes back to the shipped value, and other settings are not the Gate's", async () => {
  const h = harness();
  await announce(h, { key: "gate.drafted_by_label", scope: "space", after: false });
  assert.equal(readPolicy(h.db).draftedByLabel, false);
  await announce(h, { key: "gate.drafted_by_label", scope: "space", after: true });
  assert.equal(readPolicy(h.db).draftedByLabel, true);
  assert.deepEqual(await announce(h, { key: "tasks.allow_self_review", scope: "space", after: true }), []);
  assert.deepEqual(await announce(h, { key: "gate.timeout_hours", scope: "person", person: "usr_a", after: 1 }), [], "a person row is not the Space's");
});
