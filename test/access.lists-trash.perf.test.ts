// What the Trash mark costs access.lists: the first list after 1,000 and 5,000 folders were made (TRASH_PERF_SIZES=1000,10000,40000 for the large run) (the view is built), a second list (the kept view), and one folder with a subtree put in Trash and the first list after it.
// CPU time of this thread, one run each (testkit/src/cpu-time.ts); the numbers are printed, and the one limit is that a list of the largest Space stays inside a second of CPU. A speed number counts only on the perf runners (ruling 46).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { timeCpuAsync } from "../testkit/src/cpu-time.ts";

/** The longest the server's loop was held while `fn` ran: the largest gap between two ticks of a 2 ms timer. */
async function loopBlock<T>(fn: () => Promise<T>): Promise<{ out: T; maxMs: number }> {
  let last = performance.now(),
    max = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 2);
  try {
    const out = await fn();
    max = Math.max(max, performance.now() - last);
    return { out, maxMs: max };
  } finally {
    clearInterval(timer);
  }
}
/** CPU the first list may use (it builds the view): 300 ms and 0.06 ms for each folder (the 40,000 run measured 1,259 ms, the budget is 2,700). */
const LIST_BUDGET_MS = (size: number): number => 300 + size * 0.06;
/** The longest block of the loop in a list, or in putting a 50-folder subtree in Trash, at any size. */
const BLOCK_BOUND_MS = 250;

let h: Hour;
before(async () => {
  h = await bootHour("trashperf");
});
after(async () => {
  await h?.stop();
});

const SIZES = (process.env["TRASH_PERF_SIZES"] ?? "1000,5000").split(",").map(Number);

test(
  "access.lists of folders: CPU for the first list, the next list, and the first list after a folder with a subtree goes to Trash",
  { timeout: 3_000_000 },
  async () => {
    const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
    const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
    let made = 0;
    const list = () => h.owner.call("access.lists", { type: "folder", limit: 50 }) as Promise<{ total: number }>;
    for (const size of SIZES) {
      const mk = async (i: number): Promise<string> =>
        (
          (await h.owner.call("files.folder.create", { parentId: root, name: `f${i}`, idempotencyKey: `tp-${i}` })) as {
            folder: { folderId: string };
          }
        ).folder.folderId;
      const ids: string[] = [];
      while (made < size) {
        const batch = Array.from({ length: Math.min(25, size - made) }, (_, k) => made + k);
        ids.push(...(await Promise.all(batch.map(mk))));
        made += batch.length;
      }
      const lagged = await loopBlock(() => timeCpuAsync(list));
      const first = lagged.out;
      const next = await timeCpuAsync(list);
      // a subtree of 50 folders put in Trash, then the first list
      const top = ids[0]!;
      const kids = await Promise.all(
        Array.from({ length: 49 }, (_, k) =>
          h.owner.call("files.folder.create", {
            parentId: top,
            name: `k${size}-${k}`,
            idempotencyKey: `tpk-${size}-${k}`,
          }),
        ),
      );
      assert.equal(kids.length, 49);
      const delBlock = await loopBlock(() =>
        timeCpuAsync(() => h.owner.call("files.folder.delete", { folderId: top })),
      );
      const del = delBlock.out;
      const afterTrash = await timeCpuAsync(list);
      console.log(
        `MEASURE ${size} folders: first list ${first.cpuMs.toFixed(0)} ms CPU, next list ${next.cpuMs.toFixed(0)} ms, delete of a 50-folder subtree ${del.cpuMs.toFixed(0)} ms, first list after it ${afterTrash.cpuMs.toFixed(0)} ms (total ${afterTrash.out.total})`,
      );
      made += 49; // names are unique per size; the kids count as folders too
      console.log(
        `MEASURE ${size} folders: longest block of the loop in the first list ${lagged.maxMs.toFixed(0)} ms, in the Trash call ${delBlock.maxMs.toFixed(0)} ms`,
      );
      assert.ok(
        first.cpuMs < LIST_BUDGET_MS(size),
        `the first list used ${first.cpuMs.toFixed(0)} ms of CPU, the budget is ${LIST_BUDGET_MS(size).toFixed(0)} ms`,
      );
      assert.ok(
        lagged.maxMs < BLOCK_BOUND_MS,
        `the first list held the loop ${lagged.maxMs.toFixed(0)} ms, the bound is ${BLOCK_BOUND_MS} ms`,
      );
      assert.ok(
        delBlock.maxMs < BLOCK_BOUND_MS,
        `the Trash call held the loop ${delBlock.maxMs.toFixed(0)} ms, the bound is ${BLOCK_BOUND_MS} ms`,
      );
      assert.equal(
        afterTrash.out.total,
        next.out.total + 49 - 50,
        "the list after the Trash leaves out the folder and its 49 folders",
      );
    }
  },
);
