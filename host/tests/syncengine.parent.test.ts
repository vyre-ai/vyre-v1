// A per-parent list through a whole engine: the sweep that looks for what the app removed vouches parent by parent. A child is marked removed only when its own parent was read to the end in that
// sweep and the child was not in its list; a parent the sweep could not vouch for (one that no longer meets `where`, one made after the sweep began) keeps every child it has. And `changed` reads
// again only the parents whose version moved, with the sweep as the backstop. Fixtures are made up.
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

const DAY = 86_400_000;

async function kit(eachOf: Record<string, unknown>) {
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncparent-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_parent" });
  const { store, tx } = space.open();
  await store.define({
    add_types: [
      {
        name: "child",
        label: "Child",
        fields: [
          { name: "name", kind: "text", label: "Name" },
          { name: "matter", kind: "text", label: "Matter" },
        ],
      },
    ],
  });
  const parents = new Map<string, Record<string, unknown>>([
    ["mA", { "/sub": true, "/rev": "1" }],
    ["mB", { "/sub": true, "/rev": "1" }],
    ["mC", { "/sub": true, "/rev": "1" }],
  ]);
  const many = (prefix: string): Map<string, string> =>
    new Map(Array.from({ length: 30 }, (_, n) => [`${prefix}${n + 1}`, `${prefix}${n + 1} name`] as const));
  const children = new Map<string, Map<string, string>>([
    ["mA", many("a")],
    ["mB", many("b")],
    ["mC", many("c")],
  ]);
  const reads: string[] = [];
  let t = 1_800_000_000_000;
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get")
        return {
          connector: {
            key: "fakeapp",
            objects: {
              matters: { list: "list_matters", listAfter: "list_matters_after" },
              children: {
                list: "list_children",
                listAfter: "list_children_after",
                eachOf: { remote: "matters", scoped: false, ...eachOf },
              },
            },
          },
        };
      const i = input as { action: string; input?: { parent?: string } };
      if (i.action === "list_matters")
        return { output: { results: [...parents].map(([id, properties]) => ({ id, properties })) } };
      const p = i.input?.parent as string;
      reads.push(p);
      return {
        output: { results: [...(children.get(p) ?? [])].map(([id, name]) => ({ id, properties: { "/name": name } })) },
      };
    },
  };
  const row: BindingRow = {
    syncTypeId: "syt_child",
    type: "child",
    connector: "fakeapp",
    connectionId: "con_1",
    remote: "children",
    fields: [
      { key: "name", remote: "/name", dir: "pull" },
      { key: "matter", remote: "/_parent", dir: "pull" },
    ],
    match: [],
    createAtSource: false,
    deletes: "off",
    conflict: "newest",
  };
  const engine = createSyncEngine({ core, local: { open: () => ({ store, tx }) }, now: () => t });
  const pass = async (): Promise<string> => {
    let last = "";
    for (let i = 0; i < 50; i++) {
      const r = await engine.run(ctx, row, { mode: "incremental" });
      last = r.summary;
      if (!r.more) return last;
    }
    throw new Error("the pass did not end");
  };
  const names = async (): Promise<string[]> =>
    (await store.query("child", { page: { limit: 100 } })).rows.map((r) => String(r.data["name"])).sort();
  const removed = (): string[] =>
    tx
      .all<{ remote_id: string }>(
        "SELECT remote_id FROM sy_links WHERE sync_type = 'syt_child' AND removed_at IS NOT NULL",
      )
      .map((x) => x.remote_id)
      .sort();
  return {
    parents,
    children,
    reads,
    pass,
    names,
    removed,
    advance: (ms: number) => (t += ms),
    mark: () => reads.splice(0),
  };
}

test("a sweep marks a child removed only under a parent it read to the end; a parent that no longer meets `where` keeps all its children", async () => {
  const k = await kit({ where: { path: "/sub", e: ["true"] } });
  await k.pass();
  assert.equal((await k.names()).length, 90, "the first pull brings every child");
  // the app: mB lost b2, mC is no longer submitted (so it is not read) and mA is as it was
  k.children.get("mB")!.delete("b2");
  k.parents.set("mC", { "/sub": false, "/rev": "1" });
  k.advance(2 * DAY);
  k.mark();
  await k.pass();
  assert.deepEqual(k.removed(), ["b2"], "b2 is gone from a parent that was read to the end; mC's child is not touched");
  assert.ok(!k.reads.includes("mC"), "mC was not read");
});

test("a child under a parent that is new since the place was kept, or that the sweep never reached, is not marked removed", async () => {
  const k = await kit({});
  await k.pass();
  // a parent whose id sorts before everything appears at the app; the app also drops mA's a1
  k.parents.set("m0", { "/sub": true, "/rev": "1" });
  k.children.set("m0", new Map([["z1", "z1 name"]]));
  k.children.get("mA")!.delete("a1");
  k.advance(2 * DAY);
  await k.pass();
  assert.deepEqual(k.removed(), ["a1"], "only what the app dropped under a parent that was read");
  assert.ok((await k.names()).includes("z1 name"), "the new parent's child came in");
});

test("changed: a check reads again only the parents whose version moved; the sweep reads them all", async () => {
  const k = await kit({ changed: { path: "/rev" } });
  await k.pass();
  assert.equal((await k.names()).length, 90);
  // mA changes at the app (version moves), mB changes without its version moving
  k.parents.set("mA", { "/sub": true, "/rev": "2" });
  k.children.get("mA")!.set("a1", "a1 edited");
  k.children.get("mB")!.set("b1", "b1 edited");
  k.advance(10 * 60_000 + 1);
  k.mark();
  await k.pass();
  assert.deepEqual([...new Set(k.reads)], ["mA"], "only the parent whose version moved was read");
  const after = await k.names();
  assert.ok(after.includes("a1 edited"));
  assert.ok(!after.includes("b1 edited"), "an unversioned change waits for the sweep");
  // a day later the sweep reads every parent and brings the rest
  k.advance(2 * DAY);
  k.mark();
  await k.pass();
  assert.deepEqual([...new Set(k.reads)].sort(), ["mA", "mB", "mC"]);
  assert.ok((await k.names()).includes("b1 edited"));
});
