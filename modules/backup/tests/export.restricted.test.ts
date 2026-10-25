// P-SEC_07: a full export is complete or it does not happen (a silently partial export is its own harm), so it is never filtered per item. It is the Space owner's alone: an admin who is not the owner,
// a member, a caller whose authorize says no or hold, and a context with no authorize at all are refused with permission.no_grant, and nothing is packed or saved.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { world } from "../fixtures/world.ts";
import { configureBackup, handlers } from "../handlers/index.ts";
import type { BackupCtx } from "../handlers/run.ts";

type Fn = (ctx: BackupCtx, input: never) => Promise<unknown>;
const exportStart = (ctx: BackupCtx): Promise<unknown> => (handlers as unknown as Record<string, Fn>)["backup.export_start"]!(ctx, {} as never);
const refusal = async (ctx: BackupCtx): Promise<string> => {
  try { await exportStart(ctx); } catch (e) { assert.ok(e instanceof VyreErr); return e.error.code; }
  return "none";
};

afterEach(() => configureBackup(null));

test("backup.export_start: the owner is allowed and the zip is complete", async () => {
  const w = world();
  configureBackup(w.drivers);
  await w.space.append("contact/ada", "Ada Lovelace");
  w.space.blobs.set("fil_1", "the engagement letter");
  const out = await exportStart(w.ctx) as { runId: string };
  assert.equal(out.runId, "run_testrun1");
  const text = new TextDecoder().decode(w.saved[0]!.bytes);
  assert.ok(text.includes("Ada Lovelace") && text.includes("the engagement letter"), "nothing the owner holds was filtered out");
});

test("backup.export_start: an admin who is not the owner, and a member, are refused and nothing is saved", async () => {
  for (const who of ["usr_admin", "usr_member"]) {
    const w = world({ principal: who });
    configureBackup(w.drivers);
    assert.equal(await refusal(w.ctx), "permission.no_grant", who);
    assert.deepEqual(w.saved, [], who);
  }
});

test("backup.export_start: a deny or a hold from authorize, and a context with no authorize, are refused (fail closed)", async () => {
  for (const effect of ["deny", "hold"] as const) {
    const w = world();
    configureBackup(w.drivers);
    w.ctx.authorize = (() => ({ effect, reason: "test", decisionId: "dec_x" })) as unknown as BackupCtx["authorize"];
    assert.equal(await refusal(w.ctx), "permission.no_grant", effect);
    assert.deepEqual(w.saved, []);
  }
  const w = world();
  configureBackup(w.drivers);
  (w.ctx as { authorize?: unknown }).authorize = undefined;
  assert.equal(await refusal(w.ctx), "permission.no_grant");
  assert.deepEqual(w.saved, []);
});
