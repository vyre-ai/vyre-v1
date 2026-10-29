// Ruling 65: the root folders files.tree makes are registered with the host as access resources, parents first, once, and the Personal root only for its owner.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /modules/files/migrations/0005_files_entities.sql
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureFilesHost, handlers } from "../impl.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function world() {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));
  const ensured: { id: string; parentId: string | null; ownerId?: string }[] = [];
  configureFilesHost({ resources: { ensure: async (r) => { ensured.push({ id: r.id, parentId: r.parentId, ...(r.ownerId ? { ownerId: r.ownerId } : {}) }); }, setLabel: async () => {} } });
  const ctxFor = (who: string): Ctx => ({
    space: "spc_t", principal: { kind: "person", id: who }, trace: { traceId: "t".repeat(32), spanId: "s".repeat(16) }, origin: "api", depth: 0, now: () => 1_790_000_000_000,
    db: { all: (q: string, ...a: unknown[]) => sql.prepare(q).all(...(a as never[])) as unknown[], run: (q: string, ...a: unknown[]) => ({ changes: Number(sql.prepare(q).run(...(a as never[])).changes) }) },
    emit: ((_n: string, _s: string, p: unknown) => ({ payload: p })) as never, call: (async () => ({ rows: [], total: 0 })) as never,
    log: { debug() {}, info() {}, warn() {}, error() {} }, authorize: (() => ({ effect: "allow", reason: "", decisionId: "d" })) as never,
  }) as unknown as Ctx;
  return { ensured, ctxFor };
}

test("roots: the first call registers the Space roots and the caller's Personal root, parents first; the next call asks nothing", async () => {
  const w = world();
  const tree = (await handlers["files.tree"](w.ctxFor("usr_a"), {})) as { roots: { key: string; folderId?: string }[] };
  const ids = new Map(tree.roots.filter((r) => r.folderId).map((r) => [r.key, r.folderId!]));
  const registered = new Set(w.ensured.map((e) => e.id));
  for (const id of ids.values()) assert.ok(registered.has(id), `root ${id} is registered`);
  const knowledge = ids.get("knowledge")!;
  const child = w.ensured.find((e) => e.parentId === knowledge);
  assert.ok(child, "a Knowledge child is registered under the Knowledge root");
  assert.ok(w.ensured.findIndex((e) => e.id === knowledge) < w.ensured.indexOf(child), "the parent comes first");
  assert.equal(w.ensured.find((e) => e.id === ids.get("personal"))?.ownerId, "usr_a", "the Personal root is owned by its person");
  assert.equal(w.ensured.find((e) => e.id === ids.get("projects"))?.ownerId, undefined, "a Space root has no owner of its own");
  const n = w.ensured.length;
  await handlers["files.tree"](w.ctxFor("usr_a"), {});
  assert.equal(w.ensured.length, n, "a second call registers nothing");
  await handlers["files.tree"](w.ctxFor("usr_b"), {});
  const added = w.ensured.slice(n);
  assert.equal(added.length, 1, "another person adds only their own Personal root");
  assert.equal(added[0]?.ownerId, "usr_b");
  configureFilesHost(null);
});
