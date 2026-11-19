// Pressing Share on a big Space answers at once (18 Nov 2026: 3.2 s on a firm's 140,000 records, a person feels a broken button). The share and the unshare each took a full read of every access table into
// a store of their own, a snapshot built from it, a write of every row to find the changed ones, and then a second full read by the sync that follows. They now run on a view of the kept store and write
// the grants that changed. A Space of 20,000 records is shared and unshared a few times: each call and the first list after it stay inside the budget. A speed number counts only on the v1-perf
// runners (ruling 46); the same run on 140,000 records is in the lane notes.
import os from "node:os";
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
  "a share, an unshare and a change of a share on a Space of 20,000 records answer within the budget, and so does the first list after each and after a sync",
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
      // A speed number on a box with other work on it is noisy (a read of 77 ms in one run was 153 ms in the next): up to three rounds, each a median of its own calls; the best round counts, and the load
      // the box had is printed with every round.
      const round = async (r: number) => {
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
        // a change of a share's level
        const updates: number[] = [];
        const g2 = await cap(d, "access.share", {
          resource: { type: "folder", id: folder },
          subject: { kind: "person", id: "usr_noah" },
          level: "view",
        });
        for (let k = 0; k < 4; k++) {
          const t0 = performance.now();
          await cap(d, "access.grants.update", {
            grantId: g2.grant.grantId ?? g2.grant.id,
            level: k % 2 ? "view" : "edit",
          });
          updates.push(Math.round(performance.now() - t0));
        }
        await cap(d, "access.unshare", { grantId: g2.grant.grantId ?? g2.grant.id });
        // the first list after a sync of 500 records
        const readsAfterSync: number[] = [];
        for (let k = 0; k < 5; k++) {
          await cap(d, "records.bulk_upsert", {
            type: "rt_big",
            match: ["name"],
            rows: Array.from({ length: 500 }, (_, i) => ({ name: `G ${r} ${k} ${i}` })),
            createOnly: true,
            runAutomations: false,
          });
          readsAfterSync.push(await timed(d, "access.lists", lists));
        }
        const m = {
          share: median(shares),
          unshare: median(unshares),
          update: median(updates),
          sync: median(readsAfterSync),
          afterShare: median(readsAfterShare),
          afterUnshare: median(readsAfterUnshare),
        };
        process.stderr.write(
          `[share-call] round ${r + 1}, load ${os.loadavg()[0]!.toFixed(1)} on ${os.cpus().length} cpus: share ${m.share} ms, unshare ${m.unshare} ms, grant update ${m.update} ms, first list after a sync of 500 records ${m.sync} ms, first list after a share ${m.afterShare} ms, after an unshare ${m.afterUnshare} ms\n`,
        );
        return m;
      };
      const budgets = {
        share: CALL_BUDGET_MS,
        unshare: CALL_BUDGET_MS,
        update: CALL_BUDGET_MS,
        sync: READ_BUDGET_MS,
        afterShare: READ_BUDGET_MS,
        afterUnshare: READ_BUDGET_MS,
      };
      const words = {
        share: "a share",
        unshare: "an unshare",
        update: "a change of a share",
        sync: "the first list after a sync of 500 records",
        afterShare: "the first list after a share",
        afterUnshare: "the first list after an unshare",
      };
      const best = {
        share: Infinity,
        unshare: Infinity,
        update: Infinity,
        sync: Infinity,
        afterShare: Infinity,
        afterUnshare: Infinity,
      };
      for (let r = 0; r < 3; r++) {
        const m = await round(r);
        for (const k of Object.keys(best) as Array<keyof typeof best>) best[k] = Math.min(best[k], m[k]);
        if ((Object.keys(best) as Array<keyof typeof best>).every((k) => best[k] <= budgets[k])) break;
      }
      for (const k of Object.keys(best) as Array<keyof typeof best>)
        assert.ok(
          best[k] <= budgets[k],
          `${words[k]} took ${best[k]} ms in its best of 3 rounds (budget ${budgets[k]} ms)`,
        );
    } finally {
      await d.stop();
    }
  },
);
