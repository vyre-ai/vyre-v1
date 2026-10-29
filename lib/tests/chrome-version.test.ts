import test from "node:test";
import assert from "node:assert/strict";
import { chromeVersion, withReleaseVersion } from "../chrome-version.ts";

test("a release becomes a version Chrome accepts and a name people read", () => {
  assert.deepEqual(chromeVersion("1.0.0"), { version: "1.0.0", version_name: "1.0.0" });
  assert.deepEqual(chromeVersion("1.0.0-rc.3"), { version: "1.0.0.3", version_name: "1.0.0-rc.3" });
  assert.deepEqual(chromeVersion("1.2.3-beta.12"), { version: "1.2.3.12", version_name: "1.2.3-beta.12" });
  assert.deepEqual(chromeVersion("0.0.0-rc.1"), { version: "0.0.0.1", version_name: "0.0.0-rc.1" });
  assert.equal(chromeVersion("2.0.0-alpha").version, "2.0.0.0");
  for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "99999.0.0", "1.0.0-rc.70000", ""]) assert.throws(() => chromeVersion(bad), bad);
});

test("the manifest text keeps everything but the version, and gains version_name only for a name that differs", () => {
  const text = JSON.stringify({ manifest_version: 3, name: "Vyre for Chrome", version: "0.0.0", key: "abc", permissions: ["storage"] });
  const out = JSON.parse(withReleaseVersion(text, "1.0.0-rc.3")) as Record<string, unknown>;
  assert.deepEqual(out, { manifest_version: 3, name: "Vyre for Chrome", version: "1.0.0.3", version_name: "1.0.0-rc.3", key: "abc", permissions: ["storage"] });
  assert.deepEqual(Object.keys(out), ["manifest_version", "name", "version", "version_name", "key", "permissions"], "the order is kept");
  assert.equal(JSON.parse(withReleaseVersion(JSON.stringify({ ...out }), "1.0.0")).version_name, "1.0.0", "an earlier version_name is replaced");
});
