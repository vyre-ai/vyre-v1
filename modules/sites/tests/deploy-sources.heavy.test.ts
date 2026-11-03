// @heavy docker
// Where code comes from: a zip uploaded to Files (with one top folder, like GitHub's own download), a folder in Files, and a public GitHub repo. A source that cannot be read fails with plain words
// and the fix to press, and the address keeps serving the last good build.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { test } from "node:test";
import { deployWorld, FIXTURES, SKIP } from "./deploy-kit.test.ts";

test("sources: a zip in Files, a folder in Files, a GitHub repo, and a bad repo", { skip: SKIP }, async (t) => {
  const w = deployWorld();
  t.after(() => w.cleanup());
  // a zip of the static fixture under one top folder
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-zip-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(path.join(FIXTURES, "static"), path.join(tmp, "site-main"), { recursive: true });
  assert.equal(spawnSync("sh", ["-c", "cd \"$1\" && (zip -qr site.zip site-main || python3 -c 'import shutil;shutil.make_archive(\"site\",\"zip\",\".\",\"site-main\")')", "sh", tmp]).status, 0);
  w.files.set("fil_zip", { name: "site.zip", folder: "fld_up", bytes: fs.readFileSync(path.join(tmp, "site.zip")) });
  const zipped = (await w.h["sites.create"](w.ctx, { name: `zip ${process.pid}`, access: "public", source: { fileId: "fil_zip" } })).site;
  w.track(zipped.siteId);
  const z = await w.h["sites.deploy"](w.ctx, { siteId: zipped.siteId, wait: true });
  assert.equal(z.deployment.state, "ready", `${z.deployment.problem ?? ""}\n${await w.buildLog(zipped.siteId)}`);
  await w.h["sites.promote"](w.ctx, { siteId: zipped.siteId });
  assert.match((await w.get(zipped.slug, "/")).body, /static-fixture-ok/);

  // a folder in Files, with a subfolder
  w.folders.set("fld_app", { name: "app", parent: null });
  w.folders.set("fld_about", { name: "about", parent: "fld_app" });
  w.files.set("fil_i", { name: "index.html", folder: "fld_app", bytes: Buffer.from("<h1>from-files-ok</h1>") });
  w.files.set("fil_a", { name: "index.html", folder: "fld_about", bytes: Buffer.from("<p>files-about-ok</p>") });
  const folder = (await w.h["sites.create"](w.ctx, { name: `files ${process.pid}`, access: "public", source: { folderId: "fld_app" } })).site;
  w.track(folder.siteId);
  const f = await w.h["sites.deploy"](w.ctx, { siteId: folder.siteId, wait: true });
  assert.equal(f.deployment.state, "ready", f.deployment.problem);
  await w.h["sites.promote"](w.ctx, { siteId: folder.siteId });
  assert.match((await w.get(folder.slug, "/")).body, /from-files-ok/);
  assert.match((await w.get(folder.slug, "/about/")).body, /files-about-ok/);

  // a public GitHub repo (owner/name), and the commit it built
  const repo = (await w.h["sites.create"](w.ctx, { name: `gh ${process.pid}`, access: "public", source: { repo: "octocat/Spoon-Knife", branch: "main" } })).site;
  w.track(repo.siteId);
  assert.equal(repo.autoDeploy, true, "a repo deploys again on a push");
  const g = await w.h["sites.deploy"](w.ctx, { siteId: repo.siteId, wait: true });
  assert.equal(g.deployment.state, "ready", `${g.deployment.problem ?? ""}\n${await w.buildLog(repo.siteId)}`);
  assert.match(g.deployment.commit, /^[0-9a-f]{40}$/);
  await w.h["sites.promote"](w.ctx, { siteId: repo.siteId });
  assert.match((await w.get(repo.slug, "/")).body, /Spoon-Knife/i);
  // no push since: a push check deploys nothing
  const same = await w.h["sites.deploy"](w.ctx, { siteId: repo.siteId, onlyIfChanged: true });
  assert.equal(same.deployment.deploymentId, g.deployment.deploymentId);

  // a repo that is not there: plain words, the fix, and the last good build keeps serving
  const bad = await w.h["sites.deploy"](w.ctx, { siteId: repo.siteId, source: { repo: "octocat/this-repo-is-not-there-vyre", branch: "main" }, wait: true });
  assert.equal(bad.deployment.state, "failed");
  assert.match(bad.deployment.problem, /not found|private/);
  assert.equal(bad.deployment.fix, "connect_repo");
  assert.match((await w.get(repo.slug, "/")).body, /Spoon-Knife/i, "the address still serves the last good build");
});
