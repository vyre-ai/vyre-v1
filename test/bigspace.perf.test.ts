// The big-Space run of test/bigspace.live.test.ts with its speed budgets: first open to live under 5 s, the server's consumers caught up within 30 s of
// the last write, the table's first page under 1 s, one record under 300 ms, a search under 500 ms, a posted message under 200 ms. Marked perf in
// test/slow.json: a speed number counts only on the v1-perf runners (ruling 46).
import test from "node:test";
import { bigSpaceScenario } from "./support/bigspace-scenario.ts";

test(
  "a big Space meets its speed budgets: live in 5 s, caught up in 30 s, a page in 1 s, a record in 300 ms, a search in 500 ms, a post in 200 ms",
  { timeout: 600_000 },
  () => bigSpaceScenario(true),
);
