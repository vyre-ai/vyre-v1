// A deploy's four steps and cancel (handlers/release.ts), on a real database with the runner faked: no Docker. The real builds are the heavy tests (deploy-*.heavy.test.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { configureRoutes } from "../handlers/route.ts";
import { _test } from "../handlers/release.ts";
import { handlers } from "../impl.ts";
import { harness as base } from "../fixtures/world.ts";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "sites",
  "static",
);
const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Fake {
  /** how long the build takes; a cancel ends it at once */
  buildMs?: number;
  failBuild?: boolean;
}

function world(o: Fake = {}) {
  const w = base();
  const db = new DatabaseSync(":memory:");
  for (const f of [
    "0001_sites_core.sql",
    "0002_promote_tables.sql",
    "0003_routes.sql",
    "0004_deploy.sql",
    "0005_deploy_steps.sql",
  ])
    db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const sdb = {
    all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])),
    run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }),
  };
  let clock = Date.now();
  const ctx = { ...w.ctx, db: sdb, now: () => ++clock, call: async () => ({}) };
  const seen = { builds: 0, cut: 0, removed: [] as string[], running: [] as string[] };
  const fake = { ...o };
  const runner = {
    ping: async () => true,
    freeMb: async () => 50_000,
    async build(a: { deploymentId: string; onLine(l: string): void; signal?: AbortSignal }) {
      seen.builds++;
      a.onLine("Step 1/2 : FROM caddy:2-alpine");
      if (fake.buildMs)
        await new Promise<void>((res) => {
          const t = setTimeout(res, fake.buildMs);
          a.signal?.addEventListener(
            "abort",
            () => {
              seen.cut++;
              clearTimeout(t);
              res();
            },
            { once: true },
          );
        });
      if (a.signal?.aborted) return { ok: false as const, reason: "The build was canceled." };
      if (fake.failBuild) {
        a.onLine('npm ERR! Missing script: "build"');
        return { ok: false as const, reason: "The command returned a non-zero code: 1" };
      }
      a.onLine("Successfully built 4be1a09c77d2");
      return { ok: true as const, image: `img-${a.deploymentId}` };
    },
    network: async () => ({ name: "vyre-site-test", subnet: "10.250.0.0/28" }),
    removeNetwork: async () => undefined,
    async run(a: { deploymentId: string }) {
      seen.running.push(`c-${a.deploymentId}`);
      return { containerId: `c-${a.deploymentId}`, name: `vyre-site-${a.deploymentId}` };
    },
    address: async () => "10.250.0.2",
    state: async () => ({ running: true }),
    logs: async () => ["Serving on 3000"],
    remove: async (id: string) => void seen.removed.push(id),
    removeImage: async () => undefined,
    imageExists: async () => true,
    addon: async () => ({ containerId: "addon" }),
    removeAddon: async () => undefined,
    exec: async () => ({ code: 0, out: "" }),
    put: async () => undefined,
  };
  configureRoutes({
    origin: () => ({ origin: "https://space.test", relay: false }),
    probe: async () => ({ answering: true }),
    runner,
    contained: false,
    tmp: os.tmpdir(),
    sitesDomain: () => "sites.test",
    domainOf: () => null,
    hostRoute: async () => undefined,
    take: () => undefined,
  } as never);
  const make = async (name: string): Promise<string> =>
    (await h["sites.create"]!(ctx, { name, source: { path: FIXTURE } })).site.siteId as string;
  return { ctx, sdb, seen, fake, make, done: () => configureRoutes(null) };
}

const states = (steps: Array<{ key: string; state: string }>): string =>
  steps.map((s) => `${s.key}:${s.state}`).join(" ");

test("a deploy is four steps, each with how long it took, and its log says where each one's lines begin", async () => {
  const w = world();
  try {
    const siteId = await w.make("Steps");
    const out = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(out.deployment.state, "ready");
    assert.equal(states(out.deployment.steps), "fetch:ok build:ok start:ok check:ok");
    for (const s of out.deployment.steps) assert.equal(typeof s.ms, "number", `${s.key} has its time`);
    const log = await h["sites.logs"]!(w.ctx, { siteId, build: true, tail: 400 });
    const at = Object.fromEntries(log.steps.map((s: { key: string; from: number }) => [s.key, s.from]));
    assert.match(log.lines[at.fetch], /^==> Copying /);
    assert.equal(log.lines[at.build], "==> Building");
    assert.match(log.lines[at.start], /^==> Starting it with /);
    assert.ok(at.fetch < at.build && at.build < at.start && at.start <= at.check, JSON.stringify(at));
    // a short tail still points inside what it returns
    const short = await h["sites.logs"]!(w.ctx, { siteId, build: true, tail: 2 });
    assert.equal(short.lines.length, 2);
    for (const s of short.steps) assert.ok(s.from >= 0 && s.from <= 2, `${s.key} from ${s.from}`);
    // the list and the site carry the same steps
    const list = await h["sites.deployments"]!(w.ctx, { siteId });
    assert.equal(states(list.deployments[0].steps), "fetch:ok build:ok start:ok check:ok");
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(states(site.lastDeploy.steps), "fetch:ok build:ok start:ok check:ok");
  } finally {
    w.done();
  }
});

test("a build that fails: the build step failed, and start and check never ran", async () => {
  const w = world({ failBuild: true });
  try {
    const siteId = await w.make("Broken");
    const out = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(out.deployment.state, "failed");
    assert.equal(states(out.deployment.steps), "fetch:ok build:failed start:skipped check:skipped");
    assert.equal(w.seen.running.length, 0, "nothing was started");
  } finally {
    w.done();
  }
});

test("cancel cuts the build off: the deploy is stopped, says Canceled, and the last good build keeps serving", async () => {
  const w = world();
  try {
    const siteId = await w.make("Cancel me");
    const first = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(first.deployment.state, "ready");
    w.fake.buildMs = 30_000;
    const second = await h["sites.deploy"]!(w.ctx, { siteId });
    assert.ok(second.deployment.state === "queued" || second.deployment.state === "building");
    // wait until the build is running, then cancel it
    for (let i = 0; i < 200 && w.seen.builds < 2; i++) await new Promise((res) => setTimeout(res, 10));
    assert.equal(w.seen.builds, 2, "the second build began");
    const started = Date.now();
    const out = await h["sites.deploy_cancel"]!(w.ctx, { siteId });
    assert.ok(Date.now() - started < 5_000, "cancel answers at once, not after the build");
    assert.equal(w.seen.cut, 1, "the build was cut off");
    assert.equal(out.deployment.deploymentId, second.deployment.deploymentId);
    assert.equal(out.deployment.state, "stopped");
    assert.equal(out.deployment.problem, "Canceled.");
    assert.equal(out.deployment.fix, "retry");
    assert.equal(states(out.deployment.steps), "fetch:ok build:failed start:skipped check:skipped");
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(site.live, true, "the site still serves");
    const list = await h["sites.deployments"]!(w.ctx, { siteId });
    assert.equal(
      list.deployments.find((d: { current: boolean }) => d.current).deploymentId,
      first.deployment.deploymentId,
    );
    assert.deepEqual(w.seen.removed, [], "the serving container was not touched");
    await assert.rejects(() => h["sites.deploy_cancel"]!(w.ctx, { siteId }), /No deploy is running/);
    // the next deploy goes ahead
    w.fake.buildMs = 0;
    const third = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(third.deployment.state, "ready");
    assert.equal(third.deployment.current, true);
  } finally {
    w.done();
  }
});

test("a deploy the server restarted in: its steps are closed, and cancel puts it away", async () => {
  const w = world();
  try {
    const siteId = await w.make("Cut off");
    w.sdb.run(
      "INSERT INTO sites_deployment (id, site_id, env, state, log, created_by, at, updated_at, merge_pending, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "dpl_cutoff",
      siteId,
      "production",
      "building",
      JSON.stringify(["==> Copying /srv/app", "==> Building", "Step 1/2 : FROM node"]),
      "usr_owner",
      1,
      1,
      0,
      JSON.stringify({
        d: 0,
        s: [
          { k: "fetch", s: "ok", at: 1, ms: 900, line: 0 },
          { k: "build", s: "running", at: 2, line: 1 },
          { k: "start", s: "waiting" },
          { k: "check", s: "waiting" },
        ],
      }),
    );
    const list = await h["sites.deployments"]!(w.ctx, { siteId });
    assert.equal(list.deployments[0].state, "failed");
    assert.match(list.deployments[0].problem, /restarted/);
    assert.equal(states(list.deployments[0].steps), "fetch:ok build:failed start:skipped check:skipped");
    const log = await h["sites.logs"]!(w.ctx, { siteId, deploymentId: "dpl_cutoff" });
    assert.equal(log.state, "failed");
    assert.equal(log.steps[1].from, 1);
    const out = await h["sites.deploy_cancel"]!(w.ctx, { siteId, deploymentId: "dpl_cutoff" });
    assert.equal(out.deployment.state, "stopped");
    assert.equal(states(out.deployment.steps), "fetch:ok build:failed start:skipped check:skipped");
  } finally {
    w.done();
  }
});

test("the kept log: the count of lines left out adds up, and a step still points at its first kept line", () => {
  const writes: unknown[][] = [];
  const db = { all: () => [], run: (_sql: string, ...a: unknown[]) => (writes.push(a), { changes: 1 }) };
  const log = new _test.DeployLog(db as never, "dpl_x", { steps: true });
  log.begin("fetch");
  for (let i = 0; i < 10; i++) log.add(`fetch ${i}`);
  log.begin("build");
  for (let i = 0; i < 3200; i++) log.add(`build ${i}`);
  log.close();
  const last = writes[writes.length - 1] as [string, string];
  const lines = JSON.parse(last[0]) as string[];
  const meta = JSON.parse(last[1]) as { d: number; s: Array<{ k: string; line?: number; s: string }> };
  assert.equal(lines[0], "... 210 earlier lines left out");
  assert.equal(lines.length, 3001);
  assert.equal(meta.d, 210);
  assert.equal(meta.s[1]?.line, 10);
  const shown = _test.stepsIn(meta as never, lines.length, lines.length) as Array<{ key: string; from: number }>;
  // both began in what was left out: they point at the first line that is still there
  assert.equal(shown[0]?.from, 1);
  assert.equal(shown[1]?.from, 1);
  assert.equal(lines[1], "build 200");
  // more lines after a second trim: the count is the whole number left out, not the last trim's
  const again = new _test.DeployLog(db as never, "dpl_x", { lines, meta: meta as never });
  for (let i = 0; i < 5; i++) again.add(`late ${i}`);
  again.close();
  const next = JSON.parse((writes[writes.length - 1] as [string])[0]) as string[];
  assert.equal(next[0], "... 215 earlier lines left out");
  assert.equal(next[next.length - 1], "late 4");
});
