// @heavy docker
// A project with its own Dockerfile (port 8080 from EXPOSE) runs as written. Then rollback: a second deploy with a new env value serves v2, rollback serves v1 again from the kept image
// with no build, and the container runs with the per-site CPU, memory and process caps and rotated logs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, docker, SKIP } from "./deploy-kit.ts";

test("dockerfile: its own Dockerfile on its own port, then a redeploy and a rollback", { skip: SKIP }, async (t) => {
  const w = deployWorld({ vault: { "#Tag1": "v1", "#Tag2": "v2" } });
  t.after(() => w.cleanup());
  const site = await w.create("dockerfile", { access: "public", limits: { cpus: 0.5, memoryMb: 256 } });
  await w.h["sites.env_set"](w.ctx, { siteId: site.siteId, entries: [{ name: "VERSION_TAG", vaultHandle: "#Tag1" }] });
  const first = await w.h["sites.deploy"](w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(first.deployment.state, "ready", `${first.deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  await w.h["sites.promote"](w.ctx, { siteId: site.siteId });
  assert.equal((await w.get(site.slug, "/")).body, "dockerfile-fixture-ok v1");
  const row = (await w.h["sites.get"](w.ctx, { siteId: site.siteId })).site;
  assert.equal(row.port, 8080, "the port comes from EXPOSE");
  const inspect = JSON.parse(docker("inspect", w.sdb.all("SELECT container_id FROM sites_site WHERE id = ?", site.siteId)[0]!["container_id"] as string).stdout)[0];
  assert.equal(inspect.HostConfig.NanoCpus, 500_000_000);
  assert.equal(inspect.HostConfig.Memory, 256 * 1024 * 1024);
  assert.equal(inspect.HostConfig.PidsLimit, 512);
  assert.deepEqual(inspect.HostConfig.LogConfig, { Type: "json-file", Config: { "max-file": "3", "max-size": "10m" } });
  assert.deepEqual(inspect.HostConfig.CapDrop, ["ALL"]);
  assert.equal(inspect.Mounts.length, 0, "no socket, no host folder");

  await w.h["sites.env_set"](w.ctx, { siteId: site.siteId, entries: [{ name: "VERSION_TAG", vaultHandle: "#Tag2" }] });
  const second = await w.h["sites.deploy"](w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(second.deployment.state, "ready");
  assert.equal((await w.get(site.slug, "/")).body, "dockerfile-fixture-ok v2");
  const list = (await w.h["sites.deployments"](w.ctx, { siteId: site.siteId })).deployments;
  assert.equal(list.length, 2);
  assert.equal(list[0].current, true);
  assert.equal(list[1].current, false);

  // rollback brings the first build back; its env is filled again, so it says v2 now that the key changed: the build is v1's, the value is today's
  await w.h["sites.env_set"](w.ctx, { siteId: site.siteId, entries: [{ name: "VERSION_TAG", vaultHandle: "#Tag1" }] });
  const back = await w.h["sites.rollback"](w.ctx, { siteId: site.siteId });
  assert.equal(back.deployment.deploymentId, first.deployment.deploymentId);
  assert.equal(back.deployment.current, true);
  assert.equal((await w.get(site.slug, "/")).body, "dockerfile-fixture-ok v1");
});
