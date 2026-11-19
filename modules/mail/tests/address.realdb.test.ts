// The unique index on a live route address, on a real SQL engine (node:sqlite), not the in-memory stand-in the other mail tests use, which ignores indexes.
// Boundary B2 keeps node:sqlite out of module imports, so the built-in is asked for through the runtime, as the other modules' fixtures do.
import test from "node:test";
import assert from "node:assert/strict";
import { addressAdd } from "../handlers/address.ts";
import { ensureAll } from "../handlers/extra/common.ts";
import { openCleanups } from "../handlers/cleanup.ts";
import { ensure } from "../projections.ts";
import { codeOf, harness, seedMailbox } from "../fixtures/harness.ts";
import type { MailDb } from "../projections.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

function realDb(): MailDb {
  const db = new DatabaseSync(":memory:");
  return {
    all: (sql, ...args) => db.prepare(sql).all(...(args as never[])) as unknown[],
    run: (sql, ...args) => ({ changes: Number(db.prepare(sql).run(...(args as never[])).changes) }),
  };
}
function real() {
  const h = harness();
  h.ctx.db = realDb();
  ensureAll(h.ctx);
  h.ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dom_real",
    "northwind.example",
    "resend",
    "pass",
    "pass",
    "pass",
    1,
    1,
    JSON.stringify({ ref: "r", providerVerified: true, records: [] }),
    null,
    1,
    1,
    null,
  );
  seedMailbox(h, "mbx_a", "a@northwind.example", { kind: "shared", privacy: "space" });
  seedMailbox(h, "mbx_b", "b@northwind.example", { kind: "shared", privacy: "space" });
  return h;
}
const insert = (h: ReturnType<typeof real>, id: string, mailbox: string, deleted: number | null = null) =>
  h.ctx.db.run(
    `INSERT INTO mail_route (id, "domainId", "localPart", "mailboxId", provider, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    "dom_real",
    "billing",
    mailbox,
    "resend",
    1,
    1,
    deleted,
  );

test("on a real database, a second live route for one address is refused by the index, and a removed one does not count", () => {
  const h = real();
  insert(h, "rte_one", "mbx_a");
  assert.throws(() => insert(h, "rte_two", "mbx_b"), /UNIQUE constraint failed/);
  assert.deepEqual(
    h.rows(`SELECT id FROM mail_route`).map((r) => r.id),
    ["rte_one"],
  );
  // a removed route frees the name; two removed ones can sit beside it
  h.ctx.db.run(`UPDATE mail_route SET deleted_at = ? WHERE id = ?`, 5, "rte_one");
  insert(h, "rte_three", "mbx_b");
  insert(h, "rte_four", "mbx_a", 6);
  assert.equal(h.rows(`SELECT id FROM mail_route WHERE deleted_at IS NULL`).length, 1);
});

test("on a real database, two adds of one name at once: one wins, the other is told it is taken, and the route stays with the winner", async () => {
  const h = real();
  const results = await Promise.allSettled([
    addressAdd(h.ctx, {
      domainId: "dom_real",
      localPart: "billing",
      mailboxId: "mbx_a",
      idempotencyKey: "idem-real-1",
    }),
    addressAdd(h.ctx, {
      domainId: "dom_real",
      localPart: "billing",
      mailboxId: "mbx_b",
      idempotencyKey: "idem-real-2",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(
    codeOf((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason),
    "validation.duplicate",
  );
  const live = h.rows(`SELECT "mailboxId" FROM mail_route WHERE deleted_at IS NULL`);
  assert.equal(live.length, 1);
  const winner = (
    results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ address: { mailboxId: string } }>
  ).value;
  assert.equal(live[0]?.mailboxId, winner.address.mailboxId);
});

function olderDb(h: ReturnType<typeof harness>, order: [string, string][]): void {
  h.ctx.db = realDb();
  ensure(h.ctx); // the core tables only: this database is from before the index
  h.ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dom_real",
    "northwind.example",
    "mailgun",
    "pass",
    "pass",
    "pass",
    1,
    1,
    "{}",
    null,
    1,
    1,
    null,
  );
  for (const [id, mailbox] of order)
    h.ctx.db.run(
      `INSERT INTO mail_route (id, "domainId", "localPart", "mailboxId", provider, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      "dom_real",
      "billing",
      mailbox,
      "mailgun",
      1,
      1,
      null,
    );
}
const withExt = (h: ReturnType<typeof harness>, routeId: string, providerRouteId: string): void => {
  h.ctx.db.run(`INSERT INTO mail_route_ext ("routeId", "providerRouteId") VALUES (?, ?)`, routeId, providerRouteId);
};
function reopen(h: ReturnType<typeof harness>) {
  const again = harness();
  const inner = h.ctx.db;
  again.ctx.db = { all: (sql, ...args) => inner.all(sql, ...args), run: (sql, ...args) => inner.run(sql, ...args) }; // a new handle on the same data: a new process
  ensureAll(again.ctx);
  return again;
}

test("on a real database that already holds two live routes for one address, the one that was receiving mail is kept, the other is removed with a visible note, and the index is then made", () => {
  const h = harness();
  // ingest takes the first row it finds, so the first in the table is the one mail goes to today (here not the smallest id)
  olderDb(h, [
    ["rte_0002", "mbx_b"],
    ["rte_0001", "mbx_a"],
  ]);
  const again = reopen(h);
  const live = again.rows(`SELECT id FROM mail_route WHERE deleted_at IS NULL`);
  assert.deepEqual(
    live.map((r) => r.id),
    ["rte_0002"],
    "mail keeps arriving where it arrived",
  );
  assert.ok(
    openCleanups(again.ctx).some(
      (c) => c.kind === "duplicate_route" && /billing@northwind\.example had 2 routes/.test(c.note),
    ),
  );
  assert.throws(() => insert(again as never, "rte_0003", "mbx_b"), /UNIQUE constraint failed/);
});

test("duplicates that share one Mailgun route, or where only the removed one had a route, never lose the address's only route", () => {
  // shared: nothing is deleted
  const shared = harness();
  olderDb(shared, [
    ["rte_0001", "mbx_a"],
    ["rte_0002", "mbx_b"],
  ]);
  shared.ctx.db.run(`CREATE TABLE IF NOT EXISTS mail_route_ext ("routeId" TEXT PRIMARY KEY, "providerRouteId" TEXT)`);
  withExt(shared, "rte_0001", "mgr_one");
  withExt(shared, "rte_0002", "mgr_one");
  assert.ok(
    !openCleanups(reopen(shared).ctx).some((c) => c.kind === "provider_route"),
    "the one shared route is not queued for deletion",
  );
  // only the removed row had one: the kept row takes it over
  const only = harness();
  olderDb(only, [
    ["rte_0001", "mbx_a"],
    ["rte_0002", "mbx_b"],
  ]);
  only.ctx.db.run(`CREATE TABLE IF NOT EXISTS mail_route_ext ("routeId" TEXT PRIMARY KEY, "providerRouteId" TEXT)`);
  withExt(only, "rte_0002", "mgr_two");
  const after = reopen(only);
  assert.ok(!openCleanups(after.ctx).some((c) => c.kind === "provider_route"));
  assert.equal(
    after.rows(`SELECT "providerRouteId" FROM mail_route_ext WHERE "routeId" = ?`, "rte_0001")[0]?.providerRouteId,
    "mgr_two",
  );
  // two different routes: the extra one is queued for deletion
  const two = harness();
  olderDb(two, [
    ["rte_0001", "mbx_a"],
    ["rte_0002", "mbx_b"],
  ]);
  two.ctx.db.run(`CREATE TABLE IF NOT EXISTS mail_route_ext ("routeId" TEXT PRIMARY KEY, "providerRouteId" TEXT)`);
  withExt(two, "rte_0001", "mgr_a");
  withExt(two, "rte_0002", "mgr_b");
  assert.ok(
    openCleanups(reopen(two).ctx).some((c) => c.kind === "provider_route" && /duplicate Mailgun route/.test(c.note)),
  );
});
