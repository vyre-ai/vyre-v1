// site tables (spec 2.20 Site tables): created by anyone who can edit the site without a schema permission, promoted to the Space with schema.manage.
// @reads /modules/sites/migrations/0001_sites_core.sql
// @reads /modules/sites/migrations/0002_promote_tables.sql

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hexOf } from "../handlers/deploy.ts";
import { tableType } from "../handlers/tables.ts";
import { handlers } from "../handlers/index.ts";
import { MemoryDb, readMigration } from "../fixtures/db.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;

const here = dirname(fileURLToPath(import.meta.url));

interface Asked { perm: string | null; level: string; type: string }

/** a world with both migrations; records the authorize questions and answers record counts from `counts` (a missing type throws like an unreachable Records) */
function world(): World & { asked: Asked[]; counts: Map<string, number>; denyPerm: Set<string>; db: MemoryDb } {
  const w = harness();
  const db = new MemoryDb(`${readMigration()}\n${readFileSync(join(here, "../migrations/0002_promote_tables.sql"), "utf8")}`);
  w.ctx.db = db;
  const asked: Asked[] = [];
  const counts = new Map<string, number>();
  const denyPerm = new Set<string>();
  const authorize = w.ctx.authorize.bind(w.ctx);
  w.ctx.authorize = (action, resource) => {
    asked.push({ perm: action.perm, level: action.level, type: resource.type });
    if (action.perm !== null && denyPerm.has(action.perm)) return { effect: "deny", reason: "no role", decisionId: "dec_deny" };
    return authorize(action, resource);
  };
  const base = w.ctx.call.bind(w.ctx);
  w.ctx.call = (async (cap: string, input: unknown) => {
    if (cap === "records.counts") {
      const type = (input as { type: string }).type;
      const n = counts.get(type);
      if (n === undefined) throw new Error("records is not reachable");
      return { count: n };
    }
    return base(cap as never, input);
  }) as Ctx["call"];
  return Object.assign(w, { asked, counts, denyPerm, db });
}

async function run<T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> {
  return (await (handlers[cap] as Fn)(ctx, input)) as T;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

async function newSite(w: World, name = "Harbor"): Promise<string> {
  const out = await run<{ site: { siteId: string } }>(w.ctx, "sites.create", { name, kind: "app", idempotencyKey: `k-${name}` });
  return out.site.siteId;
}

const FIELDS = [
  { key: "title", type: "text", title: "Title" },
  { key: "done", type: "checkbox", title: "Done" },
];

test("table_create: a site-scoped record type, a version row, one event, and no schema permission asked", async () => {
  const w = world();
  const siteId = await newSite(w);
  w.asked.length = 0;
  const out = await run<{ type: string }>(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS });
  assert.equal(out.type, tableType(siteId, "todos"));
  assert.equal(out.type, `site_${hexOf(siteId)}_todos`);
  assert.match(out.type, /^[a-z][a-z0-9_]*$/);

  const row = w.db.rows("sites_table")[0];
  assert.deepEqual([row?.type, row?.site_id, row?.key, row?.scope, row?.version, row?.created_by, row?.promoted_by], [out.type, siteId, "todos", "site", 1, "usr_owner", null]);
  assert.deepEqual(JSON.parse(String(row?.fields)), FIELDS);
  const version = w.db.rows("sites_table_version");
  assert.deepEqual(version.map((v) => [v.type, v.version, v.change, v.by]), [[out.type, 1, "create", "usr_owner"]]);
  assert.deepEqual(w.events.filter((e) => e.name === "site.table_created"), [{ name: "site.table_created", subject: `site/${siteId}`, payload: { siteId, type: out.type } }]);

  // edit on the site is asked; schema.manage never is
  assert.deepEqual(w.asked.map((a) => [a.perm, a.level, a.type]), [[null, "edit", "site"]]);
});

test("table_create: needs edit on the site, rejects bad keys and fields, and a repeated key is a duplicate", async () => {
  const w = world();
  const siteId = await newSite(w);
  w.levelFor.set("site", "view");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS })), "permission.no_grant");
  w.levelFor.set("site", "edit");
  assert.equal(w.db.rows("sites_table").length, 0);

  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId: "sit_missing", key: "todos", fields: FIELDS })), "validation.not_found");
  for (const key of ["", "Todos", "1todos", "to-dos", "a".repeat(41)]) {
    assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key, fields: FIELDS })), "validation.bad_input", key);
  }
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: [] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: [{ key: "Bad", type: "text", title: "x" }] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: [{ key: "a", type: "Text!", title: "x" }] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: [{ key: "a", type: "text", title: " " }] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: [{ key: "a", type: "text" }] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: [FIELDS[0], FIELDS[0]] })), "validation.duplicate");
  const many = Array.from({ length: 101 }, (_, i) => ({ key: `f${i}`, type: "text", title: `F ${i}` }));
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: many })), "validation.too_large");
  assert.equal(w.db.rows("sites_table").length, 0);
  assert.equal(w.events.filter((e) => e.name === "site.table_created").length, 0);

  await run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS });
  assert.equal(await code(run(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS })), "validation.duplicate");
  // the same key on another site is a different type
  const other = await newSite(w, "Second");
  const second = await run<{ type: string }>(w.ctx, "sites.table_create", { siteId: other, key: "todos", fields: FIELDS });
  assert.notEqual(second.type, tableType(siteId, "todos"));
  assert.equal(w.db.rows("sites_table").length, 2);
});

test("tables: lists the tables of one site with Records row counts; unreachable Records counts 0", async () => {
  const w = world();
  const siteId = await newSite(w);
  const other = await newSite(w, "Second");
  assert.deepEqual(await run(w.ctx, "sites.tables", { siteId }), { tables: [] });
  const todos = (await run<{ type: string }>(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS })).type;
  const notes = (await run<{ type: string }>(w.ctx, "sites.table_create", { siteId, key: "notes", fields: FIELDS })).type;
  await run(w.ctx, "sites.table_create", { siteId: other, key: "orders", fields: FIELDS });
  w.counts.set(todos, 12);
  const listed = await run<{ tables: { type: string; rows: number }[] }>(w.ctx, "sites.tables", { siteId });
  assert.deepEqual(listed.tables, [{ type: notes, rows: 0 }, { type: todos, rows: 12 }].sort((a, b) => a.type.localeCompare(b.type)));
  assert.equal(w.warnings.length, 1);
  assert.equal(await code(run(w.ctx, "sites.tables", { siteId: "sit_missing" })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.tables", {})), "validation.bad_input");
});

test("table_promote: needs schema.manage; with it the type becomes a Space type, keeps its key, versions once and emits once", async () => {
  const w = world();
  const siteId = await newSite(w);
  const type = (await run<{ type: string }>(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS })).type;

  w.denyPerm.add("schema.manage");
  assert.equal(await code(run(w.ctx, "sites.table_promote", { siteId, type })), "permission.role_lacks_permission");
  assert.equal(w.db.rows("sites_table")[0]?.scope, "site");
  assert.equal(w.events.filter((e) => e.name === "site.table_promoted").length, 0);

  w.denyPerm.clear();
  w.asked.length = 0;
  w.advance(5000);
  assert.deepEqual(await run(w.ctx, "sites.table_promote", { siteId, type }), { type });
  assert.deepEqual(w.asked.map((a) => [a.perm, a.level, a.type]), [["schema.manage", "manage", "record_type"]]);
  const row = w.db.rows("sites_table")[0];
  assert.deepEqual([row?.type, row?.scope, row?.version, row?.promoted_by], [type, "space", 2, "usr_owner"]);
  assert.equal(typeof row?.promoted_at, "number");
  assert.deepEqual(w.db.rows("sites_table_version").map((v) => [v.version, v.change]), [[1, "create"], [2, "promote"]]);
  assert.deepEqual(w.events.filter((e) => e.name === "site.table_promoted"), [{ name: "site.table_promoted", subject: `site/${siteId}`, payload: { siteId, type } }]);

  // promoting again changes nothing
  assert.deepEqual(await run(w.ctx, "sites.table_promote", { siteId, type }), { type });
  assert.equal(w.db.rows("sites_table_version").length, 2);
  assert.equal(w.events.filter((e) => e.name === "site.table_promoted").length, 1);
});

test("table_promote: an unknown table, a table of another site and a missing type are refused", async () => {
  const w = world();
  const siteId = await newSite(w);
  const other = await newSite(w, "Second");
  const type = (await run<{ type: string }>(w.ctx, "sites.table_create", { siteId, key: "todos", fields: FIELDS })).type;
  assert.equal(await code(run(w.ctx, "sites.table_promote", { siteId, type: "site_nope_todos" })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.table_promote", { siteId: other, type })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.table_promote", { siteId: "sit_missing", type })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.table_promote", { siteId })), "validation.bad_input");
  assert.equal(w.db.rows("sites_table")[0]?.scope, "site");
  assert.equal(w.events.filter((e) => e.name === "site.table_promoted").length, 0);
});
