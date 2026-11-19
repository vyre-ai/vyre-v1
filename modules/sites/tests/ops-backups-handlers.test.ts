// sites.backup_* over a real SQLite, a fake runner and a fake blob store (r42-sites-run, slice 5).
// @reads ../migrations/0001_sites_core.sql
// @reads ../migrations/0002_promote_tables.sql
// @reads ../migrations/0003_routes.sql
// @reads ../migrations/0004_deploy.sql
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
// @reads ../migrations/0012_ops_locks.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { _test, backupHandlers, dueBackupSites, runBackup } from "../handlers/ops-backups.ts";
import { TooBig } from "../ops/tarread.ts";
import { configureRoutes } from "../handlers/route.ts";
import * as st from "../ops/store.ts";
import type { Backup } from "../ops/backups.ts";

const NOW = Date.parse("2026-11-19T10:30:00Z");
const DAY = 86_400_000;
function world(
  o: { dumpCode?: number; dumpOut?: string; dump?: Uint8Array; restoreCode?: number; noPostgres?: boolean } = {},
) {
  _test.clearSizes();
  const raw = new DatabaseSync(":memory:");
  for (const f of [
    "0001_sites_core.sql",
    "0002_promote_tables.sql",
    "0003_routes.sql",
    "0004_deploy.sql",
    "0010_ops.sql",
    "0011_ops_runs.sql",
    "0012_ops_locks.sql",
  ])
    raw.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  const execs: string[][] = [];
  const drops: string[] = [];
  const put: { dir: string; name: string; n: number }[] = [];
  const runner = {
    exec: async (_c: string, cmd: string[]) => {
      execs.push(cmd);
      const text = cmd.join(" ");
      if (text.includes("app_old") && cmd.includes("-tAc"))
        return o.oldBytes === undefined
          ? { code: 1, out: "ERROR: database app_old does not exist" }
          : { code: 0, out: `${o.oldBytes}\n` };
      if (text.includes("DROP DATABASE IF EXISTS app_old") && !text.includes("ALLOW_CONNECTIONS")) {
        drops.push("app_old");
        return { code: 0, out: "" };
      }
      if (cmd[0] === "psql" && cmd.includes("-tAc")) return { code: 0, out: "48234567\n" };
      if (cmd[0] === "stat") return { code: 0, out: `${o.statSize ?? 1234}\n` };
      if (text.includes("pg_dump"))
        return {
          code: o.dumpFails?.() ? 1 : (o.dumpCode ?? 0),
          out: o.dumpFails?.() ? "pg_dump: error: connection to server failed" : (o.dumpOut ?? ""),
        };
      if (text.includes("gunzip"))
        return { code: o.restoreCode ?? 0, out: o.restoreCode ? "psql: error: syntax error at line 4" : "" };
      if (text.includes("ALLOW_CONNECTIONS false"))
        return { code: o.swapCode ?? 0, out: o.swapCode ? "ERROR: database is being accessed by other users" : "" };
      return { code: 0, out: "" };
    },
    getFileParts: async (
      _c: string,
      _p: string,
      _max: number,
      part: number,
      onPart: (p: Uint8Array) => Promise<void>,
    ) => {
      o.onGetFile?.();
      if (o.getFileThrows) throw o.getFileThrows;
      const data = o.dump ?? new Uint8Array(1234);
      for (let i = 0; i < data.length; i += part) await onPart(data.subarray(i, i + part));
      return data.length;
    },
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
    stat: async (id: string) =>
      store.has(id)
        ? { id, contentType: "x", size: (store.get(id) as Uint8Array).length, sha256: "x", createdAt: NOW }
        : null,
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
  return { db, ctx, execs, put, store, runner, drops };
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

const has = (w: ReturnType<typeof world>, frag: string): boolean => w.execs.some((c) => c.join(" ").includes(frag));
async function ready(w: ReturnType<typeof world>, id = "bkp_a"): Promise<void> {
  const blob = await w.ctx.blobs!.put(new Uint8Array(77), "x", { resource: { type: "site", id: "sit_a" } });
  add(w, { id, fileId: blob.id, bytes: 77, at: NOW - 5 * DAY });
}

test("restore first makes a backup of the live database and keeps it seven days, loads the dump into a new database, and swaps only then", async () => {
  const w = world();
  await ready(w);
  const r = await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.equal(r.ok, true);
  assert.match(r.detail, /kept for 7 days/);
  const safety = st.listBackups(w.db, "sit_a").find((b) => b.id !== "bkp_a")!;
  assert.equal(safety.state, "ready");
  assert.equal(safety.keepUntil, NOW + 7 * DAY);
  const order = w.execs.map((c) => c.join(" "));
  const iDump = order.findIndex((c) => c.includes("pg_dump"));
  const iNew = order.findIndex((c) => c.includes("CREATE DATABASE app_restore"));
  const iLoad = order.findIndex((c) => c.includes("app_restore -v"));
  const iSwap = order.findIndex((c) => c.includes("RENAME TO app_old"));
  assert.ok(iDump >= 0 && iDump < iNew && iNew < iLoad && iLoad < iSwap, order.join("\n"));
  assert.ok(!has(w, "DROP DATABASE IF EXISTS app WITH"), "the live database is never dropped");
  assert.deepEqual(w.put, [{ dir: "/tmp", name: "vyre-restore.0000.gz", n: 77 }]);
});

test("restore is refused, and nothing is touched, when the safety backup cannot be made", async () => {
  const w = world({ dumpFails: () => true });
  await ready(w);
  const r = await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.equal(r.ok, false);
  assert.match(r.detail, /could not be backed up first.*Nothing changed/);
  assert.equal(has(w, "CREATE DATABASE"), false);
  assert.equal(has(w, "app_restore -v"), false);
  assert.equal(has(w, "RENAME"), false);
  assert.equal(w.put.length, 0);
});

test("a dump that stops part way leaves the live database untouched and drops the half-made one", async () => {
  const w = world({ restoreCode: 1 });
  await ready(w);
  const r = await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.equal(r.ok, false);
  assert.match(r.detail, /stopped part way \(syntax error at line 4\)\. The database was not touched/);
  assert.equal(has(w, "RENAME TO app_old"), false, "the swap never ran");
  assert.equal(has(w, "ALLOW_CONNECTIONS false"), false, "the site's connections were never cut");
  const drops = w.execs.map((c) => c.join(" ")).filter((c) => c.includes("DROP DATABASE IF EXISTS app_restore"));
  assert.equal(drops.length, 2, "once before, once after the failure");
});

test("a swap that fails puts the names back and says the database was left as it was", async () => {
  const w = world({ swapCode: 1 });
  await ready(w);
  const r = await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.equal(r.ok, false);
  assert.match(r.detail, /left as it was/);
  assert.ok(has(w, "ALTER DATABASE app_old RENAME TO app"));
  assert.ok(has(w, "ALTER DATABASE app ALLOW_CONNECTIONS true"));
});

test("backup and restore are exclusive per site: the second is refused with the reason, and the lock is let go afterwards", async () => {
  const w = world();
  await ready(w);
  await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  assert.equal(
    await code(call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" })),
    "validation.precondition_failed",
  );
  assert.equal(await code(call(w.ctx, "sites.backup_create", { siteId: "sit_a" })), "validation.precondition_failed");
  await settle();
  // free again
  assert.equal((await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" })).ok, true);
  const again = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  assert.equal(again.backup.state, "queued");
  await settle();
});

test("a restore holds the lock while it runs: a backup asked for meanwhile is refused with the reason", async () => {
  let w!: ReturnType<typeof world>;
  let during = "";
  w = world({
    onGetFile: () => {
      // the safety backup is copying out: a second call arrives now
      void (async () => {
        try {
          await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
        } catch (e) {
          if (e instanceof VyreErr) during = e.error.message;
        }
      })();
    },
  });
  await ready(w);
  await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: "bkp_a" });
  assert.match(during, /being put back/);
});

test("a lock left by a process that died is taken over", async () => {
  const w = world();
  w.db.run(
    "INSERT INTO sites_site_lock (site_id, kind, holder, since) VALUES ('sit_a', 'restore', 'pdead', ?)",
    NOW - 60_000,
  );
  const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  assert.equal(backup.state, "queued");
  await settle();
});

test("a dump over the cap is refused before it is copied out (by its size in the container), and when the copy itself meets the cap", async () => {
  const w = world({ statSize: 600 * 1024 * 1024 });
  const a = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  await settle();
  assert.match(st.getBackup(w.db, a.backup.backupId)?.note ?? "", /more than the 512 MB/);
  const c = world({ getFileThrows: new TooBig(700 * 1024 * 1024) });
  const b = await call(c.ctx, "sites.backup_create", { siteId: "sit_a" });
  await settle();
  assert.match(st.getBackup(c.db, b.backup.backupId)?.note ?? "", /700 MB, more than the 512 MB/);
  assert.equal(c.store.size, 0);
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

test("a dump is kept in parts and a restore sends them in order, one in memory at a time", async () => {
  _test.setPartBytes(100);
  try {
    const dump = new Uint8Array(250).map((_, i) => i % 200);
    const w = world({ dump });
    const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
    await settle();
    const b = st.getBackup(w.db, backup.backupId)!;
    assert.equal(b.bytes, 250);
    assert.equal(b.fileId?.split(",").length, 3, "100 + 100 + 50");
    assert.deepEqual(
      [...w.store.values()].map((x) => x.length),
      [100, 100, 50],
    );
    const r = await call(w.ctx, "sites.backup_restore", { siteId: "sit_a", backupId: backup.backupId });
    assert.equal(r.ok, true);
    assert.deepEqual(
      w.put.map((p) => [p.name, p.n]),
      [
        ["vyre-restore.0000.gz", 100],
        ["vyre-restore.0001.gz", 100],
        ["vyre-restore.0002.gz", 50],
      ],
    );
    const load = w.execs.map((c) => c.join(" ")).find((c) => c.includes("cat /tmp/vyre-restore"));
    assert.match(
      load ?? "",
      /cat \/tmp\/vyre-restore\.\*\.gz \| gunzip -t && cat .* \| gunzip \| psql/,
      "the whole dump is tested before it is loaded",
    );
  } finally {
    _test.setPartBytes(32 * 1024 * 1024);
  }
});

test("a copy that fails after some parts were kept removes those parts", async () => {
  _test.setPartBytes(100);
  try {
    let n = 0;
    const w = world({ dump: new Uint8Array(250) });
    const run = w.runner.getFileParts;
    w.runner.getFileParts = async (
      c: string,
      p: string,
      m: number,
      part: number,
      onPart: (x: Uint8Array) => Promise<void>,
    ) =>
      run(c, p, m, part, async (x) => {
        await onPart(x);
        if (++n === 2) throw new Error("the engine went away");
      });
    const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
    await settle();
    assert.equal(st.getBackup(w.db, backup.backupId)?.state, "failed");
    assert.equal(w.store.size, 0, "no part is left behind");
  } finally {
    _test.setPartBytes(32 * 1024 * 1024);
  }
});

test("the dump is made to a file and tested, so a failing dump is the command's failure", async () => {
  const w = world();
  await call(w.ctx, "sites.backup_create", { siteId: "sit_a" });
  await settle();
  const dumpCmd = w.execs.map((c) => c.join(" ")).find((c) => c.includes("pg_dump"));
  assert.match(
    dumpCmd ?? "",
    /pg_dump -U app -d app --no-owner -Z gzip -f \/tmp\/vyre-backup\.gz && gunzip -t \/tmp\/vyre-backup\.gz/,
  );
});

test("at most three backups can be kept for good", async () => {
  const w = world();
  for (const id of ["a", "b", "c", "d"]) add(w, { id: `bkp_${id}` });
  for (const id of ["a", "b", "c"]) await call(w.ctx, "sites.backup_pin", { siteId: "sit_a", backupId: `bkp_${id}` });
  assert.equal(
    await code(call(w.ctx, "sites.backup_pin", { siteId: "sit_a", backupId: "bkp_d" })),
    "validation.precondition_failed",
  );
  await call(w.ctx, "sites.backup_pin", { siteId: "sit_a", backupId: "bkp_a", pinned: false });
  assert.equal((await call(w.ctx, "sites.backup_pin", { siteId: "sit_a", backupId: "bkp_d" })).backup.pinned, true);
});

test("the replaced database is listed with its size while the safety backup is kept, and dropped once it expires", async () => {
  const w = world({ oldBytes: 7_800_000 });
  add(w, { id: "bkp_s", keepUntil: NOW + 3 * DAY });
  const live = await call(w.ctx, "sites.backups_list", { siteId: "sit_a" });
  assert.equal(live.database.replacedBytes, 7_800_000);
  assert.deepEqual(w.drops, []);
  const gone = world({ oldBytes: 7_800_000 });
  add(gone, { id: "bkp_s", keepUntil: NOW - 1 });
  const out = await call(gone.ctx, "sites.backups_list", { siteId: "sit_a" });
  assert.equal(out.database.replacedBytes, undefined);
  assert.deepEqual(gone.drops, ["app_old"]);
});

test("download gives one address per part, for a backup of this site only", async () => {
  const w = world();
  const a = await w.ctx.blobs!.put(new Uint8Array(10), "x", { resource: { type: "site", id: "sit_a" } });
  const b2 = await w.ctx.blobs!.put(new Uint8Array(5), "x", { resource: { type: "site", id: "sit_a" } });
  add(w, { id: "bkp_one", fileId: a.id, at: Date.parse("2026-11-18T10:00:00Z") });
  add(w, { id: "bkp_two", fileId: `${a.id},${b2.id}`, at: Date.parse("2026-11-18T10:00:00Z") });
  const one = await call(w.ctx, "sites.backup_download", { siteId: "sit_a", backupId: "bkp_one" });
  assert.deepEqual(
    one.files.map((f: { name: string; bytes: number }) => [f.name, f.bytes]),
    [["2026-11-18.sql.gz", 10]],
  );
  assert.match(one.files[0].url, /^\/spaces\/.*\/blobs\/blb_/);
  const two = await call(w.ctx, "sites.backup_download", { siteId: "sit_a", backupId: "bkp_two" });
  assert.deepEqual(
    two.files.map((f: { name: string }) => f.name),
    ["2026-11-18.sql.gz.part1", "2026-11-18.sql.gz.part2"],
  );
  assert.match(two.note, /cat/);
  assert.equal(
    await code(call(w.ctx, "sites.backup_download", { siteId: "sit_b", backupId: "bkp_one" })),
    "validation.not_found",
  );
  add(w, { id: "bkp_run", state: "running" });
  assert.equal(
    await code(call(w.ctx, "sites.backup_download", { siteId: "sit_a", backupId: "bkp_run" })),
    "validation.precondition_failed",
  );
});

test("a scheduled backup is marked as the schedule's, and sites with a ready database and no backup for a day are due", async () => {
  const w = world();
  const { backup } = await call(w.ctx, "sites.backup_create", { siteId: "sit_a", scheduled: true });
  assert.equal(backup.by, "schedule");
  await settle();
  w.db.run("DELETE FROM sites_backup");
  assert.deepEqual(dueBackupSites(w.ctx, NOW), [{ siteId: "sit_a", as: "usr_1" }]);
  add(w, { id: "bkp_new", at: NOW - 3_600_000 });
  assert.deepEqual(dueBackupSites(w.ctx, NOW), [], "a backup in the last day is enough");
  add(w, { id: "bkp_fail", state: "failed", at: NOW - 60_000 });
  w.db.run("DELETE FROM sites_backup WHERE id = 'bkp_new'");
  assert.deepEqual(dueBackupSites(w.ctx, NOW), [], "a failure waits an hour before it is tried again");
});
