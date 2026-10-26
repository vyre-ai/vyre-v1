// TEMP: prints the trails of flows 3, 9 and 10.
import test from "node:test";
import assert from "node:assert/strict";
import { runChanges, LIVE_FOR_CHANGES } from "./03-agent-changes.ts";
import { runOffboarding, LIVE_FOR_OFFBOARDING } from "./09-offboarding.ts";
import { runKeyFail, LIVE_FOR_KEYFAIL } from "./10-key-failure.ts";
import type { Trail } from "./02-space.ts";
const ALL: [string, () => Promise<{ trail: Trail; events: { type: string }[] }>][] = [
  ["03", () => runChanges(LIVE_FOR_CHANGES)], ["09", () => runOffboarding(LIVE_FOR_OFFBOARDING)], ["10", () => runKeyFail(LIVE_FOR_KEYFAIL)],
];
for (const [n, run] of ALL) {
  test(`REPORT ${n}`, async () => {
    let text: string;
    try { const { trail, events } = await run(); const l = trail.lines; text = `ok=${l.filter((x) => x.startsWith("ok")).length} fail=${l.filter((x) => x.startsWith("FAIL")).length} skip=${l.filter((x) => x.startsWith("skip")).length}\n${trail.report()}\nEVENTS ${events.map((e) => e.type).join(",")}`; } catch (e) { text = `THREW ${(e as Error).message.slice(0, 600)}`; }
    assert.fail(`\nFLOW ${n}: ${text}`);
  });
}
