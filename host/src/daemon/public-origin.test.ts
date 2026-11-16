import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactHostOf, publicOriginOf, spaceBaseOf } from "./public-origin.ts";

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
  // the owner's Space on rc.26: address northwind.vyre.run, DNS straight at its own server, no phone name held at the relay
  assert.deepEqual(publicOriginOf("northwind.vyre.run", null), { origin: "https://northwind.vyre.run", relay: false });
  assert.deepEqual(publicOriginOf("https://northwind.vyre.run/", null), {
    origin: "https://northwind.vyre.run",
    relay: false,
  });
  assert.equal(
    artifactHostOf("northwind.vyre.run", null),
    "a.northwind.vyre.run",
    "its own server answers a.<address>, the relay answers nothing for it",
  );
  // a phone name held for another label does not make this address a relay address
  assert.equal(publicOriginOf("northwind.vyre.run", "harbor")?.relay, false);
  assert.equal(artifactHostOf("northwind.vyre.run", "harbor"), "a.northwind.vyre.run");
  // the Space that does hold the name its address carries is reached through the relay
  assert.equal(publicOriginOf("harbor.vyre.run", "harbor")?.relay, true);
  assert.equal(artifactHostOf("harbor.vyre.run", "harbor"), "harbor-a.vyre.run");
  assert.equal(artifactHostOf("harbor.vyre.run", "HARBOR"), "harbor-a.vyre.run", "names compare without case");
});

test("the Space's base address is always one a URL can be made from: public origin, else the address given, else the local URL", () => {
  assert.equal(spaceBaseOf("team.example.com", null, "0.0.0.0", 8420), "https://team.example.com");
  assert.equal(spaceBaseOf(null, "harbor", "0.0.0.0", 8420), "https://harbor.vyre.run", "a claimed relay name");
  // a relay Space nobody has claimed a name for yet, started with an empty address setting (the Mac installer): the local URL, never "https://"
  for (const none of ["", "   ", null, undefined]) {
    const base = spaceBaseOf(none, null, "0.0.0.0", 8420);
    assert.equal(base, "http://0.0.0.0:8420");
    assert.equal(new URL(base).origin, "http://0.0.0.0:8420");
  }
  assert.equal(new URL(spaceBaseOf("", null, "::", 8420)).port, "8420", "an IPv6 host is bracketed");
  assert.equal(spaceBaseOf("", null, "", 9000), "http://127.0.0.1:9000");
});
