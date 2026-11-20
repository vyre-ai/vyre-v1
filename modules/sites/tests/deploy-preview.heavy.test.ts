// @heavy docker
// Previews on a real engine: a branch builds into its own container at its own address behind sign-in (the site itself is public), with the variables scoped to previews; promoting it serves the same image as
// production with the production variables and no build; removing the preview takes its address away and leaves production (and its image) as it was.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { _test } from "../handlers/release.ts";
import { deployWorld, docker, FIXTURES, SKIP } from "./deploy-kit.test.ts";

test(
  "preview: its own address behind sign-in, promoted without a build, removed without harm",
  { skip: SKIP },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-preview-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.cpSync(path.join(FIXTURES, "dockerfile"), dir, { recursive: true });
    _test.useFetcher((async (s: { branch?: string }) => ({
      dir,
      commit: "0123456789abcdef0123456789abcdef01234567",
      message: "A change",
      branch: s.branch ?? "main",
      cleanup: () => undefined,
    })) as never);
    t.after(() => _test.useFetcher(null));
    const w = deployWorld();
    t.after(() => w.cleanup());
    const site = await w.create("dockerfile", { access: "public" });
    await w.h["sites.env_set"]!(w.ctx, {
      siteId: site.siteId,
      entries: [
        { name: "VERSION_TAG", value: "prod", scope: "production" },
        { name: "VERSION_TAG_NOTE", value: "x" },
      ],
    });
    // previews get their own value for the same name
    const prod = await w.h["sites.deploy"]!(w.ctx, {
      siteId: site.siteId,
      wait: true,
      source: { repo: "https://github.com/acme/app.git", branch: "main" },
    });
    assert.equal(prod.deployment.state, "ready", `${prod.deployment.problem ?? ""}\n${await w.buildLog(site.siteId)}`);
    assert.equal((await w.get(site.slug, "/")).body, "dockerfile-fixture-ok prod");
    await w.h["sites.env_set"]!(w.ctx, {
      siteId: site.siteId,
      entries: [
        { name: "VERSION_TAG", value: "prod", scope: "production" },
        { name: "VERSION_TAG_PREVIEW", value: "preview", scope: "previews" },
      ],
    });
    const pre = await w.h["sites.preview_rebuild"]!(w.ctx, { siteId: site.siteId, branch: "feat/x", wait: true });
    assert.equal(pre.deployment.state, "ready", `${pre.deployment.problem ?? ""}`);
    const label = new URL(pre.deployment.url).host.replace(/\.sites\.test$/, "");
    // behind sign-in: a visitor without a session is not served, a person of the Space is
    assert.notEqual((await w.get(label, "/")).status, 200);
    const cookie = await w.signIn(label, site.siteId);
    const seen = await w.get(label, "/", { cookie });
    assert.equal(seen.status, 200);
    // no VERSION_TAG in previews (it is production only), so the app's default answers
    assert.equal(seen.body, "dockerfile-fixture-ok v1");
    // production is untouched
    assert.equal((await w.get(site.slug, "/")).body, "dockerfile-fixture-ok prod");

    const builds = w.sdb.all("SELECT COUNT(*) AS n FROM sites_deployment WHERE image IS NOT NULL")[0]!["n"];
    const promoted = await w.h["sites.preview_promote"]!(w.ctx, { siteId: site.siteId, branch: "feat/x", wait: true });
    assert.equal(promoted.deployment.state, "ready", `${promoted.deployment.problem ?? ""}`);
    assert.equal(
      promoted.deployment.steps.map((s: { key: string; state: string }) => `${s.key}:${s.state}`).join(" "),
      "fetch:skipped build:skipped start:ok check:ok",
    );
    assert.equal(
      w.sdb.all("SELECT COUNT(*) AS n FROM sites_deployment WHERE image IS NOT NULL")[0]!["n"],
      Number(builds) + 1,
      "one more row names an image, and no image was built",
    );
    assert.equal(
      (await w.get(site.slug, "/")).body,
      "dockerfile-fixture-ok prod",
      "the preview's image, with production variables",
    );

    // removing the preview takes its address away and leaves production serving
    assert.deepEqual(await w.h["sites.preview_remove"]!(w.ctx, { siteId: site.siteId, branch: "feat/x" }), {
      removed: true,
    });
    assert.notEqual((await w.get(label, "/", { cookie })).status, 200);
    assert.equal((await w.get(site.slug, "/")).body, "dockerfile-fixture-ok prod");
    const running = docker("ps", "-q", "--filter", `label=vyre.site=${site.siteId}`).stdout.split("\n").filter(Boolean);
    assert.equal(running.length, 1, "only production runs");
  },
);
