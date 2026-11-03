// @heavy docker
// Python: FastAPI from requirements.txt and main.py (started under uvicorn on PORT), and Flask started by a Procfile web line under gunicorn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.ts";

test("python: FastAPI under uvicorn, and Flask from a Procfile", { skip: SKIP }, async (t) => {
  const w = deployWorld({ vault: { "#Greeting": "hi-python" } });
  t.after(() => w.cleanup());
  const api = await w.create("fastapi", { access: "public" });
  await w.h["sites.env_set"](w.ctx, { siteId: api.siteId, entries: [{ name: "GREETING", vaultHandle: "#Greeting" }] });
  const a = await w.h["sites.deploy"](w.ctx, { siteId: api.siteId, wait: true });
  assert.equal(a.deployment.state, "ready", `${a.deployment.problem ?? ""}\n${await w.buildLog(api.siteId)}`);
  assert.match(await w.buildLog(api.siteId), /uvicorn main:app --host 0\.0\.0\.0 --port \$PORT/);
  await w.h["sites.promote"](w.ctx, { siteId: api.siteId });
  assert.deepEqual(JSON.parse((await w.get(api.slug, "/")).body), { fastapi: "fastapi-fixture-ok", greeting: "hi-python" });

  const { site, deployment } = await w.deploy("flask-procfile", { access: "public" });
  assert.equal(deployment.state, "ready", `${deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
  assert.match(await w.buildLog(site.siteId), /gunicorn app:app --bind 0\.0\.0\.0:\$PORT/);
  await w.h["sites.promote"](w.ctx, { siteId: site.siteId });
  assert.equal((await w.get(site.slug, "/")).body, "flask-fixture-ok");
});
