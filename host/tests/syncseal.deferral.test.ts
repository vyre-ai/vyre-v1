// A sealed value the Vault cannot take yet (a locked Vault, a record the Vault cannot see yet) is a deferral, not a failure: the Sync page of a healthy first pull shows no failure line. The value is
// tried again with the next group or pass, and only a value that is refused AGAIN, with no group left to read, is a failure (24 Nov 2026: a healthy pull listed "A sealed value could not be kept yet").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODE_ROOT } from "../src/daemon/daemon.ts";
import { fileExportsImporter } from "../src/loader.ts";
import { coreOf, createSyncEngine } from "../src/daemon/syncengine.ts";
import type { BindingRow, EngineCtx } from "../src/daemon/syncengine.ts";
import { createSpaceStore } from "../src/daemon/store.ts";

const N = 5;

async function world(): Promise<{
  run: () => Promise<unknown>;
  errors: () => string[];
  open: (v: boolean) => void;
  kept: () => number;
}> {
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncseal-defer-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_sealdefer" });
  const { store, tx } = space.open();
  await store.define({
    add_types: [
      {
        name: "contact",
        label: "Contact",
        fields: [
          { name: "name", kind: "text", label: "Name" },
          { name: "ssn", kind: "sealed", label: "SSN" },
        ],
      },
    ],
  });
  let vaultOpen = false;
  let kept = 0;
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get") return { connector: { key: "fakeapp" } };
      if (cap === "records.update") {
        if (!vaultOpen) throw new Error("There is no record by that name that you can see.");
        const i = input as { type: string; recordId: string };
        const cur = (await store.get(i.type, i.recordId))!;
        await store.update(
          i.type,
          i.recordId,
          { ssn: { sealed: "ssn", ref: `ref_${i.recordId}`, present: true, set_at: Date.now() } },
          cur.version,
        );
        kept++;
        return { record: { id: i.recordId } };
      }
      return {
        output: {
          results: Array.from({ length: N }, (_, n) => ({
            id: `h${n}`,
            updatedAt: 1000,
            properties: { full_name: `Person ${n}`, tax: `123-45-${String(1000 + n)}` },
          })),
        },
      };
    },
  };
  const row: BindingRow = {
    syncTypeId: "syt_defer",
    type: "contact",
    connector: "fakeapp",
    connectionId: "con_1",
    remote: "contacts",
    fields: [
      { key: "name", remote: "full_name", dir: "pull" },
      { key: "ssn", remote: "tax", dir: "pull", sealed: true },
    ],
    match: [],
    createAtSource: false,
    deletes: "off",
    conflict: "newest",
  };
  const engine = createSyncEngine({ core, local: { open: () => ({ store, tx }) } });
  return {
    run: () => engine.run(ctx, row, { mode: "incremental" }),
    errors: () =>
      tx
        .all<{ summary: string }>("SELECT summary FROM sy_log WHERE sync_type = ? AND kind = 'error'", "syt_defer")
        .map((r) => r.summary),
    open: (v) => {
      vaultOpen = v;
    },
    kept: () => kept,
  };
}

test("a sealed value the Vault cannot take yet is a deferral: the first pull shows no failure, and the next pass keeps every value", async () => {
  const w = await world();
  await w.run();
  assert.equal(w.kept(), 0, "the Vault refused every value");
  assert.deepEqual(w.errors(), [], "a first refusal is a deferral, not a failure line on the Sync page");
  w.open(true);
  await w.run();
  assert.equal(w.kept(), N, "every deferred value is kept by the next pass");
  assert.deepEqual(w.errors(), [], "and nothing was ever listed as a failure");
});

test("a sealed value the Vault refuses again, with no group left to read, is a failure that says why", async () => {
  const w = await world();
  await w.run();
  assert.deepEqual(w.errors(), [], "the first refusal is a deferral");
  await w.run();
  const errors = w.errors();
  assert.equal(errors.length, 1, "one line per pass, however many values were refused");
  assert.match(errors[0]!, /^A sealed value could not be kept yet: There is no record by that name that you can see\./);
});
