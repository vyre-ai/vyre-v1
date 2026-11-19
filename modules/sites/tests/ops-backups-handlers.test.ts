// sites.backup_* over a real SQLite, a fake runner and a fake blob store (r42-sites-run, slice 5).
// @reads ../migrations/0001_sites_core.sql
// @reads ../migrations/0002_promote_tables.sql
// @reads ../migrations/0003_routes.sql
// @reads ../migrations/0004_deploy.sql
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { backupHandlers, runBackup } from "../handlers/ops-backups.ts";
import { configureRoutes } from "../handlers/route.ts";
import * as st from "../ops/store.ts";
import type { Backup } from "../ops/backups.ts";

const NOW = Date.parse("2026-11-19T10:30:00Z");
const DAY = 86_400_000;
function world(
  o: { dumpCode?: number; dumpOut?: string; dump?: Uint8Array; restoreCode?: number; noPostgres?: boolean } = {},
) {
  const raw = new DatabaseSync(":memory:");
  for (const f of [
    "0001_sites_core.sql",
    "0002_promote_tables.sql",
    "0003_routes.sql",
    "0004_deploy.sql",
    "0010_ops.sql",
    "0011_ops_runs.sql",
  ])
    raw.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  const execs: string[][] = [];
  const put: { dir: string; name: string; n: number }[] = [];
  const runner = {
    exec: async (_c: string, cmd: string[]) => {
      execs.push(cmd);
      if (cmd[0] === "psql" && cmd.includes("-tAc")) return { code: 0, out: "48234567\n" };
      if (cmd[2]?.includes("pg_dump")) return { code: o.dumpCode ?? 0, out: o.dumpOut ?? "" };
      if (cmd[2]?.includes("gunzip"))
        return { code: o.restoreCode ?? 0, out: o.restoreCode ? "psql: error: syntax error at line 4" : "" };
      return { code: 0, out: "" };
    },
    getFile: async () => o.dump ?? new Uint8Array(1234),
    put: async (_c: string, dir: string, name: string, b: Uint8Array) => void put.push({ dir, name, n: b.length }),
  };
  configureRoutes({ runner } as never);
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const blobs = {
    put: async (bytes: Uint8Array, _t: string, opts?: { resource?: { type: string; id: string } }) => {
      const id = `blb_${++n}`;
      store.set(id, bytes);
      assert.deepEqual(
        opts?.resource,
        { type: "site", id: "sit_a" },
        "a backup is readable by whoever can see the site",
      );
      return { id, contentType: "application/gzip", size: bytes.length, sha256: "x", createdAt: NOW };
    },
    get: async (id: string) => (store.has(id) ? { meta: { id } as never, bytes: store.get(id) as Uint8Array } : null),
    stat: async () => null,
    delete: async (id: string) => store.delete(id),
  };
  const ctx = {
    db,
    blobs,
    now: () => NOW,
    principal: { kind: "person", id: "usr_1" },
    trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" },
  } as unknown as Ctx;
  for (const id of ["sit_a", "sit_b"])
    db.run(
      "INSERT INTO sites_site (id, name, kind, owner, state, service_principal, created_at, updated_at) VALUES (?, 'S', 'app', 'usr_1', 'ready', 'svc_1', 1, 1)",
      id,
    );
  if (!o.noPostgres)
    db.run(
      "INSERT INTO sites_addon (site_id, kind, container_id, state, env_name, secret, created_at) VALUES ('sit_a', 'postgres', 'pg1', 'ready', 'DATABASE_URL', '{}', 1)",
    );
  return { db, ctx, execs, put, store };
}
const call = (ctx: Ctx, cap: keyof typeof backupHandlers, input: unknown) =>
  (backupHandlers[cap] as (c: Ctx, i: unknown) => Promise<any>)(ctx, input); // eslint-disable-line @typescript-eslint/no-explicit-any
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const add = (w: ReturnType<typeof world>, b: Partial<Backup> & { id: string }): void =>
  st.insertBackup(w.db, { siteId: "sit_a", kind: "postgres", state: "ready", by: "person", at: NOW, ...b });

test("a backup dumps in the Postgres container, keeps the file as a blob of the site, and ends ready with its size", async () => {
  const w = world({ dump: new Uint8Array(4321) });
  const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  assert.equal(backup.state, "queued");
  await settle();
  const b = st.getBackup(w.db, backup.backupId)!;
  assert.equal(b.state, "ready");
  assert.equal(b.bytes, 4321);
  assert.ok(b.fileId && w.store.has(b.fileId));
  assert.ok(w.execs.some((c) => c[2]?.includes("pg_dump -U app")));
  assert.ok(
    w.execs.some((c) => c[0] === "rm"),
    "the dump file is removed from the container",
  );
});

test("a site with no running Postgres is told, and a second backup while one runs is refused", async () => {
  const none = world({ noPostgres: true });
  assert.equal(
    await code(call(none.ctx, "sites.backup_create", { siteId: "sit_a" })),
    "validation.precondition_failed",
  );
  assert.equal((await call(none.ctx, "sites.backups_list", { siteId: "sit_a" })).hasDatabase, false);
  const w = world();
  await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  assert.equal(await code(call(w.ctx, "sites.backup_create", { siteId: "sit_a" })), "validation.precondition_failed");
  await settle();
});

test("a failed dump says why in one sentence and keeps no file", async () => {
  const w = world({ dumpCode: 1, dumpOut: "pg_dump: error: connection to server failed" });
  const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  await settle();
  const b = st.getBackup(w.db, backup.backupId)!;
  assert.equal(b.state, "failed");
  assert.equal(b.note, "The dump failed: connection to server failed.");
  assert.equal(w.store.size, 0);
});

test("a dump over the cap is refused with what to do instead, and nothing is kept", async () => {
  const w = world();
  const b: Backup = { id: "bkp_big", siteId: "sit_a", kind: "postgres", state: "queued", by: "person", at: NOW };
  st.insertBackup(w.db, b);
  const big = { length: 600 * 1024 * 1024 } as Uint8Array;
  const r = world({ dump: big });
  st.insertBackup(r.db, b);
  await runBackup(r.ctx, b, "pg1");
  assert.equal(st.getBackup(r.db, "bkp_big")?.state, "failed");
  assert.match(st.getBackup(r.db, "bkp_big")?.note ?? "", /more than the 512 MB kept here/);
  assert.equal(r.store.size, 0);
});

test("the list shows the database size, and a backup left running by a restart is failed with the way out", async () => {
  const w = world();
  add(w, { id: "bkp_old", state: "running", at: NOW - 1000 });
  add(w, { id: "bkp_q", state: "queued", at: NOW - 900 });
  const r = await call(w.ctx, "sites.backups_list", { siteId: "sit_a" });
  assert.equal(r.database.bytes, 48234567);
  const byId = new Map(r.backups.map((b: { backupId: string; state: string; note?: string }) => [b.backupId, b]));
  assert.equal((byId.get("bkp_old") as { state: string }).state, "failed");
  assert.match((byId.get("bkp_old") as { note: string }).note, /Back up again/);
  assert.equal((byId.get("bkp_q") as { state: string }).state, "failed");
});

test("after a good backup the old ones past the rule go with their files, and a pinned one stays", async () => {
  const w = world();
  for (let i = 0; i < 9; i++) {
    const blob = await w.ctx.blobs!.put(new Uint8Array(1), "x", { resource: { type: "site", id: "sit_a" } });
    add(w, {
      id: `bkp_${i}`,
      at: NOW - (20 + i) * DAY,
      fileId: blob.id,
      bytes: 1,
      ...(i === 8 ? { pinned: true } : {}),
    });
    if (i === 8) st.setPinned(w.db, `bkp_${i}`, true);
  }
  const before = w.store.size;
  const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  await settle();
  const ids = st.listBackups(w.db, "sit_a").map((b) => b.id);
  assert.ok(ids.includes(backup.backupId));
  assert.ok(ids.includes("bkp_8"), "pinned");
  assert.ok(ids.includes("bkp_0") && ids.includes("bkp_5"), "the newest seven stay (this one and six of the nine)");
  assert.equal(ids.includes("bkp_6") || ids.includes("bkp_7"), false);
  assert.ok(w.store.size < before + 1, "the files of the removed ones went too");
});

test("delete removes the file; one still being made cannot be deleted; pin and unpin", async () => {
  const w = world();
  const blob = await w.ctx.blobs!.put(new Uint8Array(1), "x", { resource: { type: "site", id: "sit_a" } });
  add(w, { id: "bkp_a", fileId: blob.id });
  add(w, { id: "bkp_run", state: "running" });
  assert.equal(
    await code(call(w.ctx, "sites.backup_delete", { siteId: "sit_a", backupId: "bkp_run" })),
    "validation.precondition_failed",
  );
  assert.equal((await call(w.ctx, "sites.backup_pin", { siteId: "sit_a", backupId: "bkp_a" })).backup.pinned, true);
  assert.equal(
    (await call(w.ctx, "sites.backup_pin", { siteId: "sit_a", backupId: "bkp_a", pinned: false })).backup.pinned,
    undefined,
  );
  assert.deepEqual(await call(w.ctx, "sites.backup_delete", { siteId: "sit_a", backupId: "bkp_a" }), { removed: true });
  assert.equal(w.store.size, 0);
  assert.equal(
    await code(call(w.ctx, "sites.backup_delete", { siteId: "sit_b", backupId: "bkp_a" })),
    "validation.not_found",
  );
});

test("restore puts the dump in, drops and makes the database again, and says so; a stopped restore says what to do", async () => {
  const w = world();
  const blob = await w.ctx.blobs!.put(new Uint8Array(77), "x", { resource: { type: "site", id: "sit_a" } });
  add(w, { id: "bkp_a", fileId: blob.id, bytes: 77 });
  const r = await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.deepEqual(r, { ok: true, detail: "The database is back as it was." });
  assert.deepEqual(w.put, [{ dir: "/tmp", name: "vyre-restore.gz", n: 77 }]);
  assert.ok(w.execs.some((c) => c[2]?.includes("DROP DATABASE IF EXISTS app WITH (FORCE)")));
  const bad = world({ restoreCode: 1 });
  const blob2 = await bad.ctx.blobs!.put(new Uint8Array(1), "x", { resource: { type: "site", id: "sit_a" } });
  add(bad, { id: "bkp_a", fileId: blob2.id });
  const stopped = await call(bad.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.equal(stopped.ok, false);
  assert.match(stopped.detail, /stopped part way: syntax error at line 4/);
});

test("only a finished backup can be restored, and one whose file is gone says so", async () => {
  const w = world();
  add(w, { id: "bkp_run", state: "running" });
  add(w, { id: "bkp_gone", fileId: "blb_nope" });
  assert.equal(
    await code(call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_run" })),
    "validation.precondition_failed",
  );
  assert.equal(
    await code(call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_gone" })),
    "validation.not_found",
  );
});
