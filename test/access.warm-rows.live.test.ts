// There is no warm-up job for the rows people are served (my_access): the first list builds them. A warm-up that ran ten seconds after a start (1202c1660, 24 Nov) published a read view before the people who joined
// after it existed, and a sign-up and an invite join failed under load at their next step (auth.entry.live, step-accept). The job is not registered, and the first list is the first build.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./support/eco-live.ts";
import { shareKept } from "../modules/access/handlers/share.ts";
import { periodic } from "../modules/access/impl.ts";

test("the access module registers no warm-up job", async () => {
  assert.equal(Object.keys(periodic).includes("access.warm_rows"), false);
  assert.deepEqual(Object.keys(periodic), ["access.exceptions_lapse"]);
  const d = await boot(seededDir(), (async function* () {})() as never);
  try {
    await assert.rejects(d.hooks!.runPeriodic("access.warm_rows"), /no periodic job named access\.warm_rows/);
  } finally {
    await d.stop();
  }
});

test("the first list is the first build", async () => {
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
