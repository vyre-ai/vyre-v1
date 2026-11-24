// Pressing Share on a big Space answers at once (18 Nov 2026: 3.2 s on a firm's 140,000 records, a person feels a broken button). The share and the unshare each took a full read of every access table into
// a store of their own, a snapshot built from it, a write of every row to find the changed ones, and then a second full read by the sync that follows. They now run on a view of the kept store and write
// the grants that changed. A Space of 20,000 records is shared and unshared a few times: each call and the first list after it stay inside the budget. A speed number counts only on the v1-perf
// runners (ruling 46); the same run on 140,000 records is in the lane notes.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./support/live.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const N = 20_000;
const CALL_BUDGET_MS = 250;
const READ_BUDGET_MS = 150;
let n = 0;
async function cap(d: Any, c: string, input: Record<string, unknown> = {}): Promise<Any> {
  const r = await call(d, c, { idempotencyKey: `sc-${c}-${++n}-${Math.random()}`, ...input });
  assert.equal(r.status, 200, `${c}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}
const timed = async (d: Any, c: string, input: Record<string, unknown>): Promise<number> => {
  const t = performance.now();
  await cap(d, c, input);
  return Math.round(performance.now() - t);
};
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test(
  "a share and an unshare on a Space of 20,000 records answer within the budget, and so does the first list after each",
  { timeout: 300_000 },
  async () => {
    const d = await boot(seededDir(), null);
    try {
      await cap(d, "schema.apply", {
        ops: [
          {
            op: "type.create",
            type: "rt_big",
            def: {
              title: "Big",
              plural: "Bigs",
              icon: "table",
              titleField: "name",
              fields: [{ key: "name", type: "text", title: "Name", required: true }],
            },
          },
        ],
      });
      for (let at = 0; at < N; at += 500)
        await cap(d, "records.bulk_upsert", {
          type: "rt_big",
          match: ["name"],
          rows: Array.from({ length: 500 }, (_, i) => ({ name: `R ${at + i}` })),
          createOnly: true,
          runAutomations: false,
        });
      const root = ((await cap(d, "files.tree", {})).roots as Any[]).find((r) => r.key === "shared_knowledge")
        ?.folderId as string;
      const folder = (await cap(d, "files.folder.create", { parentId: root, name: "Probe" })).folder.folderId as string;
      const lists = { type: "file", limit: 500 };
      await cap(d, "access.lists", lists);
      const shares: number[] = [];
      const unshares: number[] = [];
      const readsAfterShare: number[] = [];
      const readsAfterUnshare: number[] = [];
      for (let k = 0; k < 5; k++) {
        let t = performance.now();
        const g = await cap(d, "access.share", {
          resource: { type: "folder", id: folder },
          subject: { kind: "person", id: "usr_noah" },
          level: "view",
        });
        shares.push(Math.round(performance.now() - t));
        readsAfterShare.push(await timed(d, "access.lists", lists));
        t = performance.now();
        await cap(d, "access.unshare", { grantId: g.grant.grantId ?? g.grant.id });
        unshares.push(Math.round(performance.now() - t));
        readsAfterUnshare.push(await timed(d, "access.lists", lists));
      }
      process.stderr.write(
        `[share-call] share ${median(shares)} ms, unshare ${median(unshares)} ms, first list after a share ${median(readsAfterShare)} ms, after an unshare ${median(readsAfterUnshare)} ms\n`,
      );
      assert.ok(median(shares) <= CALL_BUDGET_MS, `a share took ${median(shares)} ms (budget ${CALL_BUDGET_MS} ms)`);
      assert.ok(
        median(unshares) <= CALL_BUDGET_MS,
        `an unshare took ${median(unshares)} ms (budget ${CALL_BUDGET_MS} ms)`,
      );
      assert.ok(
        median(readsAfterShare) <= READ_BUDGET_MS,
        `the first list after a share took ${median(readsAfterShare)} ms (budget ${READ_BUDGET_MS} ms)`,
      );
      assert.ok(
        median(readsAfterUnshare) <= READ_BUDGET_MS,
        `the first list after an unshare took ${median(readsAfterUnshare)} ms (budget ${READ_BUDGET_MS} ms)`,
      );

      // the same Space grows to 50,000 records (a sync): the first list after it builds the view in slices, and the loop is never held for 200 ms by it or by anything it does
      const grow = async (from: number, to: number): Promise<void> => {
        for (let at = from; at < to; at += 500)
          await cap(d, "records.bulk_upsert", {
            type: "rt_big",
            match: ["name"],
            rows: Array.from({ length: 500 }, (_, i) => ({ name: `R ${at + i}` })),
            createOnly: true,
            runAutomations: false,
          });
      };
      const g0 = (await cap(d, "access.share", {
        resource: { type: "folder", id: folder },
        subject: { kind: "person", id: "usr_noah" },
        level: "view",
      })) as Any;
      await grow(N, 50_000);
      const gap = async <T>(f: () => Promise<T>): Promise<{ out: T; worst: number }> => {
        let last = performance.now();
        let worst = 0;
        const t = setInterval(() => {
          const n2 = performance.now();
          worst = Math.max(worst, n2 - last);
          last = n2;
        }, 2);
        try {
          return { out: await f(), worst };
        } finally {
          clearInterval(t);
        }
      };
      const cold = await gap(() => cap(d, "access.lists", lists));
      process.stderr.write(
        `[share-call] first list after 30,000 records were added: longest block ${Math.round(cold.worst)} ms\n`,
      );
      assert.ok(cold.worst < 200, `the first list held the loop for ${Math.round(cold.worst)} ms (budget 200 ms)`);
      // a revoke asked in the middle of a build waits for it (up to a build's worth of turns) and is there at once after
      await grow(50_000, 55_000);
      const building = cap(d, "access.lists", lists);
      await new Promise((r) => setTimeout(r, 20));
      const t1 = performance.now();
      const revoked = await gap(() => cap(d, "access.unshare", { grantId: g0.grant.grantId ?? g0.grant.id }));
      const waited = Math.round(performance.now() - t1);
      await building;
      process.stderr.write(
        `[share-call] an unshare asked in the middle of a build waited ${waited} ms, longest block ${Math.round(revoked.worst)} ms\n`,
      );
      assert.ok(revoked.worst < 200, `the unshare held the loop for ${Math.round(revoked.worst)} ms (budget 200 ms)`);
    } finally {
      await d.stop();
    }
  },
);
