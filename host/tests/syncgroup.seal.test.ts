// A pull that makes its records a group at a time (one commit for up to 200 records) seals the sealed fields exactly as the one-at-a-time path does: the same values reach the Vault, the records hold the same
// references, a value the Vault could not take yet is counted as waiting and filled by the next pass, and none of it is in the sync's own tables. Host never imports a module (layer rule), so the sources engine is taken
// through the loader, the way the daemon takes it.
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
import type { Store } from "../../kernel/src/store/types.ts";

const ROWS = 450;

async function pull(grouped: boolean, vaultOpensAfterFirstPass: boolean) {
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncgroup-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: `sp_group_${grouped ? "g" : "o"}` });
  const opened = space.open();
  const { tx } = opened;
  let groups = 0;
  const store: Store = grouped
    ? ({
        ...opened.store,
        createMany: (...a: Parameters<NonNullable<Store["createMany"]>>) => {
          groups++;
          return opened.store.createMany!(...a);
        },
      } as Store)
    : ({ ...opened.store, createMany: undefined } as unknown as Store);
  await store.define({
    add_types: [
      {
        name: "contact",
        label: "Contact",
        fields: [
          { name: "name", kind: "text", label: "Name" },
          { name: "ssn", kind: "sealed", label: "SSN" },
          { name: "dob", kind: "sealed", label: "Born" },
        ],
      },
    ],
  });
  let vaultOpen = !vaultOpensAfterFirstPass;
  const vault = new Map<string, string>(); // record name, field -> plaintext
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get") return { connector: { key: "fakeapp" } };
      if (cap === "records.update") {
        if (!vaultOpen) throw { error: { code: "internal.unavailable", message: "The Vault is not unlocked." } };
        const i = input as { type: string; recordId: string; patch: Record<string, any> };
        const cur = (await store.get(i.type, i.recordId))!;
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(i.patch)) {
          if (v && v.sealed === true) {
            vault.set(`${String(cur.data["name"])} ${k}`, String(v.value));
            patch[k] = { sealed: k, ref: `ref ${String(cur.data["name"])} ${k}`, present: true, set_at: 1 };
          } else patch[k] = v;
        }
        await opened.store.update(i.type, i.recordId, patch as never, cur.version);
        return { record: { id: i.recordId } };
      }
      return {
        output: {
          results: Array.from({ length: ROWS }, (_, n) => ({
            id: `h${n}`,
            updatedAt: 1000,
            properties: {
              full_name: `Person ${n}`,
              tax: n % 5 === 0 ? "" : `ssn-${n}`, // some have none
              born: `19${String(n % 100).padStart(2, "0")}-01-01`,
            },
          })),
        },
      };
    },
  };
  const row: BindingRow = {
    syncTypeId: "syt_1",
    type: "contact",
    connector: "fakeapp",
    connectionId: "con_1",
    remote: "contacts",
    fields: [
      { key: "name", remote: "full_name", dir: "pull" },
      { key: "ssn", remote: "tax", dir: "pull", sealed: true },
      { key: "dob", remote: "born", dir: "pull", sealed: true },
    ],
    match: [],
    createAtSource: false,
    deletes: "off",
    conflict: "newest",
  };
  const engine = createSyncEngine({ core, local: { open: () => ({ store, tx }) } });
  const dump = (): string =>
    tx
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((t) => JSON.stringify(tx.all(`SELECT * FROM "${t.name}"`)))
      .join("\n");
  const state = async () => {
    const rows = (await store.query("contact", { page: { limit: 1000 } })).rows;
    return {
      records: rows
        .map((r) => JSON.stringify({ name: r.data["name"], ssn: r.data["ssn"] ?? null, dob: r.data["dob"] ?? null }))
        .sort(),
      vault: [...vault].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`),
      waiting: tx.get<{ n: number }>("SELECT n FROM sy_sealed_wait WHERE sync_type = 'syt_1'")?.n ?? 0,
      notes: tx
        .all<{ kind: string; summary: string }>("SELECT kind, summary FROM sy_log ORDER BY at, rowid")
        .map((l) => `${l.kind} ${l.summary}`.replace(/rec_[0-9a-z-]+/g, "rec")),
      leaked: /ssn-\d+/.test(dump()) || /19\d\d-01-01/.test(dump()),
    };
  };
  await engine.run(ctx, row, { mode: "incremental" });
  const first = await state();
  let second = first;
  if (vaultOpensAfterFirstPass) {
    vaultOpen = true;
    await engine.run(ctx, row, { mode: "incremental" });
    second = await state();
  }
  return { first, second, groups };
}

test("a grouped pull seals what the one-at-a-time pull seals: the same values, references, waiting count and notes", async () => {
  const one = await pull(false, false);
  const many = await pull(true, false);
  assert.ok(many.groups >= 2 && one.groups === 0, "the grouped pull made its records in groups");
  assert.deepEqual(many.first, one.first);
  assert.equal(many.first.leaked, false, "no sealed value is in the Space database's tables");
  assert.ok(many.first.vault.length > 0, "values reached the Vault");
});

test("a grouped pull whose Vault could not take the values yet leaves the records without them, counts them as waiting, and the next pass fills them as the one-at-a-time pull does", async () => {
  const one = await pull(false, true);
  const many = await pull(true, true);
  assert.deepEqual(many.first, one.first, "after the first pass: same records, same waiting count, same notes");
  assert.ok(many.first.waiting > 0, "values are counted as waiting");
  assert.equal(many.first.vault.length, 0, "the Vault holds nothing yet");
  assert.deepEqual(many.second, one.second, "after the next pass: the same sealed state");
  assert.ok(many.second.vault.length > 0 && many.second.waiting === 0, "the next pass fills them");
  assert.equal(many.second.leaked, false);
});
