// A sealed field of a synced type: the value is taken out of the app's row the moment it is read and goes to the Vault through records.update only. It is in none of the sync's own tables
// (base, conflicts, outbox, log), an app update replaces it, an empty value clears it, and a record the app has not changed since the last seal is not sealed again.
// Host never imports a module (layer rule), so the sources engine is taken through the loader, the way the daemon takes it.
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

const SSN = "123-45-6789";
const SSN2 = "987-65-4321";

test("syncengine: a sealed field is sealed at once, kept out of the sync's own tables, replaced by an update and cleared by an empty value", async () => {
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncseal-"));
  const dbPath = path.join(dir, "space.db");
  const space = createSpaceStore({ path: dbPath, space: "sp_seal" });
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
  const vault = new Map<string, string>();
  const app = new Map<string, { name: string; ssn: unknown; at: number }>([
    ["h1", { name: "Imran Ibarra", ssn: SSN, at: 1000 }],
    ["h2", { name: "Andrea Lindahl", ssn: "", at: 1000 }],
  ]);
  const updates: Record<string, unknown>[] = [];
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get") return { connector: { key: "fakeapp" } };
      if (cap === "records.update") {
        // what the records module does: plaintext goes to the Vault, the row keeps the reference
        const i = input as { type: string; recordId: string; patch: Record<string, unknown> };
        updates.push(i.patch);
        const cur = (await store.get(i.type, i.recordId))!;
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(i.patch)) {
          if (v && typeof v === "object" && (v as { sealed?: unknown }).sealed === true) {
            const have = cur.data[k] as { ref?: string } | undefined;
            const ref = have?.ref ?? `ref_${vault.size + 1}`;
            vault.set(ref, (v as { value: string }).value);
            patch[k] = { sealed: k, ref, present: true, set_at: Date.now() };
          } else patch[k] = v;
        }
        await store.update(i.type, i.recordId, patch, cur.version);
        return { record: { id: i.recordId } };
      }
      assert.ok(cap === "connectors.read" || cap === "connectors.run", cap);
      const i = input as { action: string };
      assert.equal(i.action, "list_contacts");
      return {
        output: {
          results: [...app].map(([id, r]) => ({
            id,
            updatedAt: r.at,
            properties: { full_name: r.name, tax: r.ssn },
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
    ],
    match: [],
    createAtSource: false,
    deletes: "off",
    conflict: "newest",
  };
  const engine = createSyncEngine({ core, local: { open: () => ({ store, tx }) } });
  const contacts = async () => (await store.query("contact", { page: { limit: 50 } })).rows;
  const byName = async (name: string) => (await contacts()).find((r) => r.data["name"] === name)!;
  /** Every cell of every table of the Space database as text: the value must be in none of them. */
  const everywhere = (): string => {
    const tables = tx
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((t) => t.name);
    return tables.map((t) => JSON.stringify(tx.all(`SELECT * FROM "${t}"`))).join("\n");
  };

  await engine.run(ctx, row, { mode: "incremental" });
  assert.equal((await contacts()).length, 2);
  const imran = await byName("Imran Ibarra");
  assert.equal((imran.data["ssn"] as { present?: boolean }).present, true, "the record holds a reference");
  assert.deepEqual([...vault.values()], [SSN], "the value is in the Vault");
  assert.equal(updates.length, 1, "an empty value on a record that has none writes nothing");
  assert.ok(!everywhere().includes(SSN), "the value is in none of the Space database's tables");
  assert.ok(!everywhere().includes("123-45"), "nor a part of it");

  // no change at the app since the last seal: nothing is sealed again
  await engine.run(ctx, row, { mode: "incremental" });
  assert.equal(updates.length, 1);

  // the app changes it: the sealed value is replaced under the same reference
  app.set("h1", { name: "Imran Ibarra", ssn: SSN2, at: Date.now() + 60_000 });
  await engine.run(ctx, row, { mode: "incremental" });
  assert.deepEqual([...vault.values()], [SSN2]);
  assert.ok(!everywhere().includes(SSN2));
  assert.ok(!JSON.stringify(await contacts()).includes(SSN2));

  // the app empties it: the field is cleared
  app.set("h1", { name: "Imran Ibarra", ssn: null, at: Date.now() + 120_000 });
  await engine.run(ctx, row, { mode: "incremental" });
  assert.equal((await byName("Imran Ibarra")).data["ssn"] ?? null, null);
  assert.ok(!everywhere().includes(SSN2));
});

test("syncengine: a title made of several parts of the row is joined at read, empty parts left out", async () => {
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap: string) =>
      cap === "connectors.get"
        ? { connector: { key: "fakeapp" } }
        : {
            output: {
              results: [
                { id: "1", properties: { "/first": "Imran", "/last": "Ibarra" } },
                { id: "2", properties: { "/first": "", "/last": "Lindahl" } },
                { id: "3", properties: { "/first": null, "/last": " " } },
              ],
            },
          },
  };
  const { remoteStore } = await import("../src/daemon/syncengine.ts");
  const store = remoteStore(ctx, { connector: "fakeapp", connectionId: "con_1", remote: "contacts" }, undefined, {
    joins: ["=join:/first|/last"],
  });
  const page = await store.page();
  assert.deepEqual(
    page.rows.map((r) => r.data["=join:/first|/last"]),
    ["Imran Ibarra", "Lindahl", null],
  );
});

test("syncengine: a Vault that cannot take the value yet leaves the record without the field, keeps the value nowhere, and the next pass fills it", async () => {
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncseal2-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_seal2" });
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
  const vault = new Map<string, string>();
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
            vault.set(`r${vault.size}`, v.value);
            patch[k] = { sealed: k, ref: `r${vault.size - 1}`, present: true, set_at: Date.now() };
          } else patch[k] = v;
        }
        await store.update(i.type, i.recordId, patch, cur.version);
        return {};
      }
      return { output: { results: [{ id: "1", updatedAt: 5, properties: { full_name: "Imran Ibarra", tax: SSN } }] } };
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
  await engine.run(ctx, row, { mode: "incremental" }); // does not throw: the pass finishes
  const rec = (await store.query("contact", { page: { limit: 5 } })).rows[0]!;
  assert.equal(rec.data["name"], "Imran Ibarra", "the record is written");
  assert.equal(rec.data["ssn"] ?? null, null, "without the field");
  assert.ok(!dump().includes(SSN), "and the value is kept nowhere");
  assert.equal(
    tx.get<{ n: number }>("SELECT n FROM sy_sealed_wait WHERE sync_type = 'syt_1'")?.n,
    1,
    "one is counted as waiting",
  );
  vaultOpen = true;
  await engine.run(ctx, row, { mode: "incremental" });
  const again = (await store.query("contact", { page: { limit: 5 } })).rows[0]!;
  assert.equal((again.data["ssn"] as { present?: boolean }).present, true, "the next pass fills it");
  assert.deepEqual([...vault.values()], [SSN]);
  assert.equal(tx.get("SELECT n FROM sy_sealed_wait WHERE sync_type = 'syt_1'"), undefined);
  assert.ok(!dump().includes(SSN));
});

test("syncengine: the engine takes a sealed value from the connector's own keeping, not from the answer, which carries the mask", async () => {
  const { remoteStore } = await import("../src/daemon/syncengine.ts");
  const asked: unknown[] = [];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap: string, input: unknown) => {
      if (cap === "connectors.get") return { connector: { key: "x" } };
      asked.push(input);
      return { output: { results: [{ id: "1", properties: { "/name": "Imran Ibarra", "/ssn": "[sealed]" } }] } };
    },
  };
  const store = remoteStore(ctx, { connector: "x", connectionId: "c", remote: "things" }, undefined, {
    nonce: "n9",
    sealed: [{ remote: "/ssn", local: "ssn" }],
    unmaskToken: "tok",
    heldOf: (n, id) => (n === "n9" && id === "1" ? { "/ssn": SSN } : undefined),
  });
  const page = await store.page();
  assert.ok(!JSON.stringify(page.rows).includes(SSN), "the row the sync keeps never holds it");
  assert.equal(store.held.get("1")?.values["ssn"], SSN, "it is held for sealing");
  assert.equal((asked[0] as { input: { __unmask: string } }).input.__unmask, "tok:n9");
});

test("syncengine: sealing the values that waited for the Vault gives the event loop a turn, never holding it past 100 ms, and every value is kept", async () => {
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncseal-wait-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_sealwait" });
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
  const N = 600;
  let vaultOpen = false;
  let kept = 0;
  const busy = (ms: number): void => {
    const end = performance.now() + ms;
    while (performance.now() < end);
  };
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get") return { connector: { key: "fakeapp" } };
      if (cap === "records.update") {
        // the Vault is locked for the first pass; then each value costs a little synchronous work (a key derivation, a write)
        if (!vaultOpen) throw new Error("The Vault is locked.");
        busy(1);
        const i = input as { type: string; recordId: string; patch: Record<string, unknown> };
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
    syncTypeId: "syt_wait",
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
  await engine.run(ctx, row, { mode: "incremental" });
  assert.equal(kept, 0, "the Vault was locked: nothing kept, every value waits in memory");
  vaultOpen = true;
  let last = performance.now(),
    worst = 0;
  const timer = setInterval(() => {
    const at = performance.now();
    worst = Math.max(worst, at - last - 2);
    last = at;
  }, 2);
  await engine.run(ctx, row, { mode: "incremental" });
  await new Promise<void>((r) => setTimeout(r, 10));
  clearInterval(timer);
  process.stderr.write(`[sealwait] ${kept} values kept, longest block ${Math.round(worst)} ms\n`);
  assert.equal(kept, N, "every value that waited is kept");
  assert.ok(worst <= 100, `the loop was held for ${Math.round(worst)} ms (budget 100 ms)`);
});
