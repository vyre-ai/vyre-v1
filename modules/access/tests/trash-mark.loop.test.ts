// A folder of 10,000 items put in Trash, brought back, and deleted for good, in a Space of 40,000 resources, holds the server's loop for under 100 ms each time (the longest block is the access.sync call that folds the event:
// it is one synchronous call). A bulk purge of 1,000 folders in one batch is held to the same bound. Before: every event walked the whole store for the folder's descendants and, on a restore, for the marked rows.
// CI size is the same as the perf size: the seed is registered through access.sync, not through the API.
import test from "node:test";
import assert from "node:assert/strict";
import type { LogEvent } from "../consumers.ts";
import { SPACE, ctxOf, fresh, sync } from "../fixtures/incremental.ts";
import { loadStore, isTrashed } from "../projections.ts";
import { hostCalls } from "../consumers.ts";

const pending = hostCalls["access.trash_pending"] as unknown as (ctx: unknown) => number;

const TOTAL = Number(process.env["TRASH_LOOP_TOTAL"] ?? 40_000);
const BIG = Number(process.env["TRASH_LOOP_BIG"] ?? 10_000);
const BOUND_MS = 100;
let seq = 0;
const reg = (id: string, type: string, parent: string): LogEvent => ({
  seq: ++seq,
  type: "resource.created",
  payload: { id, type, parent_id: parent, label: 0, owner_id: "usr_ana", holds: 0 },
});
const ev = (type: string, payload: Record<string, unknown>): LogEvent => ({ seq: ++seq, type, payload });

test(
  `a folder of ${BIG} items in a Space of ${TOTAL} resources: Trash, restore and purge each hold the loop under ${BOUND_MS} ms`,
  { timeout: 120_000 },
  () => {
    const { db } = fresh("trash-loop");
    const ctx = () => ctxOf(db);
    const seed: LogEvent[] = [
      {
        seq: ++seq,
        type: "resource.created",
        payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_ana", holds: 0 },
      },
      reg("fld_big", "folder", SPACE),
    ];
    // the big folder: sub-folders of 100 files each
    const subs = Math.ceil(BIG / 101);
    let inBig = 0;
    for (let s = 0; s < subs && inBig < BIG; s++) {
      seed.push(reg(`fld_big_${s}`, "folder", "fld_big"));
      inBig++;
      for (let f = 0; f < 100 && inBig < BIG; f++, inBig++) seed.push(reg(`fil_big_${s}_${f}`, "file", `fld_big_${s}`));
    }
    // 1,000 small folders to purge in one batch, then records for the rest of the Space
    for (let i = 0; i < 1000; i++) seed.push(reg(`fld_s${i}`, "folder", SPACE), reg(`fil_s${i}`, "file", `fld_s${i}`));
    for (let i = 0; seed.length < TOTAL; i++) seed.push(reg(`rec_${i}`, "record", SPACE));
    for (let at = 0; at < seed.length; at += 2000) sync(ctx(), { events: seed.slice(at, at + 2000) });

    // the host folds an event, then calls again with no events until nothing is pending; the longest block is the longest of those calls
    const run = (label: string, events: LogEvent[]): number => {
      let worst = 0,
        calls = 0,
        total = 0;
      for (let batch = events; calls === 0 || pending(ctx()) > 0; batch = [], calls++) {
        const t0 = performance.now();
        sync(ctx(), { events: batch.slice(0, 40) });
        for (let more = batch.slice(40); more.length; more = more.slice(40)) {
          // the host's own slice of 40 events a call
          const t1 = performance.now();
          sync(ctx(), { events: more.slice(0, 40) });
          worst = Math.max(worst, performance.now() - t1);
        }
        const ms = performance.now() - t0;
        total += ms;
        if (batch.length <= 40) worst = Math.max(worst, ms);
      }
      console.log(
        `MEASURE ${label}: longest block ${worst.toFixed(0)} ms in ${calls} calls, ${total.toFixed(0)} ms in all`,
      );
      return worst;
    };
    const worst = [
      run("Trash the big folder", [ev("folder.deleted", { folderId: "fld_big" })]),
      run("bring it back", [ev("folder.restored", { folderId: "fld_big" })]),
      run("Trash it again", [ev("folder.deleted", { folderId: "fld_big" })]),
      run("purge it", [ev("folder.purged", { folderId: "fld_big" })]),
      run(
        "Trash 1,000 folders in one batch",
        Array.from({ length: 1000 }, (_, i) => ev("folder.deleted", { folderId: `fld_s${i}` })),
      ),
      run(
        "purge 1,000 folders in one batch",
        Array.from({ length: 1000 }, (_, i) => ev("folder.purged", { folderId: `fld_s${i}` })),
      ),
    ];
    const stored = loadStore(db as never);
    assert.equal(pending(ctx()), 0);
    assert.equal(isTrashed(stored.resources.get("fil_big_0_0")), true, "the files of the purged folder carry the mark");
    assert.equal(
      isTrashed(stored.resources.get(`fil_big_${Math.floor(BIG / 101) - 1}_5`)),
      true,
      "and so does the last of them",
    );
    assert.equal(isTrashed(stored.resources.get("rec_0")), false, "a record does not");
    for (const ms of worst)
      assert.ok(ms < BOUND_MS, `the longest block was ${ms.toFixed(0)} ms, the bound is ${BOUND_MS} ms`);
  },
);
