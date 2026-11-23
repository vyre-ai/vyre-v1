// The rows people are served (my_access) are built once at the first idle moment after a start: the first list of Files does not pay the first build (about a second of CPU on a firm's Space).
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./support/eco-live.ts";
import { shareKept } from "../modules/access/handlers/share.ts";

test("after the warm-up job the rows are fresh: the first list builds nothing", async () => {
  const d = await boot(seededDir(), (async function* () {})() as never);
  try {
    const built0 = shareKept.built;
    await d.hooks!.runPeriodic("access.warm_rows");
    assert.equal(shareKept.built, built0 + 1, "the warm-up did the first build");
    const built1 = shareKept.built;
    const first = await call(d, "access.lists", { type: "folder" });
    assert.equal(first.status, 200, JSON.stringify(first.data).slice(0, 300));
    assert.equal(shareKept.built, built1, "the first list built nothing");
    await d.hooks!.runPeriodic("access.warm_rows");
    assert.equal(shareKept.built, built1, "a second warm-up does nothing");
  } finally {
    await d.stop();
  }
});

test("without the warm-up the first list is the first build", async () => {
  const d = await boot(seededDir(), (async function* () {})() as never);
  try {
    const built0 = shareKept.built;
    const first = await call(d, "access.lists", { type: "folder" });
    assert.equal(first.status, 200, JSON.stringify(first.data).slice(0, 300));
    assert.equal(shareKept.built, built0 + 1, "the first list built the rows");
  } finally {
    await d.stop();
  }
});
