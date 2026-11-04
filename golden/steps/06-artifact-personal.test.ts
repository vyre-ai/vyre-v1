// An artifact works in a Personal Space with no server: html goes in, the owner opens it, and it serves in the sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus } from "./02-space.ts";
import { LIVE_FOR_SITE, openArtifact } from "./06-site-deploy.ts";

test("golden 6: an artifact in a Personal Space with no server", async () => {
  const s = await bootFlowSpace(LIVE_FOR_SITE, { spaceKind: "personal" });
  try {
    const admin = s.d.token;
    const pub = expectStatus(await s.call("sites.artifact_publish", admin, { idempotencyKey: "p-art", title: "Notes", html: "<p>mine</p>" }), 200, "sites.artifact_publish");
    const open = expectStatus(await s.call("sites.artifact_open", admin, { idempotencyKey: "p-open", artifactId: pub.artifactId }), 200, "sites.artifact_open");
    const r = await openArtifact(s.d.url, open);
    assert.equal(r.body, "<p>mine</p>");
    assert.match(r.csp, /sandbox allow-scripts/);
    const listed = expectStatus(await s.call("sites.list", admin, { kind: "artifact" }), 200, "sites.list");
    assert.equal(listed.sites.length, 1);
  } finally { await s.stop(); }
});
