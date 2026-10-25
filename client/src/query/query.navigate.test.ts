// perf navigate over 20 screens (ARCH 9): first paint under 50 ms and at least 90 percent of opens prefetched by hover or focus.
import test from "node:test";
import assert from "node:assert/strict";
import { createNodeDriver } from "../../../sync/src/replica/index.ts";
import { manualScheduler } from "../connection/scheduler.ts";
import { asQuery, createPrefetcher, createQueryClient } from "./index.ts";
import { createChangeFeed, createSpaceStore } from "../store/index.ts";
import { screens } from "../../../generated/screens.ts";

test("navigate: 20 screens open under 50 ms first paint and 90 percent were prefetched", () => {
  const driver = createNodeDriver();
  driver.exec("CREATE TABLE row (id TEXT PRIMARY KEY, title TEXT)");
  const ins = driver.prepare("INSERT INTO row (id, title) VALUES (?, ?)");
  driver.transaction(() => { for (let i = 0; i < 5000; i++) ins.run([`r_${i}`, `Row ${i}`]); });
  const client = createQueryClient(createSpaceStore("spc_perf", driver, createChangeFeed()));

  const chosen = screens.filter((s) => Object.values(s.queries).some((q) => q.live)).slice(0, 20);
  assert.equal(chosen.length, 20, "the generated index has at least 20 screens with a live query");
  const index = new Map(chosen.map((s) => [s.id, s]));
  const defs = new Map<string, ReturnType<typeof asQuery>>();
  for (const s of chosen) for (const q of Object.values(s.queries)) {
    if (q.live) defs.set(q.cap, asQuery<unknown, unknown[]>({ cap: q.cap, entities: ["row"], run: (db) => db.all("SELECT id, title FROM row ORDER BY id LIMIT 200", []) }));
  }
  const sched = manualScheduler();
  const p = createPrefetcher({ client, screens: index, defs, scheduler: sched });

  const paints: number[] = [];
  chosen.forEach((s, i) => {
    if (i % 2 === 0) { p.hover(s.id); sched.advance(60); } else p.focus(s.id);
    paints.push(p.open(s.id).firstPaintMs);
  });
  // one screen opened cold, as from a deep link
  const cold = screens.filter((s) => Object.values(s.queries).some((q) => q.live))[20];
  if (cold) { for (const q of Object.values(cold.queries)) if (q.live && !defs.has(q.cap)) defs.set(q.cap, asQuery<unknown, unknown[]>({ cap: q.cap, entities: ["row"], run: (db) => db.all("SELECT id FROM row LIMIT 200", []) })); index.set(cold.id, cold); paints.push(p.open(cold.id).firstPaintMs); }

  const st = p.stats();
  paints.sort((a, b) => a - b);
  const worst = paints[paints.length - 1] ?? 0;
  assert.ok(st.hitRate >= 0.9, `prefetched ${(st.hitRate * 100).toFixed(0)} percent of opens`);
  assert.ok(worst < 50, `slowest first paint ${worst.toFixed(2)} ms is over 50 ms`);
});
