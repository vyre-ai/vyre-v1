// @heavy docker
// Postgres attach: the Express app has no database, the deploy says so; one press adds the site's own Postgres (DATABASE_URL injected), a redeploy talks to it, its data outlives the
// redeploy, and a pg_dump from Files copies an existing database in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.test.ts";

test("postgres: add one, the app uses it across a redeploy, and a dump imports", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  const site = await w.create("express", { access: "public" });
  const added = await w.h["sites.addon_add"](w.ctx, { siteId: site.siteId, kind: "postgres" });
  assert.deepEqual(added.addon, { kind: "postgres", state: "ready", envName: "DATABASE_URL" });
  const out = await w.h["sites.deploy"](w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(out.deployment.state, "ready", `${out.deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  await w.h["sites.promote"](w.ctx, { siteId: site.siteId });
  const one = JSON.parse((await w.get(site.slug, "/api/db")).body);
  assert.equal(one.db, "ok", JSON.stringify(one));
  assert.equal(one.hits, 1);
  assert.equal(one.imported, false);
  // import a plain SQL dump from Files
  w.files.set("fil_dump", { name: "railway.sql", folder: "fld_x", bytes: Buffer.from("create table imported (id int);\ninsert into imported values (7);\n") });
  const imp = await w.h["sites.db_import"](w.ctx, { siteId: site.siteId, fileId: "fil_dump" });
  assert.equal(imp.ok, true, imp.detail);
  // a redeploy keeps the data
  const again = await w.h["sites.deploy"](w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(again.deployment.state, "ready");
  const two = JSON.parse((await w.get(site.slug, "/api/db")).body);
  assert.equal(two.hits, 2, "the row from before the redeploy is still there");
  assert.equal(two.imported, true);
  const row = (await w.h["sites.get"](w.ctx, { siteId: site.siteId })).site;
  assert.deepEqual(row.addons, [{ kind: "postgres", state: "ready", envName: "DATABASE_URL" }]);
  assert.deepEqual((await w.h["sites.env_list"](w.ctx, { siteId: site.siteId })).wanted, ["GREETING"], "DATABASE_URL comes from the Postgres; GREETING is still not set");
});
