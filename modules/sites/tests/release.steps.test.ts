// A deploy's four steps and cancel (handlers/release.ts), on a real database with the runner faked: no Docker. The real builds are the heavy tests (deploy-*.heavy.test.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { configureRoutes, routeByHost } from "../handlers/route.ts";
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
    "0006_env_plain.sql",
  ])
    db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const sdb = {
    all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])),
    run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }),
  };
  let clock = Date.now();
  // a call from a handler to another capability goes to that handler (sites_ship composes the others); any other capability answers nothing
  const ctx: any = {
    ...w.ctx,
    db: sdb,
    now: () => ++clock,
    call: async (cap: string, inp: unknown) => (h[cap] ? h[cap]!(ctx, inp) : {}),
  }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const seen = {
    builds: 0,
    cut: 0,
    removed: [] as string[],
    running: [] as string[],
    envs: {} as Record<string, Record<string, string>>,
    images: [] as string[],
    droppedImages: [] as string[],
  };
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
    async run(a: { deploymentId: string; env?: Record<string, string> }) {
      seen.running.push(`c-${a.deploymentId}`);
      seen.envs[a.deploymentId] = a.env ?? {};
      return { containerId: `c-${a.deploymentId}`, name: `vyre-site-${a.deploymentId}` };
    },
    address: async () => "10.250.0.2",
    state: async () => ({ running: true }),
    logs: async () => ["Serving on 3000"],
    remove: async (id: string) => void seen.removed.push(id),
    removeImage: async (i: string) => void seen.droppedImages.push(i),
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
  // a repo site: its source is fetched by a stand-in that returns the static fixture with a commit (a repo cannot be cloned here)
  let n = 0;
  _test.useFetcher((async (s: { branch?: string }) => ({
    dir: FIXTURE,
    commit: `c0ffee${(++n).toString(16).padStart(2, "0")}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    message: `Change ${n}`,
    branch: s.branch ?? "main",
    cleanup: () => undefined,
  })) as never);
  const makeRepo = async (name: string, o: Record<string, unknown> = {}): Promise<string> =>
    (await h["sites.create"]!(ctx, { name, source: { repo: "https://github.com/acme/app.git", branch: "main" }, ...o })).site
      .siteId as string;
  return {
    ctx,
    sdb,
    seen,
    fake,
    make,
    makeRepo,
    done: () => {
      _test.useFetcher(null);
      configureRoutes(null);
    },
  };
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

test("sites_ship: one call creates, deploys and answers with the address", async () => {
  const w = world();
  try {
    const out = await h["sites.ship"]!(w.ctx, { name: "Ship me", source: { path: FIXTURE } });
    assert.equal(out.ok, true, out.say);
    assert.match(out.siteId, /^sit_/);
    assert.equal(out.deployment.state, "ready");
    assert.equal(states(out.deployment.steps), "fetch:ok build:ok start:ok check:ok");
    assert.match(out.say, /^It is live at https:\/\//);
    assert.equal(out.address, (await h["sites.get"]!(w.ctx, { siteId: out.siteId })).site.url);
  } finally {
    w.done();
  }
});

test("sites_ship: a failed build names the step, the reason and the fix, and the same call again goes on with the same site", async () => {
  const w = world({ failBuild: true });
  try {
    const out = await h["sites.ship"]!(w.ctx, { name: "Ship broken", source: { path: FIXTURE } });
    assert.equal(out.ok, false);
    assert.equal(out.failedStep, "build");
    assert.match(out.problem, /./);
    assert.match(out.say, /^It stopped at build: /);
    w.fake.failBuild = false;
    const again = await h["sites.ship"]!(w.ctx, { siteId: out.siteId });
    assert.equal(again.ok, true, again.say);
    assert.equal(again.siteId, out.siteId, "no second site");
    const all = await h["sites.list"]!(w.ctx, {});
    assert.equal(all.sites.filter((s: { name: string }) => s.name === "Ship broken").length, 1);
  } finally {
    w.done();
  }
});

test("sites_ship: no source and no siteId is said in one line; a step before the build that fails keeps the site and says so", async () => {
  const w = world();
  try {
    await assert.rejects(() => h["sites.ship"]!(w.ctx, { name: "No source" }), /where the code is/);
    const bad = await h["sites.ship"]!(w.ctx, {
      name: "Bad env",
      source: { path: FIXTURE },
      env: [{ name: "PORT", vaultHandle: "#Nope" }],
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.failedStep, "setup");
    assert.match(bad.say, /Call sites_ship again with this siteId/);
    assert.match(bad.siteId, /^sit_/);
    assert.equal(w.seen.builds, 0, "nothing was built");
  } finally {
    w.done();
  }
});

test("sites_ship with wait false returns while the deploy runs", async () => {
  const w = world();
  w.fake.buildMs = 2000;
  try {
    const out = await h["sites.ship"]!(w.ctx, { name: "Ship soon", source: { path: FIXTURE }, wait: false });
    assert.equal(out.ok, true);
    assert.match(out.say, /^The deploy has started/);
    assert.ok(["queued", "building"].includes(out.deployment.state));
    await h["sites.deploy_cancel"]!(w.ctx, { siteId: out.siteId });
  } finally {
    w.done();
  }
});

test("env: a plain value and a scope are kept, listed as given, and reach only the deploys they apply to", async () => {
  const w = world();
  try {
    const siteId = await w.make("Plain env");
    await h["sites.env_set"]!(w.ctx, {
      siteId,
      entries: [
        { name: "APP_MODE", value: "calm" },
        { name: "ONLY_PROD", value: "p", scope: "production" },
        { name: "ONLY_PREVIEW", value: "v", scope: "previews" },
      ],
    });
    const list = await h["sites.env_list"]!(w.ctx, { siteId });
    assert.deepEqual(
      list.entries.map((e: { name: string; kind: string; value?: string; scope: string }) => `${e.name}:${e.kind}:${e.value}:${e.scope}`),
      ["APP_MODE:plain:calm:all", "ONLY_PREVIEW:plain:v:previews", "ONLY_PROD:plain:p:production"],
    );
    assert.equal(list.entries[0].vaultName, "");
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d1", "production"), { APP_MODE: "calm", ONLY_PROD: "p" });
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d2", "preview"), { APP_MODE: "calm", ONLY_PREVIEW: "v" });
    // a deploy gets them
    const out = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(out.deployment.state, "ready");
  } finally {
    w.done();
  }
});

test("env: a name takes a Vault key or a plain value, one of the two; bad scopes, reserved names and long values are refused", async () => {
  const w = world();
  try {
    const siteId = await w.make("Bad env");
    const set = (entries: unknown[]) => h["sites.env_set"]!(w.ctx, { siteId, entries });
    await assert.rejects(() => set([{ name: "A" }]), /one of the two/);
    await assert.rejects(() => set([{ name: "A", value: "x", vaultHandle: "#K" }]), /one of the two/);
    await assert.rejects(() => set([{ name: "A", value: "x", scope: "everywhere" }]), /scope is all/);
    await assert.rejects(() => set([{ name: "PORT", value: "1" }]), /set by Vyre/);
    await assert.rejects(() => set([{ name: "A", value: "x".repeat(9000) }]), /over 8 KB/);
    await assert.rejects(() => set([{ name: "A", value: 5 }]), /not text/);
    await assert.rejects(() => set([{ name: "A", value: "1" }, { name: "A", value: "2" }]), /listed twice/);
    // nothing was kept by the refusals
    assert.equal((await h["sites.env_list"]!(w.ctx, { siteId })).entries.length, 0);
    // an empty plain value is a value
    await set([{ name: "EMPTY", value: "" }]);
    assert.equal((await h["sites.env_list"]!(w.ctx, { siteId })).entries[0].kind, "plain");
  } finally {
    w.done();
  }
});

const route = (w: ReturnType<typeof world>, host: string) =>
  routeByHost({ db: w.sdb } as never, host, "sites.test");

test("previewLabel: a branch is an address that is safe, short enough, and never shared by two branches", () => {
  const l = _test.previewLabel;
  assert.equal(l("shop", "next"), "next--shop");
  assert.notEqual(l("shop", "feat/a"), l("shop", "feat-a"));
  assert.match(l("shop", "feat/Login Page!"), /^feat-login-page-[0-9a-f]{6}--shop$/);
  const long = l("a-fairly-long-site-name-here", "feature/".padEnd(120, "x"));
  assert.ok(long.length <= 63, long);
  assert.match(long, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  assert.ok(long.endsWith("--a-fairly-long-site-name-here"));
});

test("a preview builds a branch at its own address behind sign-in, and does not touch what is serving", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Shop", { access: "public" });
    const prod = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(prod.deployment.state, "ready");
    const before = (await h["sites.get"]!(w.ctx, { siteId })).site;
    await h["sites.addon_add"]!(w.ctx, { siteId, kind: "postgres" });
    await h["sites.env_set"]!(w.ctx, {
      siteId,
      entries: [
        { name: "MODE", value: "prod", scope: "production" },
        { name: "MODE_P", value: "preview", scope: "previews" },
        { name: "ALL", value: "x" },
      ],
    });
    const out = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "feat/login", wait: true });
    assert.equal(out.deployment.state, "ready", out.deployment.problem);
    assert.equal(out.deployment.branch, "feat/login");
    assert.match(out.deployment.url, /^https:\/\/feat-login-[0-9a-f]{6}--shop\.sites\.test$/);
    assert.equal(states(out.deployment.steps), "fetch:ok build:ok start:ok check:ok");
    // production is as it was
    const after = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(after.lastDeploy.deploymentId, before.lastDeploy.deploymentId);
    assert.equal(after.live, before.live);
    const prodList = await h["sites.deployments"]!(w.ctx, { siteId });
    assert.equal(prodList.deployments.length, 1, "a preview is not in the production list");
    // the preview got its own variables and no database of the site's
    const env = w.seen.envs[out.deployment.deploymentId]!;
    assert.deepEqual(Object.keys(env).sort(), ["ALL", "MODE_P"]);
    // its address serves its container, behind sign-in even though the site is public
    const hit = route(w, new URL(out.deployment.url).host);
    assert.equal(hit?.access, "space");
    assert.equal(hit?.passwordHash, null);
    assert.equal(hit?.live, true);
    assert.equal(hit?.target.container, `c-${out.deployment.deploymentId}`);
    assert.equal(route(w, "nobody--shop.sites.test"), null);
    const list = await h["sites.previews"]!(w.ctx, { siteId });
    assert.equal(list.previews.length, 1);
    assert.equal(list.previews[0].branch, "feat/login");
  } finally {
    w.done();
  }
});

test("a new build of a branch replaces the one before it: its container goes, one address, one row in the list", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Shop2");
    const a = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "next", wait: true });
    const b = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "next", wait: true });
    assert.equal(b.deployment.state, "ready");
    assert.ok(w.seen.removed.includes(`c-${a.deployment.deploymentId}`), "the first build's container is removed");
    assert.equal(route(w, new URL(b.deployment.url).host)?.target.container, `c-${b.deployment.deploymentId}`);
    assert.equal((await h["sites.previews"]!(w.ctx, { siteId })).previews.length, 1);
    // another branch is another address
    const c = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "other", wait: true });
    assert.notEqual(c.deployment.url, b.deployment.url);
    assert.equal((await h["sites.previews"]!(w.ctx, { siteId })).previews.length, 2);
    // a failed rebuild leaves the one that was serving
    w.fake.failBuild = true;
    const bad = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "next", wait: true });
    assert.equal(bad.deployment.state, "failed");
    assert.equal(route(w, new URL(b.deployment.url).host)?.target.container, `c-${b.deployment.deploymentId}`);
  } finally {
    w.done();
  }
});

test("removing a preview takes its container and its address away; removing it again says nothing was there", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Shop3");
    const a = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "gone", wait: true });
    const host = new URL(a.deployment.url).host;
    assert.ok(route(w, host));
    assert.deepEqual(await h["sites.preview_remove"]!(w.ctx, { siteId, branch: "gone" }), { removed: true });
    assert.ok(w.seen.removed.includes(`c-${a.deployment.deploymentId}`));
    assert.equal(route(w, host), null);
    assert.equal((await h["sites.previews"]!(w.ctx, { siteId })).previews.length, 0);
    assert.deepEqual(await h["sites.preview_remove"]!(w.ctx, { siteId, branch: "gone" }), { removed: false });
    // and a branch can be built again after it was removed
    const again = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "gone", wait: true });
    assert.equal(again.deployment.state, "ready");
  } finally {
    w.done();
  }
});

test("a preview is refused where it cannot work: no repo, a bad branch, nothing to promote", async () => {
  const w = world();
  try {
    const plain = await w.make("No repo");
    await assert.rejects(() => h["sites.preview_rebuild"]!(w.ctx, { siteId: plain, branch: "x" }), /no repo/);
    const siteId = await w.makeRepo("Shop4");
    await assert.rejects(() => h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "../etc" }), /branch name/);
    await assert.rejects(() => h["sites.preview_promote"]!(w.ctx, { siteId, branch: "nothing" }), /no finished build/);
  } finally {
    w.done();
  }
});

test("promote serves the preview's build as production without building: skipped steps, same image, the old build kept for a rollback", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Shop5");
    const first = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(first.deployment.state, "ready");
    const prev = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "ship-it", wait: true });
    const builds = w.seen.builds;
    await h["sites.env_set"]!(w.ctx, { siteId, entries: [{ name: "MODE", value: "prod", scope: "production" }] });
    const out = await h["sites.preview_promote"]!(w.ctx, { siteId, branch: "ship-it", wait: true });
    assert.equal(out.deployment.state, "ready", out.deployment.problem);
    assert.equal(out.deployment.current, true);
    assert.equal(states(out.deployment.steps), "fetch:skipped build:skipped start:ok check:ok");
    assert.equal(w.seen.builds, builds, "nothing was built");
    assert.equal(w.seen.envs[out.deployment.deploymentId]!["MODE"], "prod", "it runs with the production variables");
    assert.equal(out.deployment.commit, prev.deployment.commit);
    assert.match(out.deployment.note, /Promoted from the preview of ship-it/);
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(site.lastDeploy.deploymentId, out.deployment.deploymentId);
    assert.ok(w.seen.removed.includes(`c-${first.deployment.deploymentId}`), "the old production container is removed");
    // the preview keeps serving, and the shared image is not dropped
    assert.equal(route(w, new URL(prev.deployment.url).host)?.target.container, `c-${prev.deployment.deploymentId}`);
    assert.equal(w.sdb.all("SELECT * FROM sites_promotion WHERE production_id = ?", out.deployment.deploymentId).length, 1);
    // the build before is still there to roll back to
    const back = await h["sites.rollback"]!(w.ctx, { siteId });
    assert.equal(back.deployment.deploymentId, first.deployment.deploymentId);
    // removing the preview does not take the image production uses
    await h["sites.preview_remove"]!(w.ctx, { siteId, branch: "ship-it" });
    const row = w.sdb.all("SELECT image FROM sites_deployment WHERE id = ?", out.deployment.deploymentId)[0] as { image: string };
    assert.ok(row.image, "production keeps its image");
    assert.ok(!w.seen.droppedImages.includes(row.image), "the image is still on the server");
  } finally {
    w.done();
  }
});

test("a preview that is building can be canceled by its id, and leaves nothing running", async () => {
  const w = world();
  w.fake.buildMs = 30_000;
  try {
    const siteId = await w.makeRepo("Shop6");
    const started = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "slow" });
    const id = started.deployment.deploymentId;
    await new Promise((r) => setTimeout(r, 50));
    const out = await h["sites.deploy_cancel"]!(w.ctx, { siteId, deploymentId: id });
    assert.equal(out.deployment.state, "stopped");
    assert.equal(w.seen.running.length, 0);
    assert.equal(route(w, "slow--shop6.sites.test"), null);
  } finally {
    w.done();
  }
});
