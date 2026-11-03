// @heavy docker
// A folder of plain files deploys to its own container and is served at <slug>.sites.test, its sub-pages too; the build log says how it was read, and the site row shows status, address,
// last deploy and who deployed it, which is what the Sites list draws.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.test.ts";

test("static: plain files deploy and serve at the site's own address", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  const { site, deployment } = await w.deploy("static", { access: "public" });
  assert.equal(deployment.state, "ready", `${deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  assert.equal(site.url, `https://${site.slug}.sites.test`);
  assert.equal(site.lastDeploy.by, "usr_owner");
  assert.equal(site.lastDeploy.current, true);
  assert.match(site.lastDeploy.note, /Plain files/);
  assert.match(await w.buildLog(site.siteId), /==> Live/);
  // public waits for the person's own Publish (sites.promote); a person deploying it is their yes here
  await w.h["sites.promote"](w.ctx, { siteId: site.siteId });
  const home = await w.get(site.slug, "/");
  assert.equal(home.status, 200);
  assert.match(home.body, /static-fixture-ok/);
  assert.match((await w.get(site.slug, "/about/")).body, /static-about-ok/);
});
