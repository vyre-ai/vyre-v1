// @heavy docker
// A Vite + React project (a build script, no start) is built to static files and served; a route the app owns answers with its index.html.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.ts";

test("vite: built to static files and served, client routes fall back to index.html", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  const { site, deployment } = await w.deploy("vite", { access: "public" });
  assert.equal(deployment.state, "ready", `${deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  await w.h["sites.promote"](w.ctx, { siteId: site.siteId });
  const home = await w.get(site.slug, "/");
  assert.equal(home.status, 200);
  assert.match(home.body, /<div id="root">/);
  const js = /src="(\/assets\/[^"]+\.js)"/.exec(home.body)?.[1];
  assert.ok(js, home.body);
  assert.match((await w.get(site.slug, js)).body, /vite-fixture-ok/);
  assert.match((await w.get(site.slug, "/some/client/route")).body, /<div id="root">/);
});
