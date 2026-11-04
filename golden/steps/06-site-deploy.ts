// Golden flow 6: a site is a route (owner, 2 Nov). A site with a folder of files is made, a person publishes it (an agent's publish is held by site_promote: modules/sites/tests/route.test.ts), a visitor with no session gets the page at /p/<slug> in the sandbox, and stopping it
// takes it down. An artifact is published private: its owner opens it, and a Space member it is not shared with is refused. Through the gateway.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_SITE = ["sites", "gate", "tasks", "files", "vault", "devices", "access", "spaces", "computers", "network"];
export const GAPS: Gap[] = [];

export async function runSite(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.d.token;
    const folder = await trail.step("a folder holds the page", async () => {
      const roots = expectStatus(await s.call("files.tree", admin, {}), 200, "files.tree").roots as { key: string; folderId?: string }[];
      const parent = roots.find((r) => r.key === "deployments")?.folderId;
      assert.ok(parent, `a Deployments root: ${short(roots)}`);
      const made = expectStatus(await s.call("files.folder.create", admin, { idempotencyKey: "golden-6-folder", parentId: parent, name: "Studio" }), 200, "files.folder.create").folder.folderId as string;
      expectStatus(await s.call("files.create", admin, { idempotencyKey: "golden-6-file", folderId: made, name: "index.html", mime: "text/html", content: { text: "<h1>Studio</h1>" } }), 200, "files.create");
      return made;
    });
    const site = await trail.step("a site is made, not yet served", async () => {
      const made = expectStatus(await s.call("sites.create", admin, { idempotencyKey: "golden-6-site", name: "Studio", access: "public", folderId: folder! }), 200, "sites.create").site;
      assert.equal(made.live, false);
      assert.equal((await fetch(`${s.d.url}/p/${made.slug}/`)).status, 404, "nothing is served before it is published");
      return made as { siteId: string; slug: string };
    }, ["a folder holds the page"]);
    await trail.step("the person presses Publish, their own yes, and a visitor with no session gets the page in the sandbox", async () => {
      expectStatus(await s.call("sites.promote", admin, { idempotencyKey: "golden-6-promote", siteId: site!.siteId }), 200, "sites.promote");
      const got = expectStatus(await s.call("sites.get", admin, { siteId: site!.siteId }), 200, "sites.get").site;
      assert.equal(got.live, true, short(got));
      const r = await fetch(`${s.d.url}/p/${site!.slug}/`, { headers: { cookie: "s=1", authorization: `Bearer ${admin}` } });
      assert.equal(r.status, 200);
      assert.equal(await r.text(), "<h1>Studio</h1>");
      assert.match(String(r.headers.get("content-security-policy")), /sandbox allow-scripts/);
      assert.ok(!String(r.headers.get("content-security-policy")).includes("allow-same-origin"));
    }, ["a site is made, not yet served"]);
    await trail.step("stopping it takes it down", async () => {
      expectStatus(await s.call("sites.stop", admin, { idempotencyKey: "golden-6-stop", siteId: site!.siteId }), 200, "sites.stop");
      assert.equal((await fetch(`${s.d.url}/p/${site!.slug}/`)).status, 404);
    }, ["the person presses Publish, their own yes, and a visitor with no session gets the page in the sandbox"]);
    await trail.step("an artifact is private: its owner opens it, a member it is not shared with cannot", async () => {
      const pub = expectStatus(await s.call("sites.artifact_publish", admin, { idempotencyKey: "golden-6-art", title: "Numbers", html: "<p>42</p>" }), 200, "sites.artifact_publish");
      const open = expectStatus(await s.call("sites.artifact_open", admin, { idempotencyKey: "golden-6-open", artifactId: pub.artifactId }), 200, "sites.artifact_open");
      const r = await fetch(`${s.d.url}${open.path}`);
      assert.equal(await r.text(), "<p>42</p>");
      assert.match(String(r.headers.get("content-security-policy")), /sandbox allow-scripts/);
      const other = s.signedIn("usr_noah");
      const seen = await s.call("sites.artifact_open", other, { idempotencyKey: "golden-6-open-bob", artifactId: pub.artifactId });
      assert.ok(seen.status === 403 || seen.status === 404, `a member it is not shared with is refused: ${seen.status} ${short(seen.body)}`);
      const again = expectStatus(await s.call("sites.artifact_publish", admin, { idempotencyKey: "golden-6-art2", title: "Numbers", html: "<p>43</p>" }), 200, "sites.artifact_publish");
      assert.equal(again.artifactId, pub.artifactId, "the same title updates the same link");
      assert.equal(await (await fetch(`${s.d.url}${open.path}`)).text(), "<p>43</p>");
    }, ["a site is made, not yet served"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runSite([]);
  if (trail.failures.length) throw new Error(`flow 6 failed:\n${trail.report()}`);
  return events;
}
