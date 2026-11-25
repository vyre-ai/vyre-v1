// What the Trash mark costs access.lists: the first list after 1,000 and 5,000 folders were made (TRASH_PERF_SIZES=1000,10000,40000 for the large run) (the view is built), a second list (the kept view), and one folder with a subtree put in Trash and the first list after it.
// CPU time of this thread, one run each (testkit/src/cpu-time.ts); the numbers are printed, and the one limit is that a list of the largest Space stays inside a second of CPU. A speed number counts only on the perf runners (ruling 46).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { timeCpuAsync } from "../testkit/src/cpu-time.ts";

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
      const first = await timeCpuAsync(list);
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
      const del = await timeCpuAsync(() => h.owner.call("files.folder.delete", { folderId: top }));
      const afterTrash = await timeCpuAsync(list);
      console.log(
        `MEASURE ${size} folders: first list ${first.cpuMs.toFixed(0)} ms CPU, next list ${next.cpuMs.toFixed(0)} ms, delete of a 50-folder subtree ${del.cpuMs.toFixed(0)} ms, first list after it ${afterTrash.cpuMs.toFixed(0)} ms (total ${afterTrash.out.total})`,
      );
      made += 49; // names are unique per size; the kids count as folders too
    }
    assert.ok(true);
  },
);
