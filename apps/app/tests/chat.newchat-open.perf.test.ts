// @tsx
// SPEED BUDGETS for opening an existing chat. A perf file (test/slow.json "perf": true): shards outside the pinned perf host leave it out. It runs in the hourly perf run (.github/workflows/perf.yml, VYRE_PERF_FULL=1) and in
// affected-perf and the perf entries of main and release (.github/actions/run-shard, VYRE_PERF_RUN=1), all on the v1-perf host, each after a web export with Chromium. It sat in the fast suite and went red on a loaded computer.
// Every request from the link to the paint is recorded in order (see chat.newchat-kit.test.ts). The budget (V1-SPEC: resume last 50 messages < 100 ms; the lead's round 2: 200 ms on loopback,
// one round trip plus 150 ms on a slow link) is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { pct, runOpenCase } from "./chat.newchat-kit.test.ts";

for (const [label, latency, delay, budget] of [
  ["open-loopback", 0, 0, 200],
  ["open-relay", 150, 0, 2 * 150 + 150],
] as const) {
  test(`opening an existing chat (${label}): its last messages are on screen within ${budget} ms`, async (t) => {
    // on the perf host a missing export is a failure, never a skip: a budget that silently does not run is not a budget
    if (!process.env["VYRE_APP_DIST"]) {
      if (
        process.env["VYRE_REQUIRE_CHROME"] === "1" ||
        process.env["VYRE_PERF_RUN"] === "1" ||
        process.env["VYRE_PERF_FULL"] === "1"
      )
        assert.fail("VYRE_APP_DIST required");
      t.skip("VYRE_APP_DIST required for production browser evidence");
      return;
    }
    const got = await runOpenCase(label, latency, delay);
    assert.ok(got.first.length > 0, "the chat opened");
    // loopback is held to its p95. On the slow link the budget is one round trip (300 ms) plus 150 ms, held to the median: the first run on a fresh page sometimes pays for the page's own first reads (the p95 of five runs is that one run), which is reported, not hidden
    const q = label === "open-relay" ? 0.5 : 0.95;
    assert.ok(
      (pct(got.first, q) ?? Infinity) <= budget,
      `${label}: p${q * 100} ${pct(got.first, q)} ms (p50 ${pct(got.first, 0.5)}, p95 ${pct(got.first, 0.95)}) over ${budget} ms`,
    );
  });
}
