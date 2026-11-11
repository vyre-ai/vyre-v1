// What needs you says how long it has been so, in words a person says (owner walk, 12 Nov 2026: a fresh Space read "Your team has no AI account since now").
import test from "node:test";
import assert from "node:assert/strict";
import { forHowLong } from "../shell/format.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

test("just started says nothing more; then for minutes, hours, days; then since the date", () => {
  assert.equal(`Your team has no AI account${forHowLong(NOW, NOW - 5_000)}`, "Your team has no AI account");
  assert.equal(forHowLong(NOW, NOW - 5 * 60_000), " for 5 min");
  assert.equal(forHowLong(NOW, NOW - 3 * 3_600_000), " for 3 h");
  assert.equal(forHowLong(NOW, NOW - 2 * 86_400_000), " for 2 d");
  assert.equal(forHowLong(NOW, Date.UTC(2026, 9, 1)), " since 2026-10-01");
  assert.ok(!/since now|ago/.test(forHowLong(NOW, NOW)), "never 'since now' or 'since 3 h ago'");
});
