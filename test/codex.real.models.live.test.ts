// Codex for real: every model the account lists answers a turn.
// Runs only when VYRE_TEST_CODEX_HOME names a signed-in Codex home; otherwise every test here is SKIPPED with that reason, never passed. See test/support/codex-real.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME, answer, collect, errors, launcher, open, opts, say, toolNames, work } from "./support/codex-real.ts";
import { listCliModels } from "../agent/src/drivers/cli/models.ts";
import type { DriverEvent } from "../agent/src/turn-engine/types.ts";

test("(d) every model the account lists answers a turn", opts, async () => {
  const models = await listCliModels(launcher(HOME), "codex", { timeoutMs: 60_000 });
  assert.ok(models.length > 0, "the CLI listed models");
  const bad: string[] = [];
  for (const m of models) {
    const s = await open(m.id);
    const ev = await collect(s.send(say("Reply with the single word pong.")));
    const e = errors(ev);
    if (e.length > 0 || !/pong/i.test(answer(ev))) bad.push(`${m.id}: ${e.map((x) => `${x.code} ${x.message}`).join("; ") || answer(ev).slice(0, 80)}`);
    await s.close();
  }
  assert.deepEqual(bad, [], "models that failed");
});
