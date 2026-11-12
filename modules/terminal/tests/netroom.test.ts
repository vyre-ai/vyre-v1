// The count of networks a host's Docker has left (12 Nov), from the subnets of the networks it has.
import test from "node:test";
import assert from "node:assert/strict";
import { networkRoom, networkRoomFinding, siteRoom } from "../netroom.ts";

test("Docker's default pools hold 31 networks; each network in them takes one; a subnet of one's own outside them takes none", () => {
  assert.deepEqual(networkRoom([]), { used: 0, total: 31, left: 31 });
  assert.deepEqual(networkRoom(["172.17.0.0/16"]), { used: 1, total: 31, left: 30 }, "the default bridge");
  assert.deepEqual(networkRoom(["172.17.0.0/16", "172.18.0.0/16", "192.168.0.0/20", "192.168.16.0/20"]), {
    used: 4,
    total: 31,
    left: 27,
  });
  assert.deepEqual(
    networkRoom(["10.9.0.0/24", "fd00::/64", "nonsense"]),
    { used: 0, total: 31, left: 31 },
    "outside the pools, or not IPv4",
  );
  assert.equal(networkRoom(["192.168.0.0/16"]).used, 16, "a network made over a whole pool takes all its blocks");
  const full = networkRoom([
    ...Array.from({ length: 15 }, (_, i) => `172.${17 + i}.0.0/16`),
    ...Array.from({ length: 16 }, (_, i) => `192.168.${i * 16}.0/20`),
  ]);
  assert.deepEqual(full, { used: 31, total: 31, left: 0 });
});

test("server health says how many are left, and is degraded with a next step when fewer than five are", () => {
  const ok = networkRoomFinding({ used: 3, total: 31, left: 28 }, "Nothing to do.");
  assert.equal(ok.state, "healthy");
  assert.equal(
    ok.detail,
    "Docker on this server has about 28 of 31 networks left. Each site takes one; agent workspaces share one.",
  );
  const low = networkRoomFinding({ used: 28, total: 31, left: 3 }, "Nothing to do.");
  assert.equal(low.state, "degraded");
  assert.match(low.next, /^Remove sites you no longer use/);
});

test("sites have a range of their own: 4096 /28s of 10.213.0.0/16, counted apart from Docker's pools, and health says how many more sites fit", () => {
  assert.deepEqual(siteRoom([]), { used: 0, total: 4096, left: 4096 });
  assert.deepEqual(siteRoom(["10.213.0.0/28", "10.213.0.16/28", "172.18.0.0/16"]), {
    used: 2,
    total: 4096,
    left: 4094,
  });
  assert.equal(networkRoom(["10.213.0.0/28"]).used, 0, "a site's /28 takes nothing of Docker's pools");
  const f = networkRoomFinding(networkRoom(["172.17.0.0/16"]), "No action needed.", siteRoom(["10.213.0.0/28"]));
  assert.equal(
    f.detail,
    "Room for 4095 more sites (of 4096). Docker on this server has about 30 of 31 other networks left; agent workspaces share one.",
  );
  assert.equal(f.state, "healthy");
});
