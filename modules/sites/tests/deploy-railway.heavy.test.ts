// @heavy docker
// A Railway project: the build and start commands and the health check come from railway.json (a package.json with no start script would not run on its own).
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.ts";

test("railway: railway.json says how it builds, starts and is checked", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  const plan = await w.h["sites.plan"](w.ctx, { source: { path: `${(await import("./deploy-kit.ts")).FIXTURES}/railway` } });
  assert.equal(plan.start, "node dist/index.js");
  assert.deepEqual(plan.from.slice(0, 1), ["railway.json"]);
  const { site, deployment } = await w.deploy("railway", { access: "public" });
  assert.equal(deployment.state, "ready", `${deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  await w.h["sites.promote"](w.ctx, { siteId: site.siteId });
  assert.equal((await w.get(site.slug, "/")).body, "railway-fixture-ok");
  assert.equal((await w.get(site.slug, "/health")).body, "ok");
});
