// An artifact opens at a one-time code for its own host (never the app's origin): framed in the app it asks for the partitioned cookie, opened in a browser it does not.
import test from "node:test";
import assert from "node:assert/strict";
import { artifactAddress } from "./Artifacts.tsx";

test("the artifact host's code is framed with ?embed=1 and opened in a browser as it is; the keyed address of a Space with no artifact host is unchanged", () => {
  const code = "a".repeat(48);
  const open = { path: `/x/${code}`, url: `https://mla-a.vyre.run/x/${code}` };
  assert.equal(artifactAddress(open, "https://mla.vyre.run", true), `https://mla-a.vyre.run/x/${code}?embed=1`);
  assert.equal(artifactAddress(open, "https://mla.vyre.run"), `https://mla-a.vyre.run/x/${code}`);
  const keyed = { path: `/a/sit_1/k/${code}/`, url: `https://mla.vyre.run/a/sit_1/k/${code}/` };
  assert.equal(artifactAddress(keyed, undefined, true), keyed.url);
  assert.equal(artifactAddress({ path: "/a/sit_1/k/t/" }, "https://x.test/", true), "https://x.test/a/sit_1/k/t/");
});
