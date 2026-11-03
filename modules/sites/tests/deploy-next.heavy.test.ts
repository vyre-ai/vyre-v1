// @heavy docker
// Next.js (a node server: next build, next start) with an env var from the Vault: the page shows it, the API route answers, and the value was filled at deploy time only.
// The site is for the Space by default: a member signs in through the link and gets in; nobody else does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.ts";

test("next: builds, starts on PORT, reads its env from the Vault, and its API route answers", { skip: SKIP }, async (t) => {
  const w = deployWorld({ vault: { "#Greeting": "hello-from-vault" } });
  t.after(() => w.cleanup());
  const made = await w.create("next");
  assert.equal(made.access, "space", "a deployed site is for the Space until someone says otherwise");
  await w.h["sites.env_set"](w.ctx, { siteId: made.siteId, entries: [{ name: "GREETING", vaultHandle: "#Greeting" }] });
  const out = await w.h["sites.deploy"](w.ctx, { siteId: made.siteId, wait: true });
  const log = await w.buildLog(made.siteId);
  assert.equal(out.deployment.state, "ready", `${out.deployment.problem ?? ""}\n${log}`);
  assert.match(log, /Node: npm ci, npm run build, then npm start/);
  assert.doesNotMatch(log, /hello-from-vault/, "a value never reaches the log");
  const site = (await w.h["sites.get"](w.ctx, { siteId: made.siteId })).site;
  const cookie = await w.signIn(site.slug, site.siteId);
  const page = await w.get(site.slug, "/", { cookie });
  assert.equal(page.status, 200, page.body.slice(0, 300));
  assert.match(page.body, /next-fixture-ok.*hello-from-vault/);
  assert.deepEqual(JSON.parse((await w.get(site.slug, "/api/hello", { cookie })).body), { hello: "next-api-ok" });
  assert.equal((await w.get(site.slug, "/api/hello")).status, 302, "no cookie: sent to sign in");
});
