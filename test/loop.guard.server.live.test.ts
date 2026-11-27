// The event-loop guard on the real server (27 Nov 2026): the same Meier-sized Space and the same bound as test/loop.guard.live.test.ts, but the server under measurement is vyred started through
// host/src/daemon/main.ts as a CHILD process, as an installer starts it, and its loop is watched from inside it from the very start of the process (host/src/daemon/loop-monitor.ts, switched on by
// VYRE_LOOP_MONITOR). The seed is made in this process, which is not measured. Two variants, each on its own copy of the seeded Space: COLD (no compile cache: the first start after an update) and WARM (the
// cache filled by an earlier start: every start after it). The window is the whole life of the child: boot, everyday requests, two 10-minute ticks (the child's clock is moved by SIGUSR2). Every block over the
// bound is listed with its phase; the report is written to $VYRE_TEST_CAPTURE_DIR/loop-guard-server/report-<variant>.txt either way, and the test fails when there is any block.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { world } from "./support/sync-live.ts";
import { call as inProcessCall } from "./support/eco-live.ts";
import { seed, FIRM } from "./support/bigspace-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BOUND_MS = Number(process.env["LOOP_BOUND_MS"] ?? 100);
const SCALE = Number(process.env["LOOP_SCALE"] ?? 1);
const TOKEN = "loop-guard-admin-token";

interface Server {
  url: string;
  child: ChildProcess;
  out: () => string;
  exited: Promise<number | null>;
  stop(): Promise<void>;
}
/** vyred through main.ts, in a child process, on a copy of the seeded data directory. */
async function start(dir: string, report: string | null): Promise<Server> {
  let out = "";
  const prof = process.env["GUARD_CPU_PROF"] && report ? [`--cpu-prof`, `--cpu-prof-dir=${process.env["GUARD_CPU_PROF"]}`, `--cpu-prof-interval=1000`] : [];
  const child = spawn(process.execPath, [...prof, "host/src/daemon/main.ts", "--role", "space", "--data-dir", dir, "--port", "0"], {
    cwd: ROOT,
    env: { ...process.env, VYRE_ADMIN_TOKEN: TOKEN, ...(report ? { VYRE_LOOP_MONITOR: report, VYRE_LOOP_BOUND_MS: String(BOUND_MS) } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr?.on("data", (b: Buffer) => (out += b.toString()));
  const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start within 120 s: ${out.slice(-2000)}`)), 120_000);
    const poll = setInterval(() => {
      const m = /listening on (http\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve(m[1]!);
      }
    }, 50);
    void exited.then((c) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(new Error(`the server exited ${String(c)} before it listened: ${out.slice(-2000)}`));
    });
  });
  return {
    url,
    child,
    out: () => out,
    exited,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 60_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}
const asDaemon = (s: Server): Daemon => ({ url: s.url, token: TOKEN }) as unknown as Daemon;

async function everyday(s: Server, ctx: { contact: string; project: string; role: string }, round: number): Promise<void> {
  const d = asDaemon(s);
  const r = async (name: string, cap: string, input: unknown): Promise<void> => {
    const out = await inProcessCall(d, cap, input);
    if (out.status >= 500) throw new Error(`${name}: ${out.status} ${JSON.stringify(out.data).slice(0, 200)}`);
  };
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

const ticked = (s: Server, from: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const until = Date.now() + 240_000;
    const poll = setInterval(() => {
      if (s.out().split("guard: tick done").length - 1 > from) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() > until) {
        clearInterval(poll);
        reject(new Error("a tick did not finish within 240 s"));
      }
    }, 100);
  });

const seededDirs: { dir: string; ctx: { contact: string; project: string; role: string } }[] = [];

test(
  "the real server (vyred through main.ts, in a child process) never holds its loop over the bound on a Meier-sized Space: cold compile cache and warm, from the first instant of the process to the end of two ticks",
  { timeout: 1_700_000 },
  async () => {
    // 1. the Space, seeded in this process (not measured): the seed through the real path, twenty projects
    const w = await world(true);
    let ctx = { contact: "", project: "", role: "" };
    try {
      const d = w.d;
      await seed(
        d,
        { matters: Math.round(FIRM.matters * SCALE), fields: FIRM.fields, contacts: Math.round(FIRM.contacts * SCALE), orgs: Math.round(FIRM.orgs * SCALE) },
        (m) => process.stderr.write(`[guard] ${m}\n`),
      );
      let projectId = "";
      for (let i = 0; i < 20; i++) {
        const p = await inProcessCall(d, "projects.create", { type: "project", title: `Client file ${i}`, idempotencyKey: `guard-project-${i}` });
        if (p.status === 200 && !projectId) projectId = String(p.data.project?.id ?? p.data.projectId ?? p.data.id ?? "");
      }
      const first = await inProcessCall(d, "records.query", { type: "contact", limit: 1 });
      const roles = (await inProcessCall(d, "access.roles.list", {})).data.roles as { id: string; name: string }[];
      ctx = {
        contact: String(first.data.rows[0].id),
        project: projectId,
        role: roles.find((x) => x.name === "Member")?.id ?? roles[0]!.id,
      };
    } finally {
      await w.close();
    }
    seededDirs.push({ dir: w.dir, ctx });
    const out = process.env["VYRE_TEST_CAPTURE_DIR"] ?? path.join(w.dir, "capture");
    fs.mkdirSync(`${out}/loop-guard-server`, { recursive: true });

    const failures: string[] = [];
    for (const variant of ["cold", "warm"] as const) {
      // 2. each variant starts from its own copy of the seeded Space, with no compile cache of any earlier start
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-guard-${variant}-`));
      execFileSync("cp", ["-a", `${w.dir}/.`, dir]);
      fs.rmSync(path.join(dir, "compile-cache"), { recursive: true, force: true });
      if (variant === "warm") {
        // the start that fills the cache (its warm-up ends before the measured start): no monitor, then stopped
        const fill = await start(dir, null);
        const until = Date.now() + 120_000;
        const cacheDir = path.join(dir, "compile-cache");
        const filled = (): boolean => {
          try {
            return fs.readdirSync(cacheDir).some((v) => fs.readdirSync(path.join(cacheDir, v)).some((f) => f !== ".warming") && !fs.existsSync(path.join(cacheDir, v, ".warming")));
          } catch {
            return false;
          }
        };
        while (!filled() && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
        await fill.stop();
        assert.ok(filled(), "the first start filled the compile cache");
      }
      // 3. the measured start: the monitor runs inside the child from its first instant
      const report = path.join(dir, "loop-monitor.json");
      const spawnedAt = Date.now();
      const s = await start(dir, report);
      const listenedWall = Date.now();
      const phases: { name: string; from: number; to: number }[] = [{ name: "boot", from: spawnedAt, to: listenedWall }];
      const phase = async (name: string, run: () => Promise<void>): Promise<void> => {
        const from = Date.now();
        await run();
        phases.push({ name, from, to: Date.now() });
      };
      try {
        await phase("start-up", async () => void (await new Promise((r) => setTimeout(r, 5_000))));
        await phase("requests", async () => {
          for (let round = 0; round < 3; round++) await everyday(s, ctx, round);
        });
        for (const k of [1, 2]) {
          await phase(`tick ${k}`, async () => {
            const seen = s.out().split("guard: tick done").length - 1;
            s.child.kill("SIGUSR2");
            const requests = (async () => {
              for (let round = 10 * k; round < 10 * k + 3; round++) await everyday(s, ctx, round);
            })();
            await Promise.all([ticked(s, seen), requests]);
          });
        }
      } finally {
        await s.stop();
      }
      // 4. what the child saw of its own loop
      const seen = JSON.parse(fs.readFileSync(report, "utf8")) as {
        wall0: number;
        bound: number;
        listenedAt: number | null;
        blocks: { at: number; ms: number }[];
      };
      const phaseOf = (wall: number): string => phases.find((p) => wall >= p.from && wall <= p.to)?.name ?? "after";
      const lines = seen.blocks.map((b) => `block ${b.ms} ms at +${(b.at / 1000).toFixed(1)} s [${phaseOf(seen.wall0 + b.at)}${seen.listenedAt !== null && b.at > seen.listenedAt ? ", after listen" : ", before listen"}]`);
      const text = `${variant}: listening at +${seen.listenedAt === null ? "?" : (seen.listenedAt / 1000).toFixed(1)} s (${listenedWall - spawnedAt} ms after the spawn); ${lines.length} blocks before the bound ${seen.bound} ms\n${lines.join("\n")}\n`;
      fs.writeFileSync(`${out}/loop-guard-server/report-${variant}.txt`, text);
      process.stderr.write(`[guard] ${text}`);
      if (lines.length) failures.push(text);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(failures.length, 0, failures.join("\n").slice(0, 6000));
  },
);
