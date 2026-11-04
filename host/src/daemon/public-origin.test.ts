import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactHostOf, publicOriginOf } from "./public-origin.ts";

test("the public origin: a given address wins, a claimed phone name stands in for none, and a phone address says so", () => {
  assert.deepEqual(publicOriginOf("team.example.com", "harbor"), { origin: "https://team.example.com", relay: false });
  assert.deepEqual(publicOriginOf("https://team.example.com/", null), { origin: "https://team.example.com", relay: false });
  assert.deepEqual(publicOriginOf(null, "harbor"), { origin: "https://harbor.vyre.run", relay: true });
  assert.deepEqual(publicOriginOf("harbor.vyre.run", null), { origin: "https://harbor.vyre.run", relay: true });
  assert.equal(publicOriginOf(null, null), null);
});

test("the artifact host: <name>-a.vyre.run for a relay name, a.<domain> for an own domain, none where there is no public address", () => {
  assert.equal(artifactHostOf(null, "harbor"), "harbor-a.vyre.run");
  assert.equal(artifactHostOf("harbor.vyre.run", null), "harbor-a.vyre.run");
  assert.equal(artifactHostOf("team.example.com", "harbor"), "a.team.example.com", "an address the Space was given wins over a phone name");
  assert.equal(artifactHostOf("https://team.example.com/", null), "a.team.example.com");
  for (const none of ["http://127.0.0.1:4100", "192.168.1.5", "https://team.example.com:8443", "localhost", "http://team.example.com", "a.team.example.com"]) assert.equal(artifactHostOf(none, null), null, none);
  assert.equal(artifactHostOf(null, null), null);
  assert.equal(artifactHostOf(null, "team-a"), null, "no one holds a name that ends in -a");
});
