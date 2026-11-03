// @heavy docker
// Each site is on a network of its own. From inside site A's container: site B does not answer, site B's Postgres does not answer, and Vyre does not answer (its port is open on the host,
// but a connection from a site network's address is closed at once). From inside site B: its own Postgres answers. From the host, both sites and Vyre answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, docker, SKIP } from "./deploy-kit.test.ts";
import { siteRunner } from "../handlers/route.ts";

test("isolation: a site reaches neither another site, nor another site's database, nor Vyre; it reaches its own database", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  const a = await w.deploy("static", { access: "public" });
  const b = await w.deploy("static", { access: "public" });
  assert.equal(a.deployment.state, "ready", a.deployment.problem);
  assert.equal(b.deployment.state, "ready", b.deployment.problem);
  assert.equal((await w.h["sites.addon_add"](w.ctx, { siteId: b.site.siteId, kind: "postgres" })).addon.state, "ready");
  const r = siteRunner()!;
  const containerOf = (siteId: string): string => w.sdb.all("SELECT container_id FROM sites_site WHERE id = ?", siteId)[0]!["container_id"] as string;
  const ca = containerOf(a.site.siteId), cb = containerOf(b.site.siteId);
  const ipB = await r.address(cb);
  assert.ok(ipB);
  const pgB = JSON.parse(docker("inspect", `vyre-site-${b.site.siteId.replace(/^sit_/, "").slice(-12)}-postgres`).stdout)[0].NetworkSettings.Networks;
  const pgIpB = (Object.values(pgB)[0] as { IPAddress: string }).IPAddress;
  const netA = JSON.parse(docker("network", "inspect", `vyre-site-${a.site.siteId.replace(/^sit_/, "").slice(-16)}`).stdout)[0];
  const gatewayA = netA.IPAM.Config[0].Gateway as string;
  const port = await w.port();
  const inA = (cmd: string) => r.exec(ca, ["sh", "-c", cmd], {});
  const inB = (cmd: string) => r.exec(cb, ["sh", "-c", cmd], {});

  // controls: each site answers itself, and from the host both sites and Vyre answer
  assert.equal((await inA("wget -q -T 3 -O- http://127.0.0.1:3000/ >/dev/null")).code, 0, "A answers itself");
  assert.equal((await w.get(a.site.slug, "/")).status, 200);
  assert.equal((await w.get(b.site.slug, "/")).status, 200);
  assert.equal((await inB(`nc -z -w 3 postgres-${b.site.siteId.replace(/^sit_/, "").slice(-12)} 5432`)).code, 0, "B reaches its own Postgres by its name");

  // what A cannot reach
  const toB = await inA(`wget -q -T 3 -O- http://${ipB}:3000/`);
  assert.notEqual(toB.code, 0, `A must not reach B: ${toB.out}`);
  const toPg = await inA(`nc -z -w 3 ${pgIpB} 5432`);
  assert.notEqual(toPg.code, 0, "A must not reach B's Postgres");
  assert.notEqual((await inA(`nc -z -w 3 postgres-${b.site.siteId.replace(/^sit_/, "").slice(-12)} 5432`)).code, 0, "B's Postgres name means nothing on A's network");
  const toVyre = await inA(`wget -q -T 3 -O- http://${gatewayA}:${port}/`);
  assert.notEqual(toVyre.code, 0, `A must not reach Vyre: ${toVyre.out}`);
  process.stdout.write(`A->B: ${toB.out.trim() || toB.code}\nA->B postgres: ${toPg.code}\nA->Vyre (${gatewayA}:${port}): ${toVyre.out.trim() || toVyre.code}\n`);
});
