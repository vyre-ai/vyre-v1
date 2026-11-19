// Deleting a site takes its workers, runs, backups and logs with it (r42-sites-run).
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { cleanupOps } from "../handlers/ops-cleanup.ts";
import { configureRoutes } from "../handlers/route.ts";
import * as st from "../ops/store.ts";

test("a site's workers, running jobs, backup files and rows go; another site's stay", async () => {
  const raw = new DatabaseSync(":memory:");
  for (const f of ["0010_ops.sql", "0011_ops_runs.sql"])
    raw.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  const removed: string[] = [];
  configureRoutes({ runner: { remove: async (c: string) => void removed.push(c) } } as never);
  const blobs: string[] = ["blb_a", "blb_b"];
  const ctx = {
    db,
    blobs: { delete: async (id: string) => blobs.splice(blobs.indexOf(id), 1).length > 0 },
  } as unknown as Ctx;
  st.insertService(db, { id: "w1", siteId: "s1", name: "q", kind: "worker", command: ["x"], at: 1 });
  st.saveService(
    db,
    { id: "w1", siteId: "s1", name: "q", kind: "worker", state: "running", streak: 0, crashes: [] },
    "ctr_w",
  );
  st.insertService(db, { id: "w2", siteId: "s2", name: "q", kind: "worker", command: ["x"], at: 1 });
  st.insertRun(db, "s1", { id: "r1", jobId: "j1", state: "queued", slot: 1, by: "person", queuedAt: 1 });
  st.saveRun(
    db,
    { id: "r1", jobId: "j1", state: "running", slot: 1, by: "person", queuedAt: 1, startedAt: 2 },
    "queued",
    "ctr_j",
  );
  st.insertBackup(db, {
    id: "b1",
    siteId: "s1",
    kind: "postgres",
    state: "ready",
    by: "person",
    at: 1,
    fileId: "blb_a",
  });
  st.insertBackup(db, {
    id: "b2",
    siteId: "s2",
    kind: "postgres",
    state: "ready",
    by: "person",
    at: 1,
    fileId: "blb_b",
  });
  st.addLogs(db, "s1", "x", "app", [{ at: 1, text: "mine" }]);
  st.addLogs(db, "s2", "x", "app", [{ at: 1, text: "theirs" }]);
  await cleanupOps(ctx, "s1");
  assert.deepEqual(removed.sort(), ["ctr_j", "ctr_w"]);
  assert.deepEqual(blobs, ["blb_b"]);
  assert.equal(st.listServices(db, "s1").length, 0);
  assert.equal(st.listBackups(db, "s1").length, 0);
  assert.equal(st.readLogs(db, "s1").lines.length, 0);
  assert.equal(st.listServices(db, "s2").length, 1);
  assert.equal(st.listBackups(db, "s2").length, 1);
  assert.equal(st.readLogs(db, "s2").lines.length, 1);
});
