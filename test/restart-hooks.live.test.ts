// What the hook runner does in a real daemon stop (host/src/daemon/daemon.ts stop, host/src/daemon/consumers.ts close).
//   close first  an event committed after the stop has begun is handed to no consumer while the services close; the next start hands it over once.
//   bounded      a consumer that hangs does not hold the stop: stop returns within the bound; what it wrote before stays (no transaction around ctx.db), what it writes after is refused (the
//                databases are closed), and the next start runs it again on the same event, once.
// A booted daemon whose module hooks are replaced by two test consumers (the access module's are kept, as the daemon always keeps them).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, seededDir, waitFor } from "./memory-live-kit.ts";
import { HOOKS_STOP_MS } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { ModuleHooks } from "../host/src/daemon/consumers.ts";
import type { Ctx } from "../packages/contracts/src/ctx.ts";

const append = (d: Daemon, type: string, n: number) => d.log!.append({ type, sv: 1, trace_id: "ab".repeat(16), actor: "svc_host", vis: "space", payload: { n } });
const settle = async (d: Daemon): Promise<void> => { for (let i = 0; i < 3; i++) await d.hooks!.pump(); };

test("an event committed while the server stops is handed to no consumer during the stop, and to it once after the restart", { timeout: 120_000 }, async () => {
  const phase = { now: "running" as "running" | "stopping" | "stopped" | "restarted" };
  const got: Array<{ n: unknown; phase: string }> = [];
  const hooks: ModuleHooks[] = [{ module: "notifications", periodic: [], consumers: [{ name: "test.late", module: "notifications", on: ["test.late"], run: (_c: Ctx, ev) => { got.push({ n: ev.payload["n"], phase: phase.now }); } }] }];
  const dir = seededDir();
  let d = await boot(dir, undefined, undefined, { hooks });
  try {
    await append(d, "test.late", 1);
    await settle(d);
    assert.deepEqual(got, [{ n: 1, phase: "running" }]);
    // the stop begins; an event commits right after (as a closer's or an ending turn's would) and a commit pumps the hooks
    phase.now = "stopping";
    const stopped = d.stop();
    await append(d, "test.late", 2);
    void d.hooks!.pump();
    await stopped;
    phase.now = "stopped";
    assert.deepEqual(got.filter((g) => g.n === 2), [], "nothing was handed over during the stop");
    phase.now = "restarted";   // the next start hands it over while it boots (its end-of-boot pass) or right after
    d = await boot(dir, undefined, undefined, { hooks });
    await settle(d);
    await waitFor(async () => (got.some((g) => g.n === 2) ? true : null), 10_000);
    await settle(d);
    assert.deepEqual(got.filter((g) => g.n === 2), [{ n: 2, phase: "restarted" }], "handed over once, after the restart");
    assert.equal(got.filter((g) => g.n === 1).length, 1, "the event from before the stop is not handed over again");
  } finally { await d.stop(); }
});

test("a consumer that hangs does not hold the stop: stop returns within the bound, the write it made before stays, the write it makes after is refused, and the next start runs it again on the same event once", { timeout: 120_000 }, async () => {
  let hang = true;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const runs: Array<{ n: unknown; after: boolean }> = [];
  let lateWrite: string | null = null;
  const hooks: ModuleHooks[] = [{
    module: "notifications", periodic: [],
    consumers: [{
      name: "test.hang", module: "notifications", on: ["test.hang"],
      run: async (ctx: Ctx, ev) => {
        runs.push({ n: ev.payload["n"], after: !hang });
        if (!hang) return;
        ctx.db.run("INSERT INTO notifications_backstops (key, at) VALUES (?, ?)", "before-the-stop", 1);   // committed at once: there is no transaction around ctx.db
        await held;
        try { ctx.db.run("INSERT INTO notifications_backstops (key, at) VALUES (?, ?)", "after-the-stop", 2); lateWrite = "ran"; } catch (e) { lateWrite = `refused: ${e instanceof Error ? e.message : String(e)}`; }
      },
    }],
  }];
  const dir = seededDir();
  let d = await boot(dir, undefined, undefined, { hooks });
  try {
    await append(d, "test.hang", 7);
    void d.hooks!.pump();
    await waitFor(async () => (runs.length === 1 ? true : null), 10_000);
    const t0 = Date.now();
    await d.stop();
    const took = Date.now() - t0;
    // the bound, plus what the rest of the stop takes on a loaded runner (the engine closer alone may wait 10 s for its turns)
    assert.ok(took < HOOKS_STOP_MS + 15_000, `the stop returned in ${took} ms, not held by the hanging consumer`);
    release();
    await waitFor(async () => (lateWrite !== null ? true : null), 5_000);
    assert.match(String(lateWrite), /^refused/, "a write after the databases closed is refused");
    // what the let-go consumer did before the stop is not undone: its first write stayed, its second never landed (so a consumer must be safe to run twice on one event)
    const kept = new DatabaseSync(d.paths.modules, { readOnly: true }).prepare("SELECT key FROM notifications_backstops ORDER BY key").all() as Array<{ key: string }>;
    assert.deepEqual(kept.map((r) => r.key), ["before-the-stop"]);
    hang = false;
    d = await boot(dir, undefined, undefined, { hooks });
    await settle(d);
    await waitFor(async () => (runs.some((r) => r.after) ? true : null), 10_000);
    await settle(d);
    assert.deepEqual(runs.filter((r) => r.after), [{ n: 7, after: true }], "the same event, handed over again once at the next start");
  } finally { release(); await d.stop(); }
});
