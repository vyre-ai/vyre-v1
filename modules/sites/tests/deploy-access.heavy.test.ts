// @heavy docker
// Who gets in at a site's own address, for each access: public (anyone), space (members, through the sign-in link), private (owner and shares), password (the form, then a cookie).
// Removing a member ends their way in at once; a stopped site answers nothing; our cookie never reaches the app.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deployWorld, SKIP } from "./deploy-kit.ts";

test("access: public, space, private and password at the site's own address", { skip: SKIP }, async (t) => {
  const w = deployWorld({ members: ["usr_anem"] });
  t.after(() => w.cleanup());
  const { site, deployment } = await w.deploy("static");
  assert.equal(deployment.state, "ready", deployment.problem);
  const id = site.siteId, slug = site.slug;

  // space (the default): a visitor is sent to sign in at the Space; a member's link gives a cookie; a removed member is out on the next request
  const anon = await w.get(slug, "/");
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.location, `https://space.test/sites/signin?site=${id}&next=%2F`);
  const anem = await w.signIn(slug, id, "usr_anem");
  assert.match(String(anem), /^__vyre_site=[0-9a-f]{48}$/);
  assert.match((await w.get(slug, "/", { cookie: anem })).body, /static-fixture-ok/);
  w.members.delete("usr_anem");
  assert.equal((await w.get(slug, "/", { cookie: anem })).status, 403);
  w.members.add("usr_anem");

  // private: the owner, not a member it is not shared with
  await w.h["sites.update"](w.ctx, { siteId: id, access: "private" });
  assert.equal((await w.get(slug, "/", { cookie: anem })).status, 403);
  const owner = await w.signIn(slug, id, "usr_owner");
  assert.equal((await w.get(slug, "/", { cookie: owner })).status, 200);

  // password: refused until a password is set; then a form, a wrong password, the right one, a cookie
  await assert.rejects(w.h["sites.update"](w.ctx, { siteId: id, access: "password" }), /Set the password first/);
  await w.h["sites.password_set"](w.ctx, { siteId: id, password: "correct horse" });
  await w.h["sites.update"](w.ctx, { siteId: id, access: "password" });
  const form = await w.get(slug, "/");
  assert.equal(form.status, 200);
  assert.match(form.body, /This site has a password/);
  const wrong = await w.get(slug, "/__vyre/password", { method: "POST", type: "application/x-www-form-urlencoded", body: "password=nope&next=%2F" });
  assert.equal(wrong.status, 401);
  const right = await w.get(slug, "/__vyre/password", { method: "POST", type: "application/x-www-form-urlencoded", body: "password=correct+horse&next=%2Fabout%2F" });
  assert.equal(right.status, 303);
  assert.equal(right.headers.location, "/about/");
  const pw = String(right.headers["set-cookie"]).split(";")[0] as string;
  assert.match(String(right.headers["set-cookie"]), /HttpOnly; Secure; SameSite=Lax/);
  assert.match((await w.get(slug, "/about/", { cookie: pw })).body, /static-about-ok/);
  // a new password signs everyone out
  await w.h["sites.password_set"](w.ctx, { siteId: id, password: "battery staple" });
  assert.match((await w.get(slug, "/", { cookie: pw })).body, /This site has a password/);

  // public: anyone, once published by the person
  await w.h["sites.update"](w.ctx, { siteId: id, access: "public" });
  assert.equal((await w.get(slug, "/")).status, 404, "going public takes it down until it is published");
  await w.h["sites.promote"](w.ctx, { siteId: id });
  assert.equal((await w.get(slug, "/")).status, 200);

  // stopped: nothing is served
  await w.h["sites.stop"](w.ctx, { siteId: id });
  assert.equal((await w.get(slug, "/")).status, 404);
});
