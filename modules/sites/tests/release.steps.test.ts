// A deploy's four steps and cancel (handlers/release.ts), on a real database with the runner faked: no Docker. The real builds are the heavy tests (deploy-*.heavy.test.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { configureRoutes, routeByHost } from "../handlers/route.ts";
import { _test, servingContainers } from "../handlers/release.ts";
import { acceptWebhook, markPushDone, markPushFailed, pendingPushes, signed, follows } from "../handlers/hook.ts";
import { createHmac } from "node:crypto";
import { handlers, siteFacts } from "../impl.ts";
import { deployHandlers } from "../handlers/deploy.ts";
import { FIXTURE, h, world, type Fake } from "../fixtures/deploy-world.ts";
import { exposesKeys, noteGateFp, uploadFingerprint } from "../../../lib/key-target.ts";
import { fetchSource } from "../handlers/source.ts";

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
        { name: "APP_MODE", value: "calm", scope: "all" },
        { name: "ONLY_PROD", value: "p" },
        { name: "ONLY_PREVIEW", value: "v", scope: "previews" },
      ],
    });
    const list = await h["sites.env_list"]!(w.ctx, { siteId });
    assert.deepEqual(
      list.entries.map(
        (e: { name: string; kind: string; value?: string; scope: string }) =>
          `${e.name}:${e.kind}:${e.value}:${e.scope}`,
      ),
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
    await assert.rejects(
      () =>
        set([
          { name: "A", value: "1" },
          { name: "A", value: "2" },
        ]),
      /listed twice/,
    );
    // nothing was kept by the refusals
    assert.equal((await h["sites.env_list"]!(w.ctx, { siteId })).entries.length, 0);
    // an empty plain value is a value
    await set([{ name: "EMPTY", value: "" }]);
    assert.equal((await h["sites.env_list"]!(w.ctx, { siteId })).entries[0].kind, "plain");
  } finally {
    w.done();
  }
});

const route = (w: ReturnType<typeof world>, host: string) => routeByHost({ db: w.sdb } as never, host, "sites.test");

test("previewLabel: a branch is an address that is safe, short enough, and never shared by two branches", () => {
  const l = _test.previewLabel;
  assert.equal(l("shop", "next"), "next--shop");
  assert.notEqual(l("shop", "feat/a"), l("shop", "feat-a"));
  assert.match(l("shop", "feat/Login Page!"), /^feat-login-page-[0-9a-f]{8}--shop$/);
  const long = l("a-fairly-long-site-name-here", "feature/".padEnd(120, "x"));
  assert.ok(long.length <= 63, long);
  assert.match(long, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  assert.ok(long.endsWith("--a-fairly-long-site-name-here"));
  // a site name that leaves no room: still 63 or less, and two sites with the same long start get different addresses
  const s1 = "x".repeat(55) + "-one";
  const s2 = "x".repeat(55) + "-two";
  assert.ok(l(s1, "main").length <= 63 && l(s2, "main").length <= 63);
  const long1 = l("a".repeat(60), "feature/very-long-branch-name");
  const long2 = l("a".repeat(59) + "b", "feature/very-long-branch-name");
  assert.ok(long1.length <= 63 && long2.length <= 63);
  assert.notEqual(long1, long2);
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
        { name: "MODE", value: "prod" },
        { name: "MODE_P", value: "preview", scope: "previews" },
        { name: "ALL", value: "x", scope: "all" },
      ],
    });
    const out = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "feat/login", wait: true });
    assert.equal(out.deployment.state, "ready", out.deployment.problem);
    assert.equal(out.deployment.branch, "feat/login");
    assert.match(out.deployment.url, /^https:\/\/feat-login-[0-9a-f]{8}--shop\.sites\.test$/);
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
    assert.equal(
      w.sdb.all("SELECT * FROM sites_promotion WHERE production_id = ?", out.deployment.deploymentId).length,
      1,
    );
    // the build before is still there to roll back to
    const back = await h["sites.rollback"]!(w.ctx, { siteId });
    assert.equal(back.deployment.deploymentId, first.deployment.deploymentId);
    // removing the preview does not take the image production uses
    await h["sites.preview_remove"]!(w.ctx, { siteId, branch: "ship-it" });
    const row = w.sdb.all("SELECT image FROM sites_deployment WHERE id = ?", out.deployment.deploymentId)[0] as {
      image: string;
    };
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

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a cancel that arrives while the variables are read is recorded before anything starts, and the deploy never goes live", async () => {
  const w = world();
  try {
    const siteId = await w.make("Early cancel");
    // both calls start in the same turn: the cancel runs while the deploy is still reading its variables
    const deploy = h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    const cancel = await h["sites.deploy_cancel"]!(w.ctx, { siteId });
    assert.equal(cancel.deployment.state, "stopped");
    const out = await deploy;
    assert.equal(out.deployment.state, "stopped", "the deploy answers as canceled");
    await settle(100);
    const row = (await h["sites.deployments"]!(w.ctx, { siteId })).deployments[0];
    assert.equal(row.state, "stopped", "nothing later rewrote it");
    assert.equal(w.seen.builds, 0, "nothing was built");
    assert.equal(w.seen.running.length, 0, "nothing was started");
    assert.equal((await h["sites.get"]!(w.ctx, { siteId })).site.live, false);
    // and a deploy after it is a normal one
    const again = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(again.deployment.state, "ready");
  } finally {
    w.done();
  }
});

test("a deploy that was closed by a cancel that could not wait never turns ready or switches the site", async () => {
  const w = world({ uncuttable: true, buildMs: 400 });
  _test.cancelWait(30);
  try {
    const siteId = await w.make("Stuck step");
    const started = await h["sites.deploy"]!(w.ctx, { siteId });
    await settle(50);
    // the job never sees the abort (the switch is not reachable from this call): only the row is closed
    _test.cancels.clear();
    const out = await h["sites.deploy_cancel"]!(w.ctx, { siteId });
    assert.equal(out.deployment.state, "stopped", "closed after the short wait");
    // the step ends by itself later: it must not go on
    await settle(900);
    const row = (await h["sites.deployments"]!(w.ctx, { siteId })).deployments[0];
    assert.equal(row.deploymentId, started.deployment.deploymentId);
    assert.equal(row.state, "stopped", "still stopped");
    assert.equal(row.problem, "Canceled.");
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(site.live, false, "the site was not switched");
    assert.equal(
      w.seen.running.every((c: string) => w.seen.removed.includes(c)),
      true,
      "whatever it started is gone",
    );
  } finally {
    _test.cancelWait(null);
    w.done();
  }
});

test("an error after the address changed hands is not a cancel: the deploy is live, and its container stays", async () => {
  const w = world();
  try {
    const siteId = await w.make("After switch");
    const first = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(first.deployment.state, "ready");
    // the route write fails after the site row changed, and a cancel arrives at the same moment
    w.hooks.hostRoute = () => {
      for (const ac of _test.cancels.values()) ac.abort();
      throw new Error("the proxy refused");
    };
    const second = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    const id = second.deployment.deploymentId as string;
    assert.equal(second.deployment.state, "ready", second.deployment.problem);
    assert.notEqual(second.deployment.problem, "Canceled.");
    assert.match(second.deployment.note, /It is live\. Tidying up after it stopped: the proxy refused/);
    assert.equal(w.seen.removed.includes(`c-${id}`), false, "the container that serves is not removed");
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(site.lastDeploy.deploymentId, id);
    assert.equal(site.lastDeploy.current, true);
  } finally {
    w.done();
  }
});

test("a failure before the address changes hands, with a cancel arriving, still ends as a cancel and leaves the last good build", async () => {
  const w = world();
  try {
    const siteId = await w.make("Before switch");
    const first = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    w.fake.buildMs = 30_000;
    const started = await h["sites.deploy"]!(w.ctx, { siteId });
    await settle(30);
    const out = await h["sites.deploy_cancel"]!(w.ctx, { siteId });
    assert.equal(out.deployment.state, "stopped");
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(site.lastDeploy.deploymentId === started.deployment.deploymentId, true);
    assert.equal(w.seen.removed.includes(`c-${first.deployment.deploymentId}`), false, "the serving container stays");
  } finally {
    w.done();
  }
});

// ---- GitHub's webhook

const sign = (secret: string, body: string): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
let hookN = 0;
const hook = (
  w: ReturnType<typeof world>,
  secret: string,
  event: string,
  payload: Record<string, unknown>,
  o: { delivery?: string; signature?: string; repo?: string } = {},
) => {
  const body = JSON.stringify({ repository: { full_name: o.repo ?? "acme/app", default_branch: "main" }, ...payload });
  return acceptWebhook({ ...w.ctx, origin: "hook", depth: 0 } as never, {
    headers: {
      "x-hub-signature-256": o.signature ?? sign(secret, body),
      "x-github-event": event,
      "x-github-delivery": o.delivery ?? `0000000${++hookN}-aaaa`,
    },
    body,
    url: "https://space.test/hooks/sites",
  }) as Promise<{ accepted: boolean; nudge: boolean }>;
};
const push = (branch: string, after = "a".repeat(40)) => ({ ref: `refs/heads/${branch}`, after });
const queued = (w: ReturnType<typeof world>) =>
  pendingPushes({ db: w.sdb } as never).map((p) => `${p.action}:${p.branch}`);

test("a signature is the HMAC of the raw body, compared whole: a wrong digest, a short one and none are refused", async () => {
  const good = sign("s3cret", "{}");
  assert.equal(await signed("s3cret", good, "{}"), true);
  assert.equal(await signed("s3cret", sign("other", "{}"), "{}"), false);
  assert.equal(await signed("s3cret", good, "{} "), false, "the body is part of it");
  assert.equal(await signed("s3cret", good.slice(0, -2), "{}"), false);
  assert.equal(await signed("s3cret", undefined, "{}"), false);
  assert.equal(await signed("s3cret", good.toUpperCase(), "{}"), false);
});

test("branch patterns: a name, a prefix ending in *, or *", () => {
  assert.equal(follows(["feat/*"], "feat/login"), true);
  assert.equal(follows(["feat/*"], "fix/login"), false);
  assert.equal(follows(["next"], "next"), true);
  assert.equal(follows(["next"], "next2"), false);
  assert.equal(follows(["*"], "anything"), true);
  assert.equal(follows([], "main"), false);
});

test("the webhook: turned on it shows its secret once, rotating makes the old one useless, off refuses everything", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Hooked");
    const off = await h["sites.webhook_get"]!(w.ctx, { siteId });
    assert.equal(off.enabled, false);
    assert.equal(off.url, undefined);
    const on = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true });
    assert.equal(on.enabled, true);
    assert.match(on.secret, /^[0-9a-f]{64}$/);
    assert.equal(on.url, "https://space.test/hooks/sites");
    const again = await h["sites.webhook_get"]!(w.ctx, { siteId });
    assert.equal(again.enabled, true);
    assert.equal(again.secret, undefined, "never shown again");
    assert.equal(
      (await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true })).secret,
      undefined,
      "turning on twice keeps it",
    );
    await h["sites.webhook_set"]!(w.ctx, { siteId, follow: ["*"] });
    assert.deepEqual(await hook(w, on.secret, "ping", {}), { accepted: true, nudge: false });
    const rot = await h["sites.webhook_set"]!(w.ctx, { siteId, rotate: true });
    assert.notEqual(rot.secret, on.secret);
    await assert.rejects(() => hook(w, on.secret, "ping", {}), /not signed/);
    assert.equal((await hook(w, rot.secret, "ping", {})).accepted, true);
    await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: false });
    await assert.rejects(() => hook(w, rot.secret, "ping", {}), /not signed/);
    // the secret is sealed at rest
    const row = w.sdb.all("SELECT hook_secret FROM sites_site WHERE id = ?", siteId)[0] as {
      hook_secret: string | null;
    };
    assert.equal(row.hook_secret, null);
  } finally {
    w.done();
  }
});

test("the webhook is refused where it cannot work: no repo, bad branch patterns", async () => {
  const w = world();
  try {
    const plain = await w.make("No repo hook");
    await assert.rejects(
      () => h["sites.webhook_set"]!(w.ctx, { siteId: plain, enabled: true }),
      /comes from a GitHub repo/,
    );
    const siteId = await w.makeRepo("Patterns");
    for (const bad of ["", "a b", "../x", "x**", "feat/*/y"])
      await assert.rejects(
        () => h["sites.webhook_set"]!(w.ctx, { siteId, follow: [bad] }),
        /branch pattern/,
        JSON.stringify(bad),
      );
    await assert.rejects(
      () => h["sites.webhook_set"]!(w.ctx, { siteId, follow: Array.from({ length: 21 }, (_, i) => `b${i}`) }),
      /at most/,
    );
    const ok = await h["sites.webhook_set"]!(w.ctx, { siteId, follow: ["feat/*", "next", "next"] });
    assert.deepEqual(ok.follow, ["feat/*", "next"]);
  } finally {
    w.done();
  }
});

test("a delivery with no good signature is refused the same way whatever is wrong with it", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Refused");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true });
    const words: string[] = [];
    for (const attempt of [
      () => hook(w, secret, "push", push("main"), { signature: "" }),
      () => hook(w, "wrong", "push", push("main")),
      () => hook(w, secret, "push", push("main"), { repo: "someone/else" }),
      () => hook(w, secret, "push", push("main"), { signature: "sha256=" + "0".repeat(64) }),
    ]) {
      await attempt().then(
        () => assert.fail("accepted"),
        (e: { error?: { code?: string; message?: string } }) => words.push(`${e.error?.code}|${e.error?.message}`),
      );
    }
    assert.equal(new Set(words).size, 1, words.join("\n"));
    assert.match(words[0]!, /^auth\.bad_credentials\|/);
    assert.deepEqual(queued(w), []);
    // only the server may run it
    await assert.rejects(
      () => acceptWebhook({ ...w.ctx, origin: "gateway", depth: 0 } as never, { headers: {}, body: "{}", url: "" }),
      /Only the server/,
    );
  } finally {
    w.done();
  }
});

test("a delivery id is acted on once: the same id again is refused, and does nothing", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Replay");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    await hook(w, secret, "push", push("feat/a"), { delivery: "11111111-aaaa" });
    assert.deepEqual(queued(w), ["preview:feat/a"]);
    markPushDone({ db: w.sdb } as never, (pendingPushes({ db: w.sdb } as never)[0] as { id: string }).id);
    await assert.rejects(
      () => hook(w, secret, "push", push("feat/a"), { delivery: "11111111-aaaa" }),
      /already received/,
    );
    assert.deepEqual(queued(w), [], "the replay queued nothing");
    // a delivery id that is not one is refused before anything is recorded
    await assert.rejects(
      () => hook(w, secret, "push", push("feat/b"), { delivery: "x" }),
      /names its event and its id/,
    );
  } finally {
    w.done();
  }
});

test("a push builds only the branches the site follows: production on a push only when it deploys on push, previews by pattern, removal on a deleted branch or a closed pull request", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Follow");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["feat/*"] });
    // production: nothing to do while it does not deploy on push, a nudge once it does
    await h["sites.update"]!(w.ctx, { siteId, autoDeploy: false });
    assert.equal((await hook(w, secret, "push", push("main", "8".repeat(40)))).nudge, false);
    await h["sites.update"]!(w.ctx, { siteId, autoDeploy: true });
    assert.equal((await hook(w, secret, "push", push("main", "9".repeat(40)))).nudge, true);
    assert.deepEqual(queued(w), [], "production is the tick's deploy, not a queued preview");
    // a branch it does not follow is acknowledged and ignored
    assert.deepEqual(await hook(w, secret, "push", push("fix/x")), { accepted: true, nudge: false });
    assert.deepEqual(queued(w), []);
    // a followed branch: one job, and a second push to it replaces its sha
    await hook(w, secret, "push", push("feat/login", "1".repeat(40)));
    await hook(w, secret, "push", push("feat/login", "2".repeat(40)));
    assert.deepEqual(queued(w), ["preview:feat/login"]);
    assert.equal(
      (w.sdb.all("SELECT sha FROM sites_push WHERE done_at IS NULL")[0] as { sha: string }).sha,
      "2".repeat(40),
    );
    // a delete before the preview ran cancels it and asks for the removal
    await hook(w, secret, "push", { ref: "refs/heads/feat/login", after: "0".repeat(40), deleted: true });
    assert.deepEqual(queued(w), ["remove:feat/login"]);
    // a closed pull request removes the preview of its branch; an opened one does nothing
    await hook(w, secret, "pull_request", {
      action: "opened",
      pull_request: { head: { ref: "feat/pr", repo: { full_name: "acme/app" } } },
    });
    assert.deepEqual(queued(w), ["remove:feat/login"]);
    await hook(w, secret, "pull_request", {
      action: "closed",
      pull_request: { head: { ref: "feat/pr", repo: { full_name: "acme/app" } } },
    });
    assert.deepEqual(queued(w).sort(), ["remove:feat/login", "remove:feat/pr"]);
    // the production branch is never removed by a closed pull request
    await hook(w, secret, "pull_request", {
      action: "closed",
      pull_request: { head: { ref: "main", repo: { full_name: "acme/app" } } },
    });
    assert.equal(queued(w).length, 2);
    // other events are acknowledged and ignored
    assert.deepEqual(await hook(w, secret, "issues", { action: "opened" }), { accepted: true, nudge: false });
    // each job names who to run as: whoever deployed last, else the owner
    const jobs = pendingPushes({ db: w.sdb } as never);
    assert.ok(jobs.every((j) => typeof j.as === "string" && j.as.length > 0));
  } finally {
    w.done();
  }
});

test("a delivery counts for the site whose secret signed it, not for another site of the same repo", async () => {
  const w = world();
  try {
    const a = await w.makeRepo("Site A");
    const b = await w.makeRepo("Site B");
    const sa = await h["sites.webhook_set"]!(w.ctx, { siteId: a, enabled: true, follow: ["*"] });
    await h["sites.webhook_set"]!(w.ctx, { siteId: b, enabled: true, follow: ["*"] });
    await hook(w, sa.secret, "push", push("feat/only-a"));
    const rows = w.sdb.all("SELECT site_id FROM sites_push WHERE done_at IS NULL") as { site_id: string }[];
    assert.deepEqual(
      rows.map((r) => r.site_id),
      [a],
    );
  } finally {
    w.done();
  }
});

test("a cancel that arrives while the address is changing hands is refused, and the deploy goes live", async () => {
  const w = world();
  _test.cancelWait(30);
  try {
    const siteId = await w.make("Going live");
    let refused = "";
    // the route write runs inside the switch: the cancel arrives there
    w.hooks.hostRoute = async () => {
      await h["sites.deploy_cancel"]!(w.ctx, { siteId }).then(
        () => (refused = "accepted"),
        (e: { error?: { message?: string } }) => (refused = e.error?.message ?? "refused"),
      );
    };
    const out = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.match(refused, /going live now/);
    assert.equal(out.deployment.state, "ready");
    const site = (await h["sites.get"]!(w.ctx, { siteId })).site;
    assert.equal(site.lastDeploy.state, "ready");
    assert.equal(site.lastDeploy.current, true);
    assert.equal(site.live, true);
  } finally {
    _test.cancelWait(null);
    w.done();
  }
});

test("a preview that is not ready is not restarted by the server: only ready previews are served again", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Restart");
    const ok = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "up", wait: true });
    w.sdb.run(
      "INSERT INTO sites_deployment (id, site_id, env, state, branch, container_id, log, created_by, at, updated_at, merge_pending) VALUES ('dpl_orphan', ?, 'preview', 'stopped', 'x', 'c-orphan', '[]', 'u', 1, 1, 0)",
      siteId,
    );
    const serving = servingContainers({ db: w.sdb } as never).map((c) => c.containerId);
    assert.ok(serving.includes(`c-${ok.deployment.deploymentId}`));
    assert.equal(serving.includes("c-orphan"), false);
  } finally {
    w.done();
  }
});

test("a variable applies to production unless it is scoped wider, and a preview only gets what was scoped to it", async () => {
  const w = world();
  try {
    const siteId = await w.make("Scopes");
    await h["sites.env_set"]!(w.ctx, {
      siteId,
      entries: [
        { name: "A", value: "1" },
        { name: "B", value: "2", scope: "previews" },
      ],
    });
    const list = (await h["sites.env_list"]!(w.ctx, { siteId })).entries;
    assert.deepEqual(
      list.map((e: { name: string; scope: string }) => `${e.name}:${e.scope}`),
      ["A:production", "B:previews"],
    );
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d", "preview"), { B: "2" });
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d", "production"), { A: "1" });
    // a variable kept with the old default (everywhere) keeps working as it did: nothing flips it
    w.sdb.run(
      "INSERT INTO sites_env (site_id, name, vault_handle, injected, plain, scope) VALUES (?, 'OLD', '', 0, 'x', 'all')",
      siteId,
    );
    const again = (await h["sites.env_list"]!(w.ctx, { siteId })).entries as { name: string; scope: string }[];
    assert.equal(again.find((e) => e.name === "OLD")?.scope, "all");
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d", "preview"), { B: "2", OLD: "x" });
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d", "production"), { A: "1", OLD: "x" });
  } finally {
    w.done();
  }
});

test("a plain value that looks like a secret is refused unless it is confirmed plain; a kept plain value is saved again without asking", async () => {
  const w = world();
  try {
    const siteId = await w.make("Looks secret");
    const set = (entries: unknown[]) => h["sites.env_set"]!(w.ctx, { siteId, entries });
    await assert.rejects(() => set([{ name: "STRIPE_API_KEY", value: "abc" }]), /looks like a secret/);
    await assert.rejects(() => set([{ name: "WHATEVER", value: "sk_live_51Habcdefghijkl" }]), /looks like a secret/);
    await assert.rejects(() => set([{ name: "DB", value: "postgres://u:p@h/db" }]), /looks like a secret/);
    assert.equal((await h["sites.env_list"]!(w.ctx, { siteId })).entries.length, 0, "nothing was kept");
    await set([
      { name: "STRIPE_API_KEY", value: "abc", confirmPlain: true },
      { name: "APP_MODE", value: "calm" },
    ]);
    const kept = (await h["sites.env_list"]!(w.ctx, { siteId })).entries as {
      name: string;
      kind: string;
      value: string;
      scope: string;
    }[];
    assert.equal(kept.length, 2);
    // a public name keeps its plain value, and the list read back goes in again (the page and sites_ship do this)
    await set(kept.map((e) => ({ name: e.name, value: e.value, scope: e.scope, confirmPlain: true })));
    await set([{ name: "NEXT_PUBLIC_SITE_KEY", value: "pk_live_abc" }]);
  } finally {
    w.done();
  }
});

test("sites_ship by name finds the site it made, and says where a deploy error really stopped", async () => {
  const w = world();
  try {
    const bad = await h["sites.ship"]!(w.ctx, {
      name: "Ship twice",
      source: { path: FIXTURE },
      env: [{ name: "PORT", value: "1" }],
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.failedStep, "setup");
    const again = await h["sites.ship"]!(w.ctx, { name: "ship TWICE", source: { path: FIXTURE } });
    assert.equal(again.ok, true, again.say);
    assert.equal(again.siteId, bad.siteId, "the same site, not a second one");
    const all = await h["sites.list"]!(w.ctx, {});
    assert.equal(all.sites.filter((s: { name: string }) => s.name.toLowerCase() === "ship twice").length, 1);
    // an error from the deploy call itself is the deploy's, not setup's
    const stopped = await h["sites.ship"]!(w.ctx, { siteId: again.siteId, source: { repo: "not a repo!!" } });
    assert.equal(stopped.ok, false);
    assert.equal(stopped.failedStep, "deploy");
    assert.match(stopped.say, /^It could not start the deploy/);
  } finally {
    w.done();
  }
});

test("a site keeps its newest ten previews: an older branch is removed with its container", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Many");
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const out = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: `b${i}`, wait: true });
      assert.equal(out.deployment.state, "ready");
      ids.push(out.deployment.deploymentId);
    }
    const list = (await h["sites.previews"]!(w.ctx, { siteId })).previews as { branch: string }[];
    assert.equal(list.length, 10);
    assert.deepEqual(list.map((p) => p.branch).sort(), Array.from({ length: 10 }, (_, i) => `b${i + 2}`).sort());
    assert.ok(w.seen.removed.includes(`c-${ids[0]}`) && w.seen.removed.includes(`c-${ids[1]}`));
  } finally {
    w.done();
  }
});

test("two asks to build the same branch at once make one build", async () => {
  const w = world({ buildMs: 100 });
  try {
    const siteId = await w.makeRepo("Parallel");
    const [a, b] = await Promise.all([
      h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "same", wait: true }),
      h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "same", wait: true }),
    ]);
    assert.equal(a.deployment.deploymentId, b.deployment.deploymentId);
    assert.equal(w.seen.builds, 1);
    const rows = w.sdb.all("SELECT id FROM sites_deployment WHERE env = 'preview'");
    assert.equal(rows.length, 1);
  } finally {
    w.done();
  }
});

test("removing a preview that is still building closes its row with the removal: nothing reads it half built, and it never goes up", async () => {
  const w = world({ uncuttable: true, buildMs: 300 });
  _test.cancelWait(30);
  try {
    const siteId = await w.makeRepo("Remove building");
    const started = await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "mid" });
    await settle(50);
    assert.deepEqual(await h["sites.preview_remove"]!(w.ctx, { siteId, branch: "mid" }), { removed: true });
    const row = w.sdb.all(
      "SELECT state, removed_at, host FROM sites_deployment WHERE id = ?",
      started.deployment.deploymentId,
    )[0] as {
      state: string;
      removed_at: number | null;
      host: string | null;
    };
    assert.equal(row.state, "stopped");
    assert.ok(row.removed_at);
    await settle(700);
    const after = w.sdb.all(
      "SELECT state, host, container_id FROM sites_deployment WHERE id = ?",
      started.deployment.deploymentId,
    )[0] as {
      state: string;
      host: string | null;
      container_id: string | null;
    };
    assert.equal(after.state, "stopped", "the job did not bring it back");
    assert.equal(after.host, null);
    assert.equal((await h["sites.previews"]!(w.ctx, { siteId })).previews.length, 0);
  } finally {
    _test.cancelWait(null);
    w.done();
  }
});

test("a closed pull request from a fork never removes the site's own preview", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Forks");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const closed = (repo: string | null) => ({
      action: "closed",
      pull_request: { head: { ref: "feature-x", ...(repo ? { repo: { full_name: repo } } : { repo: null }) } },
    });
    assert.deepEqual(await hook(w, secret, "pull_request", closed("stranger/app")), { accepted: true, nudge: false });
    assert.deepEqual(
      await hook(w, secret, "pull_request", closed(null)),
      { accepted: true, nudge: false },
      "a deleted fork",
    );
    assert.deepEqual(queued(w), []);
    assert.equal(
      (await hook(w, secret, "pull_request", closed("ACME/app"))).nudge,
      true,
      "its own repo, whatever the case",
    );
    assert.deepEqual(queued(w), ["remove:feature-x"]);
  } finally {
    w.done();
  }
});

test("a push that could not run is recorded as failed and gives its delivery id back: the redelivery is taken, and the site says it failed", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Failing");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const first = await hook(w, secret, "push", push("feat/f"), { delivery: "fail0001-aaaa" });
    assert.equal(first.nudge, true, "a queued preview asks the server to run it now");
    const job = pendingPushes({ db: w.sdb } as never)[0] as { id: string };
    markPushFailed({ db: w.sdb } as never, job.id, "the person no longer has access");
    assert.deepEqual(queued(w), [], "a failed push is not offered again by itself");
    const info = await h["sites.webhook_get"]!(w.ctx, { siteId });
    assert.equal(info.failed.length, 1);
    assert.equal(info.failed[0].branch, "feat/f");
    assert.match(info.failed[0].error, /no longer has access/);
    // GitHub's redelivery of the same delivery is taken, and queues it again
    assert.equal((await hook(w, secret, "push", push("feat/f"), { delivery: "fail0001-aaaa" })).nudge, true);
    assert.deepEqual(queued(w), ["preview:feat/f"]);
    // one that ran stays spent
    markPushDone({ db: w.sdb } as never, (pendingPushes({ db: w.sdb } as never)[0] as { id: string }).id);
    await assert.rejects(
      () => hook(w, secret, "push", push("feat/f"), { delivery: "fail0001-aaaa" }),
      /already received/,
    );
  } finally {
    w.done();
  }
});

test("a delivery id is kept for good: an old captured delivery is refused however long ago it was", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Forever");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    await hook(w, secret, "push", push("feat/a"), { delivery: "old00001-aaaa" });
    w.sdb.run("UPDATE sites_hook_delivery SET at = 1");
    await hook(w, secret, "ping", {}, { delivery: "new00001-aaaa" });
    await assert.rejects(
      () => hook(w, secret, "push", push("feat/a"), { delivery: "old00001-aaaa" }),
      /already received/,
    );
  } finally {
    w.done();
  }
});

test("the order of pushes comes from the commits they name: an old push is refused, and no commit date blocks anything", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Order");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    await h["sites.update"]!(w.ctx, { siteId, autoDeploy: true });
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    const C = "c".repeat(40);
    const Z = "0".repeat(40);
    const move = (branch: string, before: string, after: string, extra: Record<string, unknown> = {}) => ({
      ref: `refs/heads/${branch}`,
      before,
      after,
      ...extra,
    });
    // a branch moves A, then B, then C
    assert.equal((await hook(w, secret, "push", move("feat/o", Z, A))).nudge, true);
    assert.equal((await hook(w, secret, "push", move("feat/o", A, B))).nudge, true);
    // the first push sent again under a new id is old news: the branch moved past A
    await assert.rejects(
      () => hook(w, secret, "push", move("feat/o", Z, A), { delivery: "again001-aaaa" }),
      /older than what this site has already handled/,
    );
    // so is the very head it is on now, delivered twice under two ids
    await assert.rejects(
      () => hook(w, secret, "push", move("feat/o", A, B), { delivery: "again002-aaaa" }),
      /older than what this site has already handled/,
    );
    assert.equal((await hook(w, secret, "push", move("feat/o", B, C))).nudge, true);
    // another branch is its own chain
    assert.equal((await hook(w, secret, "push", move("feat/p", Z, A))).nudge, true);
    assert.equal(queued(w).length, 2, "one preview job per branch");

    // production: a commit dated 10:00, a deploy by hand at 10:30, the push at 11:00: it deploys
    const dep = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(dep.deployment.state, "ready");
    const old = { head_commit: { timestamp: "2000-01-01T10:00:00Z" } };
    assert.equal((await hook(w, secret, "push", move("main", "1".repeat(40), "2".repeat(40), old))).nudge, true);
    // a commit dated in the future blocks nothing: the next push on that branch goes through
    const future = { head_commit: { timestamp: "2031-01-01T00:00:00Z" } };
    assert.equal((await hook(w, secret, "push", move("main", "2".repeat(40), "3".repeat(40), future))).nudge, true);
    assert.equal((await hook(w, secret, "push", move("main", "3".repeat(40), "4".repeat(40)))).nudge, true);
    assert.equal((await hook(w, secret, "push", move("feat/q", Z, "5".repeat(40), future))).nudge, true);
    assert.equal((await hook(w, secret, "push", move("feat/q", "5".repeat(40), "6".repeat(40)))).nudge, true);
  } finally {
    w.done();
  }
});

test("a push that failed to run is not old news: its redelivery under a new id is taken", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Redo");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const push1 = { ref: "refs/heads/feat/r", before: "0".repeat(40), after: "7".repeat(40) };
    await hook(w, secret, "push", push1, { delivery: "redo0001-aaaa" });
    markPushFailed(
      { db: w.sdb } as never,
      (pendingPushes({ db: w.sdb } as never)[0] as { id: string }).id,
      "no access",
    );
    assert.equal((await hook(w, secret, "push", push1, { delivery: "redo0002-aaaa" })).nudge, true);
    assert.deepEqual(queued(w), ["preview:feat/r"]);
  } finally {
    w.done();
  }
});

test("ship adds each database once, however many times it is asked", async () => {
  const w = world();
  try {
    const first = await h["sites.ship"]!(w.ctx, {
      name: "Dbs",
      source: { path: FIXTURE },
      addons: ["postgres", "postgres", "redis"],
    });
    assert.equal(first.ok, true, first.say);
    await h["sites.ship"]!(w.ctx, { siteId: first.siteId, addons: ["postgres", "redis"] });
    const kinds = (w.sdb.all("SELECT kind FROM sites_addon WHERE site_id = ?", first.siteId) as { kind: string }[])
      .map((r) => r.kind)
      .sort();
    assert.deepEqual(kinds, ["postgres", "redis"]);
  } finally {
    w.done();
  }
});

test("the sealed secret is never in anything the site, the list or the webhook answers", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("No leak");
    const on = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const sealed = (w.sdb.all("SELECT hook_secret FROM sites_site WHERE id = ?", siteId)[0] as { hook_secret: string })
      .hook_secret;
    assert.ok(sealed.length > 10);
    const answers = JSON.stringify([
      await h["sites.get"]!(w.ctx, { siteId }),
      await h["sites.list"]!(w.ctx, {}),
      await h["sites.webhook_get"]!(w.ctx, { siteId }),
      await h["sites.deployments"]!(w.ctx, { siteId }),
      await h["sites.status"]!(w.ctx, { siteId }).catch(() => null),
      await h["sites.webhook_set"]!(w.ctx, { siteId, follow: ["main"] }),
    ]);
    assert.equal(answers.includes(on.secret), false, "the secret itself");
    assert.equal(answers.includes(Buffer.from(on.secret).toString("base64")), false, "its sealed form");
    assert.equal(answers.includes("hook_secret"), false);
    assert.equal(answers.includes("hookSecret"), false);
  } finally {
    w.done();
  }
});

test("turning the webhook off, or making a new secret, drops what was waiting to run; a bad branch pattern changes nothing", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Off drops");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    await hook(w, secret, "push", push("feat/one"));
    assert.deepEqual(queued(w), ["preview:feat/one"]);
    const rot = await h["sites.webhook_set"]!(w.ctx, { siteId, rotate: true });
    assert.deepEqual(queued(w), [], "a new secret drops it");
    await hook(w, rot.secret, "push", push("feat/two"));
    await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: false });
    assert.deepEqual(queued(w), [], "off drops it");
    // refused before anything is written: the secret is not made when the patterns are bad
    await assert.rejects(
      () => h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["bad pattern"] }),
      /branch pattern/,
    );
    assert.equal((await h["sites.webhook_get"]!(w.ctx, { siteId })).enabled, false);
  } finally {
    w.done();
  }
});

test("an event that asks for nothing does not wake the server", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Quiet");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["feat/*"] });
    for (const [event, payload] of [
      ["ping", {}],
      ["star", { action: "created" }],
      ["issue_comment", { action: "created" }],
      ["push", push("not-followed")],
      [
        "pull_request",
        { action: "opened", pull_request: { head: { ref: "feat/x", repo: { full_name: "acme/app" } } } },
      ],
    ] as const)
      assert.equal((await hook(w, secret, event, payload as never)).nudge, false, event);
  } finally {
    w.done();
  }
});

test("an agent cannot say a secret-looking value is plain; a person can; ship refuses it before it makes a site", async () => {
  const w = world();
  try {
    const siteId = await w.make("Agent plain");
    const agent = { ...w.ctx, principal: { kind: "agent", id: "agt_x" } };
    const entry = { name: "STRIPE_API_KEY", value: "abc", confirmPlain: true };
    await assert.rejects(
      () => h["sites.env_set"]!(agent, { siteId, entries: [entry] }),
      /an agent cannot say it is plain/,
    );
    assert.equal((await h["sites.env_list"]!(w.ctx, { siteId })).entries.length, 0);
    // a harmless plain value is the agent's own to set; a person's confirm is one step
    await h["sites.env_set"]!(agent, { siteId, entries: [{ name: "APP_MODE", value: "calm" }] });
    await h["sites.env_set"]!(w.ctx, { siteId, entries: [entry] });
    // ship: refused up front, so no site is left behind
    const before = (await h["sites.list"]!(w.ctx, {})).sites.length;
    await assert.rejects(
      () => h["sites.ship"]!(agent, { name: "Agent ship", source: { path: FIXTURE }, env: [entry] }),
      /an agent cannot say it is plain/,
    );
    await assert.rejects(
      () =>
        h["sites.ship"]!(w.ctx, {
          name: "Person ship",
          source: { path: FIXTURE },
          env: [{ name: "DB_PASSWORD", value: "x" }],
        }),
      /looks like a secret/,
    );
    assert.equal((await h["sites.list"]!(w.ctx, {})).sites.length, before, "no site was made by either");
  } finally {
    w.done();
  }
});

test("sites_ship under a name that is taken by another app is refused, never deployed over it", async () => {
  const w = world();
  try {
    const first = await h["sites.ship"]!(w.ctx, { name: "My app", source: { repo: "acme/one" } });
    const siteId = first.siteId as string;
    // the same app again (any branch, the address written another way) goes on with the same site
    const again = await h["sites.ship"]!(w.ctx, {
      name: "my APP",
      source: { repo: "https://github.com/ACME/one.git", branch: "dev" },
    });
    assert.equal(again.siteId, siteId);
    // another app under the same name is refused, and nothing was deployed or changed
    const deploys = (await h["sites.deployments"]!(w.ctx, { siteId })).deployments.length;
    await assert.rejects(
      () => h["sites.ship"]!(w.ctx, { name: "My app", source: { repo: "acme/two" } }),
      /A site named My app already deploys ACME\/one\. Pass its siteId/,
    );
    assert.equal((await h["sites.deployments"]!(w.ctx, { siteId })).deployments.length, deploys);
    assert.match(((await h["sites.get"]!(w.ctx, { siteId })).site.source as { repo: string }).repo, /acme\/one/i);
    // a different app folder of the same repo is another app too
    await assert.rejects(
      () => h["sites.ship"]!(w.ctx, { name: "My app", source: { repo: "acme/one", root: "apps/web" } }),
      /already deploys/,
    );
  } finally {
    w.done();
  }
});

test("no migration rewrites the variables a site already has: an old everywhere stays everywhere", () => {
  for (const f of fs.readdirSync(new URL("../migrations/", import.meta.url)))
    assert.doesNotMatch(
      fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8").replace(/^--.*$/gm, ""),
      /UPDATE\s+sites_env/i,
      f,
    );
});

test("a captured delete or closed pull request cannot be sent again to take a preview away", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Replay removals");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const Z = "0".repeat(40);
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    const deleted = (branch: string, before: string) => ({
      ref: `refs/heads/${branch}`,
      before,
      after: Z,
      deleted: true,
    });
    const created = (branch: string, before: string, after: string) => ({ ref: `refs/heads/${branch}`, before, after });
    const done = () =>
      markPushDone({ db: w.sdb } as never, (pendingPushes({ db: w.sdb } as never)[0] as { id: string }).id);

    // a delete is taken once, and the same delete under a new id is old news
    await hook(w, secret, "push", created("feat/d", Z, A));
    done();
    await hook(w, secret, "push", deleted("feat/d", A));
    assert.deepEqual(queued(w), ["remove:feat/d"]);
    done();
    await assert.rejects(
      () => hook(w, secret, "push", deleted("feat/d", A), { delivery: "dup0001a-aaaa" }),
      /older than/,
    );
    // the branch is made again; the captured delete cannot remove the new one
    await hook(w, secret, "push", created("feat/d", Z, B));
    done();
    await assert.rejects(
      () => hook(w, secret, "push", deleted("feat/d", A), { delivery: "dup0002a-aaaa" }),
      /older than/,
    );
    assert.deepEqual(queued(w), []);
    // a delete of the commit the branch is on now is taken
    await hook(w, secret, "push", deleted("feat/d", B));
    assert.deepEqual(queued(w), ["remove:feat/d"]);
    done();

    // a delete captured before the branch moved on is old news even if it was never seen here
    await hook(w, secret, "push", created("feat/m", Z, A));
    await hook(w, secret, "push", created("feat/m", A, B));
    done();
    await assert.rejects(
      () => hook(w, secret, "push", deleted("feat/m", A), { delivery: "dup0003a-aaaa" }),
      /older than/,
    );

    // a closed pull request: once per close; closed again after it was reopened is a new event
    const closed = (n: number, at: string) => ({
      action: "closed",
      number: n,
      pull_request: { number: n, closed_at: at, head: { ref: "feat/pr", sha: A, repo: { full_name: "acme/app" } } },
    });
    await hook(w, secret, "pull_request", closed(7, "2026-11-19T10:00:00Z"));
    assert.deepEqual(queued(w), ["remove:feat/pr"]);
    done();
    await assert.rejects(
      () => hook(w, secret, "pull_request", closed(7, "2026-11-19T10:00:00Z"), { delivery: "dup0004a-aaaa" }),
      /older than/,
    );
    assert.equal(
      (await hook(w, secret, "pull_request", closed(7, "2026-11-19T12:00:00Z"))).nudge,
      true,
      "closed again later",
    );
  } finally {
    w.done();
  }
});

test("a branch made again at the commit it was deleted at is a new branch: its push is taken, and an old push is still refused", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Same commit");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const Z = "0".repeat(40);
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    const mv = (before: string, after: string, extra: Record<string, unknown> = {}) => ({
      ref: "refs/heads/feat/same",
      before,
      after,
      ...extra,
    });
    await hook(w, secret, "push", mv(Z, A));
    await hook(w, secret, "push", mv(A, Z, { deleted: true }));
    // made again at A: not old news
    assert.equal((await hook(w, secret, "push", mv(Z, A), { delivery: "again0aa-aaaa" })).nudge, true);
    // and the chain goes on from there
    assert.equal((await hook(w, secret, "push", mv(A, B))).nudge, true);
    await assert.rejects(() => hook(w, secret, "push", mv(Z, A), { delivery: "again0bb-aaaa" }), /older than/);
  } finally {
    w.done();
  }
});

test("rows handled in the same millisecond keep the order they were written in", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Same millisecond");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    // the clock stands still: every delivery below is handled at the same instant
    w.ctx.now = () => 1_700_000_000_000;
    const Z = "0".repeat(40);
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    const mv = (before: string, after: string, extra: Record<string, unknown> = {}) => ({
      ref: "refs/heads/feat/ms",
      before,
      after,
      ...extra,
    });
    await hook(w, secret, "push", mv(Z, A));
    await hook(w, secret, "push", mv(A, B));
    // a delete of the commit the branch had left (A) is old news, though it carries the same time as the push after it
    await assert.rejects(
      () => hook(w, secret, "push", mv(A, Z, { deleted: true }), { delivery: "ms0000aa-aaaa" }),
      /older than/,
    );
    // a delete of the current head is taken
    assert.equal((await hook(w, secret, "push", mv(B, Z, { deleted: true }))).nudge, true);
  } finally {
    w.done();
  }
});

test("deleting a branch that was made again at the same commit is a new delete and removes the preview", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Second delete");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const Z = "0".repeat(40);
    const A = "a".repeat(40);
    const mv = (before: string, after: string, extra: Record<string, unknown> = {}) => ({
      ref: "refs/heads/feat/twice",
      before,
      after,
      ...extra,
    });
    const done = () =>
      markPushDone({ db: w.sdb } as never, (pendingPushes({ db: w.sdb } as never)[0] as { id: string }).id);
    await hook(w, secret, "push", mv(Z, A));
    done();
    await hook(w, secret, "push", mv(A, Z, { deleted: true }));
    assert.deepEqual(queued(w), ["remove:feat/twice"]);
    done();
    // the same delete sent again while the branch is still gone is old news
    await assert.rejects(
      () => hook(w, secret, "push", mv(A, Z, { deleted: true }), { delivery: "twice0aa-aaaa" }),
      /older than/,
    );
    // made again at the same commit, then deleted again: that is a new delete, and its preview goes
    await hook(w, secret, "push", mv(Z, A), { delivery: "twice0bb-aaaa" });
    done();
    assert.equal(
      (await hook(w, secret, "push", mv(A, Z, { deleted: true }), { delivery: "twice0cc-aaaa" })).nudge,
      true,
    );
    assert.deepEqual(queued(w), ["remove:feat/twice"]);
  } finally {
    w.done();
  }
});

test("handled pushes are ordered by an explicit counter that is never used again, even after a failed push gives its row back", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Counter");
    const { secret } = await h["sites.webhook_set"]!(w.ctx, { siteId, enabled: true, follow: ["*"] });
    const cols = w.sdb.all("PRAGMA table_info(sites_hook_head)") as { name: string; pk: number }[];
    assert.equal(cols.find((c) => c.name === "seq")?.pk, 1, "seq is the primary key");
    const Z = "0".repeat(40);
    const mv = (before: string, after: string) => ({ ref: "refs/heads/feat/seq", before, after });
    await hook(w, secret, "push", mv(Z, "a".repeat(40)));
    await hook(w, secret, "push", mv("a".repeat(40), "b".repeat(40)));
    const seqs = () =>
      (w.sdb.all("SELECT seq FROM sites_hook_head ORDER BY seq") as { seq: number }[]).map((r) => r.seq);
    assert.deepEqual(seqs(), [1, 2]);
    // the newest push fails to run and gives its row back; the next handled push does not take its number
    const jobs = pendingPushes({ db: w.sdb } as never) as { id: string }[];
    markPushFailed({ db: w.sdb } as never, jobs[0]!.id, "no access");
    await hook(w, secret, "push", mv("b".repeat(40), "c".repeat(40)));
    assert.ok(Math.max(...seqs()) >= 3, `a new row never reuses a number: ${seqs()}`);
    assert.equal(new Set(seqs()).size, seqs().length);
  } finally {
    w.done();
  }
});

test("sites.env_set has one handler: the old copy in the dormant deploy table is gone", () => {
  assert.equal("sites.env_set" in deployHandlers, false);
  assert.equal(typeof handlers["sites.env_set"], "function");
});

test("promoting a preview fills the production variables only: never a previews-scope one", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Promote vars");
    await h["sites.env_set"]!(w.ctx, {
      siteId,
      entries: [
        { name: "PROD_ONLY", value: "p" },
        { name: "PREVIEW_ONLY", value: "v", scope: "previews" },
        { name: "BOTH", value: "b", scope: "all" },
      ],
    });
    await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "feat/vars", wait: true });
    const out = await h["sites.preview_promote"]!(w.ctx, { siteId, branch: "feat/vars", wait: true });
    assert.equal(out.deployment.state, "ready", out.deployment.problem);
    assert.deepEqual(Object.keys(w.seen.envs[out.deployment.deploymentId]!).sort(), ["BOTH", "PROD_ONLY"]);
  } finally {
    w.done();
  }
});

test("a build keeps where its code came from (never the token), and the Gate reads it with the site's stored keys", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Built from");
    await h["sites.env_set"]!(w.ctx, {
      siteId,
      entries: [
        { name: "A", value: "plain" },
        { name: "S", vaultHandle: "#Crm_Key" },
        { name: "P", vaultHandle: "#Crm_Key.preview", scope: "previews" },
      ],
    }).catch(() => undefined);
    await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "feat/b", wait: true });
    const facts = siteFacts({ db: w.sdb } as never, siteId, "feat/b")!;
    assert.match(facts.source!.repo!, /acme\/app/);
    assert.match(facts.builtFrom!.repo!, /acme\/app/);
    assert.equal(JSON.stringify(facts).includes("tokenHandle"), false);
    assert.ok(
      facts.env.every((e) => e.handle.startsWith("#")),
      "only Vault keys, no plain value",
    );
    assert.equal(siteFacts({ db: w.sdb } as never, "sit_nope"), null);
  } finally {
    w.done();
  }
});

test("the Gate's facts keep a stored site's branch and folder, and a deployment's own branch and fingerprint", async () => {
  const rows = [{ fileId: "fil_a", name: "index.html", version: 1, size: 4 }];
  const files = (cap: string, input: unknown): unknown =>
    cap === "files.list" && (input as { folder: string }).folder === "fld_up" ? { files: rows, folders: [] } : null;
  const w = world({ files, fetchFp: () => fpNow });
  let fpNow: string | undefined;
  try {
    const repo = (
      await h["sites.create"]!(w.ctx, {
        name: "Repo",
        source: { repo: "https://github.com/acme/app.git", branch: "main", root: "apps/web" },
      })
    ).site.siteId as string;
    await h["sites.deploy"]!(w.ctx, { siteId: repo, wait: true });
    await h["sites.preview_rebuild"]!(w.ctx, { siteId: repo, branch: "feat/x", wait: true });
    const f = siteFacts({ db: w.sdb } as never, repo, "feat/x")!;
    assert.equal(f.source!.branch, "main");
    assert.equal(f.source!.root, "apps/web");
    assert.equal(f.builtFrom!.branch, "feat/x", "the preview was built from its own branch");
    assert.equal(f.builtFrom!.root, "apps/web");
    const up = (await h["sites.create"]!(w.ctx, { name: "Up", source: { folderId: "fld_up" } })).site.siteId as string;
    fpNow = (await uploadFingerprint({ folderId: "fld_up" }, async (cap, i) => files(cap, i))) ?? undefined;
    await h["sites.deploy"]!(w.ctx, { siteId: up, wait: true });
    const g = siteFacts({ db: w.sdb } as never, up)!;
    assert.equal(g.deployedFp, fpNow, "what the live build read");
    assert.equal(g.source!.fp, undefined, "the stored source holds no fingerprint (the Gate reads the files)");
  } finally {
    w.done();
  }
});

test("a build refuses files other than the ones the deploy was asked for, in plain words, and records what it read", async () => {
  const rows = [{ fileId: "fil_a", name: "index.html", version: 1, size: 4 }];
  const files = (cap: string, input: unknown): unknown =>
    cap === "files.list" && (input as { folder: string }).folder === "fld_up" ? { files: rows, folders: [] } : null;
  let read: string | undefined;
  const w = world({ files, fetchFp: () => read });
  try {
    const siteId = (await h["sites.create"]!(w.ctx, { name: "Up", source: { folderId: "fld_up" } })).site
      .siteId as string;
    const asked = await uploadFingerprint({ folderId: "fld_up" }, async (cap, i) => files(cap, i));
    // the files change between the ask and the fetch: the build reads other versions
    read = "00000000000000000000000000000000";
    const bad = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(bad.deployment.state, "failed");
    assert.match(bad.deployment.problem, /files in Files changed after this deploy was asked for/);
    assert.equal(bad.deployment.fix, "retry");
    assert.equal(w.seen.builds, 0, "nothing was built from them");
    assert.equal(siteFacts({ db: w.sdb } as never, siteId)!.deployedFp, null);
    // the files it read are the ones asked for: it goes on, and the build keeps that fingerprint
    read = asked!;
    const ok = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(ok.deployment.state, "ready", ok.deployment.problem);
    assert.equal(siteFacts({ db: w.sdb } as never, siteId)!.deployedFp, asked);
    // the files changed again after the ask: the fetch reads other versions than the ones asked for, and refuses
    rows[0]!.version = 2;
    const again = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(again.deployment.state, "failed", "read now: a changed version, but the fetch says the old one");
  } finally {
    w.done();
  }
});

test("the fetcher fingerprints the versions it read, the same way the Gate does", async () => {
  const tree: Record<
    string,
    {
      files: { fileId: string; name: string; version: number; size: number }[];
      folders: { folderId: string; name: string }[];
    }
  > = {
    fld: {
      files: [{ fileId: "fil_1", name: "index.html", version: 3, size: 5 }],
      folders: [
        { folderId: "fld_s", name: "css" },
        { folderId: "fld_nm", name: "node_modules" },
      ],
    },
    fld_s: { files: [{ fileId: "fil_2", name: "a.css", version: 1, size: 2 }], folders: [] },
    fld_nm: { files: [{ fileId: "fil_3", name: "x.js", version: 1, size: 1 }], folders: [] },
  };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const q = input as { folder?: string; fileId?: string };
    if (cap === "files.list") return tree[q.folder as string] ?? null;
    if (cap === "files.read") {
      const f = Object.values(tree)
        .flatMap((t) => t.files)
        .find((x) => x.fileId === q.fileId)!;
      return { base64: Buffer.from("x".repeat(f.size)).toString("base64"), version: f.version, size: f.size };
    }
    return null;
  };
  const got = await fetchSource({ folderId: "fld" }, { call, token: async () => null, contained: true });
  try {
    assert.ok(got.fp, "the fetch says what it read");
    assert.equal(got.fp, await uploadFingerprint({ folderId: "fld" }, call), "the Gate would read the same");
    tree["fld"]!.files[0]!.version = 4;
    assert.notEqual(
      got.fp,
      await uploadFingerprint({ folderId: "fld" }, call),
      "a later version is another fingerprint",
    );
  } finally {
    got.cleanup();
  }
});

test("a Vault key scoped to everything reaches a preview only for a branch a person named in the follow list: a * follow or any other branch gets plain values and the keys made for previews", async () => {
  const w = world({ values: { SECRET_ALL: "s-all", SECRET_PREVIEW: "s-prev", SECRET_PROD: "s-prod" } });
  try {
    const siteId = await w.makeRepo("Scoped");
    const row = (name: string, handle: string | null, plain: string | null, scope: string): void =>
      void w.sdb.run(
        "INSERT INTO sites_env (site_id, name, vault_handle, injected, plain, scope) VALUES (?, ?, ?, ?, ?, ?)",
        siteId,
        name,
        handle ?? "",
        0,
        plain,
        scope,
      );
    row("SECRET_ALL", "#Stripe.key", null, "all");
    row("SECRET_PREVIEW", "#Stripe.key", null, "previews");
    row("SECRET_PROD", "#Stripe.key", null, "production");
    row("PLAIN_ALL", null, "calm", "all");
    const preview = (branch: string) => _test.envOf(w.ctx, siteId, "d", "preview", branch);
    // no follow list: no branch is named
    assert.deepEqual(await preview("feat/x"), { PLAIN_ALL: "calm", SECRET_PREVIEW: "s-prev" });
    // a * follow names nothing: an agent that pushes a branch gets no everywhere-key
    await h["sites.webhook_set"]!(w.ctx, { siteId, follow: ["*"] });
    assert.deepEqual(await preview("agent-branch"), { PLAIN_ALL: "calm", SECRET_PREVIEW: "s-prev" });
    await h["sites.webhook_set"]!(w.ctx, { siteId, follow: ["feat/*"] });
    assert.deepEqual(await preview("feat/y"), { PLAIN_ALL: "calm", SECRET_PREVIEW: "s-prev" }, "a prefix names none");
    // a branch a person named gets it
    await h["sites.webhook_set"]!(w.ctx, { siteId, follow: ["release", "feat/*"] });
    assert.deepEqual(await preview("release"), { PLAIN_ALL: "calm", SECRET_ALL: "s-all", SECRET_PREVIEW: "s-prev" });
    assert.deepEqual(await preview("feat/y"), { PLAIN_ALL: "calm", SECRET_PREVIEW: "s-prev" });
    // production still takes the everywhere-key
    assert.deepEqual(await _test.envOf(w.ctx, siteId, "d", "production"), {
      PLAIN_ALL: "calm",
      SECRET_ALL: "s-all",
      SECRET_PROD: "s-prod",
    });
    // and a real preview build of an unnamed branch is built with no everywhere-key
    await h["sites.preview_rebuild"]!(w.ctx, { siteId, branch: "agent-branch", wait: true });
    const dep = w.sdb.all("SELECT id FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND branch = ?", siteId, "agent-branch")[0] as { id: string };
    assert.equal(w.seen.envs[dep.id]?.["SECRET_ALL"], undefined);
    assert.equal(w.seen.envs[dep.id]?.["SECRET_PREVIEW"], "s-prev");
  } finally {
    w.done();
  }
});

test("exposesKeys, read from a real site's facts: what reaches production on a site that stores a production Vault key is held; a site with no such key, an unreadable site, and a change that builds nothing are not", async () => {
  const w = world();
  try {
    const siteId = await w.makeRepo("Exposed");
    const key = (scope: string): void =>
      void w.sdb.run(
        "INSERT INTO sites_env (site_id, name, vault_handle, injected, plain, scope) VALUES (?, ?, ?, ?, ?, ?)",
        siteId,
        `K_${scope}`,
        "#Stripe.key",
        0,
        null,
        scope,
      );
    const facts = () => siteFacts({ db: w.sdb } as never, siteId) as never;
    const changes: Record<string, unknown>[] = [
      { follow: ["*"] },
      { enabled: true },
      { autoDeploy: true },
      { settings: { defaultBranch: "x" } },
    ];
    for (const c of changes) assert.equal(exposesKeys({ siteId, ...c }, facts()), false, "no key stored");
    key("previews");
    for (const c of changes) assert.equal(exposesKeys({ siteId, ...c }, facts()), false, "a previews-only key");
    key("all");
    for (const c of changes) assert.equal(exposesKeys({ siteId, ...c }, facts()), true, `a key for everything: ${JSON.stringify(c)}`);
    for (const c of [{ rotate: true }, { enabled: false }, { name: "New" }, { autoDeploy: false }])
      assert.equal(exposesKeys({ siteId, ...c }, facts()), false, `${JSON.stringify(c)} changes nothing that is built`);
    assert.equal(exposesKeys({ siteId: "sit_nope", follow: ["*"] }, siteFacts({ db: w.sdb } as never, "sit_nope")), true, "a site it cannot read");
  } finally {
    w.done();
  }
});

test("a build checks the files it fetches against the fingerprint the Gate read for the call, not a fresh read at the deploy call", async () => {
  const rows = [{ fileId: "fil_a", name: "index.html", version: 1, size: 4 }];
  const files = (cap: string, input: unknown): unknown =>
    cap === "files.list" && (input as { folder: string }).folder === "fld_up" ? { files: rows, folders: [] } : null;
  let read: string | undefined;
  const w = world({ files, fetchFp: () => read });
  try {
    const siteId = (await h["sites.create"]!(w.ctx, { name: "Up", source: { folderId: "fld_up" } })).site.siteId as string;
    const judged = (await uploadFingerprint({ folderId: "fld_up" }, async (cap, i) => files(cap, i)))!;
    // between the Gate's read and the handler the files change; the build reads the new ones
    rows[0]!.version = 2;
    const now = (await uploadFingerprint({ folderId: "fld_up" }, async (cap, i) => files(cap, i)))!;
    read = now;
    noteGateFp(w.ctx.trace.traceId, siteId, judged);
    const bad = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(bad.deployment.state, "failed", "the files are not the ones the Gate judged");
    assert.match(bad.deployment.problem, /files in Files changed after this deploy was asked for/);
    // a call the Gate did not read (a person's): the handler reads for itself, and the build goes on
    const ok = await h["sites.deploy"]!(w.ctx, { siteId, wait: true });
    assert.equal(ok.deployment.state, "ready", ok.deployment.problem);
    assert.equal(siteFacts({ db: w.sdb } as never, siteId)!.deployedFp, now);
  } finally {
    w.done();
  }
});
