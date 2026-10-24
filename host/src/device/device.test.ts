// The device role: parsing --role and what each role runs.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRoles, planFor, RoleError } from "./index.ts";

test("parseRoles accepts space, device and both, in any order, once each", () => {
  assert.deepEqual(parseRoles("space"), ["space"]);
  assert.deepEqual(parseRoles("device"), ["device"]);
  assert.deepEqual(parseRoles("device,space"), ["space", "device"]);
  assert.deepEqual(parseRoles(" Space , space ,DEVICE"), ["space", "device"]);
});

test("parseRoles names the allowed values when it refuses", () => {
  for (const bad of ["", " , ", "server", "space;device", "space device"]) {
    assert.throws(() => parseRoles(bad), RoleError, bad);
  }
  assert.throws(() => parseRoles("relay"), /Use space, device or space,device/);
});

test("a device-only daemon reports four probes, serves nothing and connects outward", () => {
  const p = planFor(["device"]);
  assert.deepEqual(p.probes, ["disk_encrypted", "scheduler", "disk_space", "time_skew"]);
  assert.deepEqual(p.services, ["connection-manager", "vault-filler", "local-turns", "terminal", "chrome-bridge", "device-replica"]);
  assert.deepEqual([p.needsSpace, p.serves, p.connectsOut], [false, false, true]);
});

test("a space daemon reports all eight probes, serves and needs a Space", () => {
  const p = planFor(["space"]);
  assert.equal(p.probes.length, 8);
  assert.deepEqual(p.services, ["gateway", "caddy", "docker", "log-sink", "sync-server"]);
  assert.deepEqual([p.needsSpace, p.serves, p.connectsOut], [true, true, false]);
});

test("space and device together run both sets of services once", () => {
  const p = planFor(parseRoles("space,device"));
  assert.equal(p.probes.length, 8);
  assert.equal(new Set(p.services).size, p.services.length);
  assert.equal(p.services.length, 11);
  assert.deepEqual([p.roles, p.needsSpace, p.serves, p.connectsOut], [["space", "device"], true, true, true]);
});

// P-L7b_04 final run: each named test shows its own ok line in the run on the last commit.
