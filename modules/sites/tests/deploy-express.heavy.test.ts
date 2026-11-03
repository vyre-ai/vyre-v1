// @heavy docker
// A Node/Express API: env from the Vault, the app's own log in sites.logs, and on a Space site the app learns who is asking (x-vyre-user) while our cookie never reaches it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.test.ts";

test("express: an API with env from the Vault, its log, and who is asking", { skip: SKIP }, async (t) => {
  const w = deployWorld({ vault: { "#Greeting": "hi-express" }, members: ["usr_anem"] });
  t.after(() => w.cleanup());
  const site = await w.create("express");
  await w.h["sites.env_set"](w.ctx, { siteId: site.siteId, entries: [{ name: "GREETING", vaultHandle: "#Greeting" }] });
  const out = await w.h["sites.deploy"](w.ctx, { siteId: site.siteId, wait: true });
  assert.equal(out.deployment.state, "ready", `${out.deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  const log = await w.buildLog(site.siteId);
  assert.match(log, /looks for a Postgres database/, "the build log says what the app looks for");
  const env = await w.h["sites.env_list"](w.ctx, { siteId: site.siteId });
  assert.deepEqual(env.entries.map((e: { name: string }) => e.name), ["GREETING"]);
  assert.deepEqual(env.wanted, ["DATABASE_URL"], "what .env.example names and nothing gives yet");
  const cookie = await w.signIn(site.slug, site.siteId, "usr_anem");
  assert.deepEqual(JSON.parse((await w.get(site.slug, "/api/env", { cookie })).body), { greeting: "hi-express" });
  assert.deepEqual(JSON.parse((await w.get(site.slug, "/api/whoami", { cookie: `${cookie}; theirs=1` })).body), { user: "usr_anem" });
  assert.equal(JSON.parse((await w.get(site.slug, "/api/db", { cookie })).body).db, "none");
  const running = await w.h["sites.logs"](w.ctx, { siteId: site.siteId, tail: 50 });
  assert.ok(Array.isArray(running.lines));
  const status = await w.h["sites.status"](w.ctx, { siteId: site.siteId });
  assert.equal(status.answering, true, JSON.stringify(status));
});
