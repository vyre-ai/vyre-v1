// A Space of hundreds of thousands of rows: every change of what a person may read made one pull go through all the rows in one stretch (24 s of a 60 s profile on a firm's server, Nov 2026),
// and the live stream asked again at every commit. The rescan now works in slices of a few ms across pulls, keeps its place, and ends with the same hides.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import type { PullRes } from "../../../sync/src/protocol.ts";
import { openSync } from "../impl.ts";
import type { PullCtx } from "../handlers/index.ts";
import { BO, ADA, CONTACT_TYPE, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const ROWS = 12_000;
const BUDGET_MS = 100;

test("a rescan over a big Space is done in slices, none holds the loop past the budget, and every row is hidden in the end", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const ids: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    const id = mintRecordId();
    ids.push(id);
    await s.store.create("contact", id, {
      name: `N${i}`,
      email: "n@example.com",
      phone: "+1",
      region: "eu",
      stage: "lead",
      owner: ADA,
    });
  }
  const ctx: PullCtx = { trace: { traceId: TRACE }, principal: BO, deviceId: "dev1", deviceClass: "desktop" };
  const pull = (cursor: number): Promise<PullRes> => s.handlers["sync.pull"](ctx, { cursor, epoch: 0 });
  // the device holds every row (pulled in as many pulls as it takes)
  let cur = 0;
  for (;;) {
    const r = await pull(cur);
    cur = r.next;
    if (!r.more) break;
  }
  access.revokeGrant("gr_bo_record");
  const hidden = new Set<string>();
  let slowest = 0,
    calls = 0;
  for (;;) {
    const t0 = performance.now();
    const r = await pull(cur);
    slowest = Math.max(slowest, performance.now() - t0);
    calls++;
    for (const h of r.hide) hidden.add(h.id);
    cur = r.next;
    if (!r.more && calls > 1) break;
    assert.ok(calls < 5000, "the rescan ends");
  }
  assert.equal(hidden.size, ROWS, "every row the person can no longer see is hidden");
  assert.ok(slowest <= BUDGET_MS, `one pull held the loop for ${Math.round(slowest)} ms (budget ${BUDGET_MS} ms)`);
  assert.ok(calls > 2, "the work was split over several pulls");
});
