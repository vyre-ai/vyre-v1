// One rule in three places: a bare vyre/... image name is never fetched from a registry, because Docker would look for it on Docker Hub, where that namespace is not Vyre's.
// The modules ask sandbox/src/docker.ts (fetchableImage) before a fetch; the runner refuses the same fetch in host/src/sites-runner/policy.ts (LOCAL_ONLY); and what a host falls back to
// when no setting names an image (host/src/seams/release-images.ts) is always on Vyre's own registry. The layers cannot import each other, so this file holds them together.
import test from "node:test";
import assert from "node:assert/strict";
import { fetchableImage } from "../sandbox/src/docker.ts";
import { LOCAL_ONLY } from "../host/src/sites-runner/policy.ts";
import { LOCAL_IMAGE, releaseImage } from "../host/src/seams/release-images.ts";

test("what falls back is always fetchable from Vyre's own registry, and a local build name never is", () => {
  for (const kind of ["agent-workspace", "vyre-browser", "agent-computer"] as const) {
    assert.equal(fetchableImage(releaseImage(kind, "1.0.0-rc.25", "")), true, kind);
    assert.equal(fetchableImage(LOCAL_IMAGE[kind]), false, `${LOCAL_IMAGE[kind]} would be looked for on Docker Hub`);
  }
});

test("the modules' rule and the runner's rule are one rule", () => {
  const names = [
    "vyre/agent-workspace:1", "vyre/space-browser:1", "vyre/agent-computer:1", "vyre/anything:latest", `vyre/agent-workspace@sha256:${"a".repeat(64)}`,
    "docker.io/vyre/agent-workspace:1", "index.docker.io/vyre/space-browser:1",
    "ghcr.io/vyre-ai/agent-workspace:1.0.0", `ghcr.io/vyre-ai/vyre-browser@sha256:${"b".repeat(64)}`, "ghcr.io/vyre-ai/agent-computer:1.0.0-rc.24",
    "postgres:16-alpine", "registry.example.com/vyre/agent-workspace:1", "myvyre/agent-workspace:1", "ghcr.io/vyre/agent-workspace:1",
  ];
  for (const n of names) assert.equal(LOCAL_ONLY.test(n), !fetchableImage(n), n);
  assert.equal(fetchableImage("vyre/agent-workspace:1"), false);
  assert.equal(fetchableImage("registry.example.com/vyre/agent-workspace:1"), true, "a registry a person named is theirs to trust");
  assert.equal(fetchableImage("myvyre/agent-workspace:1"), true, "another namespace is not this rule's business (the runner's image list refuses it)");
});
