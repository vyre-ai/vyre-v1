// An artifact opens at a one-time code for its own host (never the app's origin): framed in the app it asks for the partitioned cookie, opened in a browser it does not.
import test from "node:test";
import assert from "node:assert/strict";
import { artifactAddress, plainLink } from "./artifact-address.ts";

test("the artifact host's code is framed with ?embed=1 and opened in a browser as it is; the code is not framed with it outside the host", () => {
  const code = "a".repeat(48);
  const open = { path: `/x/${code}`, url: `https://mla-a.vyre.run/x/${code}` };
  assert.equal(artifactAddress(open, "https://mla.vyre.run", true), `https://mla-a.vyre.run/x/${code}?embed=1`);
  assert.equal(artifactAddress(open, "https://mla.vyre.run"), `https://mla-a.vyre.run/x/${code}`);
});

test("the link to copy is the plain /a/<id> on the app, never a one-time code or a keyed address", () => {
  assert.equal(plainLink("https://mla.vyre.run/", "sit_1"), "https://mla.vyre.run/a/sit_1");
});
