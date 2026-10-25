// P-SEC_07: the owner export packs many items into one zip, and the read filter cannot reach a file's contents. Every entry that names an item needs an explicit view allow from ctx.authorize;
// a deny or a hold leaves it out, and a context with no authorize refuses the whole export.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { world } from "../fixtures/world.ts";
import { configureBackup, handlers } from "../handlers/index.ts";
import type { BackupCtx } from "../handlers/run.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
type Fn = (ctx: BackupCtx, input: never) => Promise<unknown>;
const exportStart = (ctx: BackupCtx): Promise<unknown> => (handlers as unknown as Record<string, Fn>)["backup.export_start"]!(ctx, {} as never);

afterEach(() => configureBackup(null));

test("backup.export_start: an entry whose item the caller cannot view is absent from the zip, and is counted as left out", async () => {
  const w = world();
  configureBackup(w.drivers);
  w.space.extraExport.push(
    { path: "files/visible.txt", bytes: enc.encode("visible plan"), resource: { type: "file", id: "fil_open" } },
    { path: "files/restricted.txt", bytes: enc.encode("restricted merger terms"), resource: { type: "file", id: "fil_secret" } },
    { path: "files/held.txt", bytes: enc.encode("held until approved"), resource: { type: "file", id: "fil_held" } },
  );
  const full = w.ctx.authorize;
  w.ctx.authorize = ((a: { perm: string | null; level: string }, r: { type: string; id: string | null }) => {
    if (r.id === "fil_secret") return { effect: "deny", reason: "restricted", decisionId: "dec_s" };
    if (r.id === "fil_held") return { effect: "hold", reason: "approval", decisionId: "dec_h" };
    return (full as (a: unknown, r: unknown) => unknown)(a, r);
  }) as unknown as BackupCtx["authorize"];
  w.allowExport(true);
  await exportStart(w.ctx);
  const text = dec.decode(w.saved[0]!.bytes);
  assert.ok(text.includes("visible plan"), "the item the caller may view is in the zip");
  assert.ok(!text.includes("restricted merger terms") && !text.includes("restricted.txt"), "the restricted item is absent");
  assert.ok(!text.includes("held until approved") && !text.includes("held.txt"), "a hold is a deny");
  assert.equal(w.raw.rows("backup_export")[0]!["skipped"], 2);
});

test("backup.export_start: a context with no authorize refuses and packs nothing (fail closed)", async () => {
  const w = world();
  configureBackup(w.drivers);
  (w.ctx as { authorize?: unknown }).authorize = undefined;
  try { await exportStart(w.ctx); assert.fail("expected a refusal"); } catch (e) { assert.ok(e instanceof VyreErr); assert.equal(e.error.code, "permission.role_lacks_permission"); }
  assert.deepEqual(w.saved, []);
});
