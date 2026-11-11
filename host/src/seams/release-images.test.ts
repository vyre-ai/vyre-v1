// Which image a host asks Docker for when no setting names one (release-images.ts). The rule that a bare vyre/... name is never fetched is held together with the modules' copy in test/image-fetch.rule.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_IMAGE, releaseImage } from "./release-images.ts";
import { LOCAL_ONLY } from "../sites-runner/policy.ts";

test("the image a host asks for: the setting when it names one, else this release's own image on ghcr.io/vyre-ai by version, else the local build name", () => {
  const digest = `ghcr.io/vyre-ai/agent-workspace@sha256:${"c".repeat(64)}`;
  assert.equal(releaseImage("agent-workspace", "1.0.0-rc.25", digest), digest, "a setting wins");
  assert.equal(releaseImage("agent-workspace", "1.0.0-rc.25", " vyre/agent-workspace:test "), "vyre/agent-workspace:test", "also a local name a person chose, trimmed");
  // a server whose update tool is older than the release never wrote the line: compose hands the daemon an empty string
  assert.equal(releaseImage("agent-workspace", "1.0.0-rc.25", ""), "ghcr.io/vyre-ai/agent-workspace:1.0.0-rc.25");
  assert.equal(releaseImage("vyre-browser", "1.0.0-rc.25", undefined), "ghcr.io/vyre-ai/vyre-browser:1.0.0-rc.25", "the Space browser's registry name is vyre-browser");
  assert.equal(releaseImage("agent-computer", "1.0.0", "   "), "ghcr.io/vyre-ai/agent-computer:1.0.0");
  // no version (a unit test of a seam), or one that cannot be a tag: the local build name, which is never fetched
  for (const v of [undefined, "", "1.0.0+build.5", "-1", "a b"]) assert.equal(releaseImage("agent-workspace", v), LOCAL_IMAGE["agent-workspace"], String(v));
});

test("what falls back is never a name the runner refuses to fetch, and every local build name is one it refuses", () => {
  for (const kind of ["agent-workspace", "vyre-browser", "agent-computer"] as const) {
    assert.equal(LOCAL_ONLY.test(releaseImage(kind, "1.0.0-rc.25", "")), false, kind);
    assert.equal(LOCAL_ONLY.test(LOCAL_IMAGE[kind]), true, `${LOCAL_IMAGE[kind]} would be looked for on Docker Hub`);
  }
});
