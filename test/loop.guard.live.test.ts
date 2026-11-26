// The event-loop guard on a Meier-sized Space (24 Nov 2026, the Mac-hosted freeze): the main thread must never be held for more than 100 ms, by a job, a hook, a pump, an access-view build or a request. A Space of
// 28,000 contacts, 9,400 matters (100 fields) and 1,100 organizations with twenty projects is started, then driven through its start-up, a set of everyday requests, and two 10-minute scheduler ticks on an
// accelerated clock while the same requests go on. Every block over the bound is named: the jobs and requests in flight in that interval and the SQL statements that took long in it. The report is
// written to $VYRE_TEST_CAPTURE_DIR/loop-guard/report.txt either way; the test fails when there is any block.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./support/sync-live.ts";
import { boot, call, stop } from "./support/eco-live.ts";
import { seed, FIRM } from "./support/bigspace-kit.ts";
import { startGuard } from "./support/loop-guard-kit.ts";
import type { Guard } from "./support/loop-guard-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { syncCounts, readCounts } from "../modules/access/consumers.ts";
import { AccessStore } from "../modules/access/projections.ts";

const BOUND_MS = Number(process.env["LOOP_BOUND_MS"] ?? 100);
const SCALE = Number(process.env["LOOP_SCALE"] ?? 1);
const TICK_MS = 600_000;

/** What a person does all day, one request each, timed as spans by the guard. */
async function everyday(d: Daemon, g: Guard, ctx: { contact: string; project: string; role: string }, round: number): Promise<void> {
  const r = (name: string, cap: string, input: unknown) =>
    g.request(name, async () => {
      const out = await call(d, cap, input);
      if (out.status >= 500) throw new Error(`${name}: ${out.status} ${JSON.stringify(out.data).slice(0, 200)}`);
      return out;
    });
  await r("list records", "records.query", { type: "contact", limit: 50 });
  await r("open a record", "records.get", { type: "contact", recordId: ctx.contact });
  await r("search", "search.query", { q: "Person 777" });
  await r("edit a field", "records.update", { type: "contact", recordId: ctx.contact, patch: { name: `Person edited ${round}` } });
  await r("create a record", "records.create", { type: "contact", fields: { name: `New ${round}`, email: `new${round}@x.test` }, idempotencyKey: `guard-create-${round}` });
  await r("grant change", "access.share", {
    resource: { type: "record", id: ctx.contact },
    subject: { kind: "role", id: ctx.role },
    level: "view",
    idempotencyKey: `guard-share-${round}`,
  });
  await r("open a project", "projects.get", { projectId: ctx.project });
}

test(
  "the main thread is never held over the bound on a Meier-sized Space: start-up, everyday requests and two 10-minute ticks",
  { timeout: 1_500_000 },
  async () => {
    const w = await world(true);
    const dir = w.dir;
    let d: Daemon = w.d;
    try {
      // 1. the Space: the seed through the real path (the group commit), then twenty projects
      await seed(
        d,
        { matters: Math.round(FIRM.matters * SCALE), fields: FIRM.fields, contacts: Math.round(FIRM.contacts * SCALE), orgs: Math.round(FIRM.orgs * SCALE) },
        (m) => process.stderr.write(`[guard] ${m}\n`),
      );
      let projectId = "";
      for (let i = 0; i < 20; i++) {
        const p = await call(d, "projects.create", { type: "project", title: `Client file ${i}`, idempotencyKey: `guard-project-${i}` });
        if (p.status === 200 && !projectId) projectId = String(p.data.project?.id ?? p.data.projectId ?? p.data.id ?? "");
      }
      const first = await call(d, "records.query", { type: "contact", limit: 1 });
      const contact = String(first.data.rows[0].id);
      const roles = (await call(d, "access.roles.list", {})).data.roles as { id: string; name: string }[];
      const role = roles.find((x) => x.name === "Member")?.id ?? roles[0]!.id;
      await w.close();

      // 2. start-up on that data: the guard is running before the daemon starts
      let clock = Date.now();
      let counters = "";
      // who hydrates the access store: every full read of the access tables, grouped by the frames that asked
      const hydrators = new Map<string, number>();
      const proto = AccessStore.prototype as unknown as { hydrate: (...a: unknown[]) => unknown };
      const hydrateWas = proto.hydrate;
      proto.hydrate = function (this: unknown, ...a: unknown[]) {
        const frames = (new Error().stack ?? "").split("\n").slice(2, 9).map((f) => f.trim().replace(/^at /, "").replace(/\(?file:\/\/\/[^)]*\/(modules|host)\//, "(").slice(0, 90));
        const key = frames.filter((f) => !/projections\.ts/.test(f)).slice(0, 3).join(" < ");
        hydrators.set(key, (hydrators.get(key) ?? 0) + 1);
        return hydrateWas.apply(this, a);
      };
      const g = startGuard(BOUND_MS);
      g.phase("start-up");
      try {
        d = await boot(dir, (async function* () {})() as never, { vault: undefined, now: () => clock });
        g.wrapJobs(d);
        const counts: string[] = [];
        const snap = (label: string): void => void counts.push(`${label}: access.sync hydrated ${syncCounts.hydrated} (cold ${syncCounts.cold}, counter moved ${syncCounts.moved}, sliced ${syncCounts.sliced}, no roles ${syncCounts.empty}), rebuilt ${syncCounts.rebuilt}, in place ${syncCounts.inPlace}, read views ${readCounts.views}`);
        await d.startupWork();
        await new Promise((ok) => setTimeout(ok, 5_000));
        snap("after start-up");
        const ctx = { contact, project: projectId, role };
        snap("after 5 s");
        // 3. everyday requests alone
        g.phase("requests");
        for (let round = 0; round < 3; round++) await everyday(d, g, ctx, round);
        // 4. two 10-minute ticks, with the requests going on while the jobs run
        for (const k of [1, 2]) {
          g.phase(`tick ${k}`);
          clock += TICK_MS + 61_000; // the staggered jobs (up to 60 s after their boundary) are all due
          const tick = d.scheduler.tick();
          const requests = (async () => {
            for (let round = 10 * k; round < 10 * k + 3; round++) await everyday(d, g, ctx, round);
          })();
          await Promise.all([tick, requests]);
          // the jobs the tick started that are still running (a job never overlaps itself) are waited for
          const until = Date.now() + 180_000;
          while (d.scheduler.runningNames().length && Date.now() < until) await new Promise((ok) => setTimeout(ok, 200));
        }
        snap("after the ticks");
        counters = `${counts.join("\n")}\nhydrated by:\n${[...hydrators.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}x ${k}`).join("\n")}`;
      } finally {
        g.stop();
        proto.hydrate = hydrateWas;
      }
      const out = process.env["VYRE_TEST_CAPTURE_DIR"] ?? path.join(dir, "capture");
      fs.mkdirSync(`${out}/loop-guard`, { recursive: true });
      const text = `${counters}\nbound ${BOUND_MS} ms; ${g.blocks.length} blocks\nworst: ${g
        .worst()
        .slice(0, 12)
        .map((x) => `${x.name} ${x.ms} ms`)
        .join(", ")}\n${g.report()}\n`;
      fs.writeFileSync(`${out}/loop-guard/report.txt`, text);
      fs.writeFileSync(`${out}/loop-guard/t0.txt`, String(g.t0));
      process.stderr.write(`[guard] ${text}`);
      assert.equal(g.blocks.length, 0, text.slice(0, 6000));
    } finally {
      await stop(d);
    }
  },
);
