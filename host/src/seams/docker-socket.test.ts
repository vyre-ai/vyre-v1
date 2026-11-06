// Which container runtime a person's own computer has: the first socket that exists, DOCKER_HOST first, and nothing when there is none.
import test from "node:test";
import assert from "node:assert/strict";
import { findDockerSocket, socketCandidates } from "./docker-socket.ts";

const has = (...paths: string[]) => (p: string): boolean => paths.includes(p);

test("each runtime is found at its own socket, in a fixed order", () => {
  const o = { home: "/Users/dana", platform: "darwin" as const, env: {} };
  assert.deepEqual(findDockerSocket({ ...o, exists: has("/var/run/docker.sock", "/Users/dana/.colima/default/docker.sock") }), { path: "/var/run/docker.sock", runtime: "Docker" });
  assert.deepEqual(findDockerSocket({ ...o, exists: has("/Users/dana/.docker/run/docker.sock") }), { path: "/Users/dana/.docker/run/docker.sock", runtime: "Docker Desktop" });
  assert.deepEqual(findDockerSocket({ ...o, exists: has("/Users/dana/.colima/default/docker.sock") }), { path: "/Users/dana/.colima/default/docker.sock", runtime: "Colima" });
  assert.deepEqual(findDockerSocket({ ...o, exists: has("/Users/dana/.orbstack/run/docker.sock") }), { path: "/Users/dana/.orbstack/run/docker.sock", runtime: "OrbStack" });
  assert.deepEqual(findDockerSocket({ ...o, exists: has("/Users/dana/.rd/docker.sock") }), { path: "/Users/dana/.rd/docker.sock", runtime: "Rancher Desktop" });
  assert.equal(findDockerSocket({ ...o, exists: has() }), null, "no runtime: nothing");
});

test("DOCKER_HOST wins when it names a unix socket that exists, and is ignored when it names anything else", () => {
  const o = { home: "/h", platform: "linux" as const, uid: 1000 };
  assert.deepEqual(findDockerSocket({ ...o, env: { DOCKER_HOST: "unix:///opt/d.sock" }, exists: has("/opt/d.sock", "/var/run/docker.sock") }), { path: "/opt/d.sock", runtime: "the Docker engine named by DOCKER_HOST" });
  assert.equal(findDockerSocket({ ...o, env: { DOCKER_HOST: "tcp://10.0.0.5:2375" }, exists: has() }), null, "a remote engine is never used for a workspace");
  assert.deepEqual(findDockerSocket({ ...o, env: { DOCKER_HOST: "unix:///opt/gone.sock" }, exists: has("/var/run/docker.sock") }), { path: "/var/run/docker.sock", runtime: "Docker" });
});

test("Linux also tries rootless Docker; Windows has the one named pipe", () => {
  assert.deepEqual(findDockerSocket({ home: "/home/d", platform: "linux", uid: 1001, env: {}, exists: has("/run/user/1001/docker.sock") }), { path: "/run/user/1001/docker.sock", runtime: "rootless Docker" });
  assert.deepEqual(socketCandidates({ platform: "win32", env: {} }).map((c) => c.path), ["\\\\.\\pipe\\docker_engine"]);
});
