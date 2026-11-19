// @heavy docker
// A deploy canceled in the middle of its build on a real engine: the build is cut off (the engine stops building), the deploy ends as Canceled with its steps closed (Build failed, Start and Check not run),
// no container of the new deploy is left, and the build that was serving before keeps serving the same answer.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deployWorld, docker, FIXTURES, SKIP } from "./deploy-kit.test.ts";

test("cancel: a build that runs is cut off, the last good build keeps serving", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cancel-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(FIXTURES, "dockerfile"), dir, { recursive: true });
  const site = await w.create("dockerfile", { access: "public", source: { path: dir } });
  const first = await w.h["sites.deploy"]!(w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(first.deployment.state, "ready", `${first.deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  await w.h["sites.promote"]!(w.ctx, { siteId: site.siteId });
  const before = (await w.get(site.slug, "/")).body;
  assert.match(before, /dockerfile-fixture-ok/);

  // the next build sleeps for five minutes
  const text = fs.readFileSync(path.join(dir, "Dockerfile"), "utf8");
  fs.writeFileSync(path.join(dir, "Dockerfile"), text.replace("COPY server.js .", "RUN sleep 300\nCOPY server.js ."));
  const started = await w.h["sites.deploy"]!(w.ctx, { siteId: site.siteId });
  const id = started.deployment.deploymentId as string;
  const stepNow = async (): Promise<string | undefined> => {
    const log = await w.h["sites.logs"]!(w.ctx, { siteId: site.siteId, deploymentId: id, build: true, tail: 50 });
    return (log.steps as { key: string; state: string }[] | undefined)?.find((s) => s.state === "running")?.key;
  };
  const until = Date.now() + 120_000;
  while ((await stepNow()) !== "build") {
    assert.ok(Date.now() < until, "the build never began");
    await new Promise((r) => setTimeout(r, 500));
  }
  // let the engine reach the sleeping step
  await new Promise((r) => setTimeout(r, 3000));
  const t0 = Date.now();
  const out = await w.h["sites.deploy_cancel"]!(w.ctx, { siteId: site.siteId });
  assert.equal(out.deployment.state, "stopped", out.deployment.problem);
  assert.ok(Date.now() - t0 < 25_000, "a cancel answers within its wait");
  const steps = out.deployment.steps as { key: string; state: string }[];
  assert.deepEqual(
    steps.map((s) => `${s.key}:${s.state}`),
    ["fetch:ok", "build:failed", "start:skipped", "check:skipped"],
  );
  // the engine's build is gone: nothing of this site runs a `sleep`
  await new Promise((r) => setTimeout(r, 1500));
  const running = docker("ps", "-q", "--filter", `label=vyre.site=${site.siteId}`).stdout.split("\n").filter(Boolean);
  assert.equal(running.length, 1, "only the build that was serving is running");
  assert.equal((await w.get(site.slug, "/")).body, before, "the last good build keeps serving");
  const row = (await w.h["sites.get"]!(w.ctx, { siteId: site.siteId })).site;
  assert.equal(row.live, true);
  // a deploy can start again after a cancel
  fs.writeFileSync(path.join(dir, "Dockerfile"), text);
  const again = await w.h["sites.deploy"]!(w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(again.deployment.state, "ready", `${again.deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
});
