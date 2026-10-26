// TEMP: prints every flow's trail on the current main.
import test from "node:test";
import assert from "node:assert/strict";
import { runJoining, LIVE_FOR_JOIN } from "./02-person-joining.ts";
import { runOffboarding, LIVE_FOR_OFFBOARDING } from "./09-offboarding.ts";
import { runRestore, LIVE_FOR_RESTORE } from "./11-backup-restore-tombstones.ts";
import { runMatrix, LIVE_FOR_MATRIX } from "./12-permission-matrix.ts";
import { runGate, LIVE_FOR_GATE } from "./07-gate-approval-expiry.ts";
import { runMemory, LIVE_FOR_MEMORY } from "./08-memory-promotion.ts";
import { runPersonal, LIVE_FOR_PERSONAL } from "./15-personal-space-relay.ts";
import { runLead, LIVE_FOR_LEAD } from "./01-lead-to-project.ts";
import { runChanges, LIVE_FOR_CHANGES } from "./03-agent-changes.ts";
import { runConflict, LIVE_FOR_CONFLICT } from "./04-offline-conflict.ts";
import { runSite, LIVE_FOR_SITE } from "./06-site-deploy.ts";
import { runKeyFail, LIVE_FOR_KEYFAIL } from "./10-key-failure.ts";
import { runPrivate, LIVE_FOR_PRIVATE } from "./13-private-chat.ts";
import { runPurge, LIVE_FOR_PURGE } from "./14-sync-purge.ts";
import type { Trail } from "./02-space.ts";

const ALL: [string, () => Promise<{ trail: Trail }>][] = [
  ["01", () => runLead(LIVE_FOR_LEAD)], ["02", () => runJoining(LIVE_FOR_JOIN)], ["03", () => runChanges(LIVE_FOR_CHANGES)], ["04", () => runConflict(LIVE_FOR_CONFLICT)],
  ["06", () => runSite(LIVE_FOR_SITE)], ["07", () => runGate(LIVE_FOR_GATE)], ["08", () => runMemory(LIVE_FOR_MEMORY)], ["09", () => runOffboarding(LIVE_FOR_OFFBOARDING)],
  ["10", () => runKeyFail(LIVE_FOR_KEYFAIL)], ["11", () => runRestore(LIVE_FOR_RESTORE)], ["12", () => runMatrix(LIVE_FOR_MATRIX)], ["13", () => runPrivate(LIVE_FOR_PRIVATE)],
  ["14", () => runPurge(LIVE_FOR_PURGE)], ["15", () => runPersonal(LIVE_FOR_PERSONAL)],
];
for (const [n, run] of ALL) {
  test(`REPORT ${n}`, async () => {
    let text: string;
    try { const { trail } = await run(); const l = trail.lines; text = `ok=${l.filter((x) => x.startsWith("ok")).length} fail=${l.filter((x) => x.startsWith("FAIL")).length} skip=${l.filter((x) => x.startsWith("skip")).length}\n${trail.report()}`; } catch (e) { text = `THREW ${(e as Error).message.slice(0, 600)}`; }
    assert.fail(`\nFLOW ${n}: ${text}`);
  });
}
