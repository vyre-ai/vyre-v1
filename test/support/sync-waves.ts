// A firm's synced types start their passes together (18 Nov 2026, the live firm: a burst of about 30 vault.fill and 24 connectors.read in 10 s, a 1.3 s stall every ten minutes, and 30% of
// the app's reads answered rate_limit.exceeded). Five types of one connection, the connection's own budget a few calls a second: the first pulls start at once, then every type is due at
// once. Measured: the longest block of the loop, the reads Vyre refused for its own budget, and the Vault reads.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { call, hostLog, waitFor } from "./eco-live.ts";
import { pump, spec, world } from "./sync-live.ts";

export const BUDGET_MS = 200;

function watchLoop(): { stop(): { maxMs: number; over: number } } {
  let last = performance.now();
  let max = 0;
  let over = 0;
  const t = setInterval(() => {
    const at = performance.now();
    const lag = at - last - 10;
    last = at;
    if (lag > max) max = lag;
    if (lag > BUDGET_MS) over++;
  }, 10);
  return {
    stop: () => {
      clearInterval(t);
      return { maxMs: Math.round(max), over };
    },
  };
}

const counts = (d: { sink: { flush(): void }; paths: { logs: string } }, after: number) => {
  d.sink.flush();
  const ro = new DatabaseSync(d.paths.logs, { readOnly: true });
  try {
    const rows = ro
      .prepare("SELECT cap, result, msg FROM logs WHERE id > ? AND (cap LIKE 'connectors.%' OR cap = 'vault.fill')")
      .all(after) as Array<{ cap: string; result: string; msg: string | null }>;
    return {
      reads: rows.filter((r) => r.cap === "connectors.read").length,
      refused: rows.filter((r) => r.cap === "connectors.read" && /rate_limit/.test(`${r.result} ${r.msg ?? ""}`))
        .length,
      fills: rows.filter((r) => r.cap === "vault.fill").length,
    };
  } finally {
    ro.close();
  }
};
const lastLogId = (d: { sink: { flush(): void }; paths: { logs: string } }): number => {
  d.sink.flush();
  const ro = new DatabaseSync(d.paths.logs, { readOnly: true });
  try {
    return (ro.prepare("SELECT coalesce(max(id), 0) AS n FROM logs").get() as { n: number }).n;
  } finally {
    ro.close();
  }
};
const makeDue = (dir: string): void => {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".db"))) {
    const db = new DatabaseSync(path.join(dir, f));
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      for (const sql of [
        "DELETE FROM cn_sync_poll",
        "DELETE FROM cn_sync_running",
        `UPDATE cn_synced_types SET polling = '{"activeSec":1,"idleSec":1,"dormantSec":1}'`,
        "DELETE FROM host_schedule WHERE cap = 'connectors.sync_poll'",
        // every type has waited out its one-second interval: its last pass, its guard and its creation are 5 s older (no row lies between the old and the new stamp: the mock rows are stamped 1000, so the passes read the same rows)
        "UPDATE sy_state SET last_run_at = last_run_at - 5000 WHERE last_run_at IS NOT NULL",
        "UPDATE cn_sync_guard SET last_at = last_at - 5000 WHERE last_at IS NOT NULL",
        "UPDATE cn_synced_types SET created_at = created_at - 5000",
      ])
        try {
          db.exec(sql);
        } catch {
          /* the table is in another file */
        }
    } finally {
      db.close();
    }
  }
};

/** Passes running now, over every database file of the Space (the mark the cadence keeps per connection). */
const running = (dir: string): number => {
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".db"))) {
    const db = new DatabaseSync(path.join(dir, f));
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      n += (db.prepare("SELECT count(*) AS n FROM cn_sync_running").get() as { n: number }).n;
    } catch {
      /* the table is in another file */
    } finally {
      db.close();
    }
  }
  return n;
};

export interface WaveResult {
  pull: { reads: number; refused: number; fills: number; maxMs: number; over: number; seconds: number };
  due: { reads: number; refused: number; fills: number; maxMs: number; over: number; seconds: number };
}

/** Five types of one connection, \`big\` records in each of four: the first pulls start together, then every type is due at once. */
export async function waves(big: number): Promise<WaveResult> {
  const TYPES: Record<string, number> = { person: big + 2, matter: big, contact: big, company: big, note: 5 };
  const w = await world(
    true,
    { bulk: big, big },
    { session: () => ({ space: CORE_SPACE, principal: { kind: "person", id: "usr_olivia" }, device: "fixture" }) },
  );
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const s = spec() as ReturnType<typeof spec> & { plan?: Record<string, unknown> };
    for (const o of s.objects) o.list.cursor.size = 50;
    s.plan = { ...(s.plan ?? {}), requestsPerMinute: 240 };
    const first = lastLogId(w.d);
    const watch = watchLoop();
    const t0 = performance.now();
    const applied = await call(w.d, "sync_specs.apply", { spec: s, idempotencyKey: "apply-waves" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await waitFor(
      async () => {
        await pump(w.d);
        for (const [type, total] of Object.entries(TYPES)) {
          const st = (await call(w.d, "sync_types.status", { type })).data;
          if (!(st.records >= total && !st.catchingUp)) return null;
        }
        return true;
      },
      170_000,
      () => hostLog(w.d),
    );
    const pull = { ...counts(w.d, first), ...watch.stop(), seconds: Math.round((performance.now() - t0) / 100) / 10 };
    makeDue(w.dir);
    const second = lastLogId(w.d);
    const watch2 = watchLoop();
    const t1 = performance.now();
    // a tick starts at most two passes (one per connection): tick until five reads of the due wave are in (one per type at least, as the five types are due together), each tick after the last pass ended (the
    // wait is on the connection's running mark, not on a clock). One deadline for the wave, so a pass that never finishes is named. Every type having its OWN pass here would make five full passes (8 to 9
    // Vault reads, 25 s wall): the Vault bound below is for a wave that is cut at five reads.
    const deadline = performance.now() + 25_000;
    while (counts(w.d, second).reads < Object.keys(TYPES).length) {
      assert.ok(
        performance.now() < deadline,
        `a pass never finished: ${counts(w.d, second).reads} reads after 25 s, ${running(w.dir)} still running`,
      );
      await w.d.hooks!.runPeriodic("connectors.cadence");
      await pump(w.d);
      for (let i = 0; i < 500 && running(w.dir) > 0; i++) await new Promise((r) => setTimeout(r, 20));
    }
    await pump(w.d);
    const due = { ...counts(w.d, second), ...watch2.stop(), seconds: Math.round((performance.now() - t1) / 100) / 10 };
    for (const type of Object.keys(TYPES)) {
      const st = (await call(w.d, "sync_types.status", { type })).data;
      assert.deepEqual(st.failures ?? [], [], `${type}: no failure ${JSON.stringify(st.failures)}`);
    }
    return { pull, due };
  } finally {
    await w.close();
  }
}
