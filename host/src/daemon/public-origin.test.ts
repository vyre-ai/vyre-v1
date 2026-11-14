import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactHostOf, publicOriginOf } from "./public-origin.ts";

test("the public origin: a given address wins, a claimed phone name stands in for none, and a phone address says so", () => {
  assert.deepEqual(publicOriginOf("team.example.com", "harbor"), { origin: "https://team.example.com", relay: false });
  assert.deepEqual(publicOriginOf("https://team.example.com/", null), {
    origin: "https://team.example.com",
    relay: false,
  });
  assert.deepEqual(publicOriginOf(null, "harbor"), { origin: "https://harbor.vyre.run", relay: true });
  assert.deepEqual(publicOriginOf("harbor.vyre.run", "harbor"), { origin: "https://harbor.vyre.run", relay: true });
  assert.equal(publicOriginOf(null, null), null);
});

test("the artifact host: <name>-a.vyre.run for a relay name, a.<domain> for an own domain, none where there is no public address", () => {
  assert.equal(artifactHostOf(null, "harbor"), "harbor-a.vyre.run");
  assert.equal(artifactHostOf("harbor.vyre.run", "harbor"), "harbor-a.vyre.run");
  assert.equal(
    artifactHostOf("team.example.com", "harbor"),
    "a.team.example.com",
    "an address the Space was given wins over a phone name",
  );
  assert.equal(artifactHostOf("https://team.example.com/", null), "a.team.example.com");
  assert.equal(
    artifactHostOf("http://127.0.0.1:4100", null),
    "a.localhost:4100",
    "a Space on this computer: *.localhost is loopback in every browser",
  );
  assert.equal(artifactHostOf("http://localhost:8420", null), "a.localhost:8420");
  for (const none of ["192.168.1.5", "https://team.example.com:8443", "http://team.example.com", "a.team.example.com"])
    assert.equal(artifactHostOf(none, null), null, none);
  assert.equal(artifactHostOf(null, null), null);
  assert.equal(artifactHostOf(null, "team-a"), null, "no one holds a name that ends in -a");
});

test("reached through the relay is a fact (the Space holds that phone name), never a guess from a .vyre.run ending", () => {
  // the owner's Space on rc.26: address mla.vyre.run, DNS straight at its own server, no phone name held at the relay
  assert.deepEqual(publicOriginOf("mla.vyre.run", null), { origin: "https://mla.vyre.run", relay: false });
  assert.deepEqual(publicOriginOf("https://mla.vyre.run/", null), { origin: "https://mla.vyre.run", relay: false });
  assert.equal(
    artifactHostOf("mla.vyre.run", null),
    "a.mla.vyre.run",
    "its own server answers a.<address>, the relay answers nothing for it",
  );
  // a phone name held for another label does not make this address a relay address
  assert.equal(publicOriginOf("mla.vyre.run", "harbor")?.relay, false);
  assert.equal(artifactHostOf("mla.vyre.run", "harbor"), "a.mla.vyre.run");
  // the Space that does hold the name its address carries is reached through the relay
  assert.equal(publicOriginOf("harbor.vyre.run", "harbor")?.relay, true);
  assert.equal(artifactHostOf("harbor.vyre.run", "harbor"), "harbor-a.vyre.run");
  assert.equal(artifactHostOf("harbor.vyre.run", "HARBOR"), "harbor-a.vyre.run", "names compare without case");
});
