// A variable the installer writes to compose.env is only an interpolation value for docker compose: the daemon inside the container sees it only if compose.server.yml passes it into vyred's environment.
// Round 6 shipped two such variables (VYRE_DOCKER_ROOT_DIR and _STATE) that the daemon reads and nothing passed on, so a finding never reached the Console. This guards the class: every VYRE_ variable written to
// compose.env by the installers or vyre-server AND read by the daemon's config must be named in the vyred service's environment.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (f: string): string => fs.readFileSync(root + f, "utf8");

const written = (): Set<string> => {
  const out = new Set<string>();
  for (const f of ["scripts/install/linux/install.sh", "scripts/install/macos/install.sh", "scripts/install/linux/vyre-server"]) {
    // printf 'VYRE_X=%s\n' ... and VYRE_X=%s inside a printf that goes to compose.env (also several in one format string)
    for (const line of read(f).split("\n")) if (/printf\s+'[^']*VYRE_[A-Z_]+=/.test(line) && !/vyre\.env|node\.env/.test(line)) for (const m of line.matchAll(/(VYRE_[A-Z_]+)=%s/g)) out.add(m[1]!);
  }
  return out;
};
const readByDaemon = (): Set<string> => new Set([...read("host/src/daemon/config.ts").matchAll(/env\["(VYRE_[A-Z_]+)"\]/g)].map((m) => m[1]!));
const vyredEnvironment = (): Set<string> => {
  const yml = read("images/vyred/compose.server.yml");
  const start = yml.indexOf("  vyred:");
  const env = yml.indexOf("    environment:", start);
  const end = yml.indexOf("\n    env_file:", env);
  return new Set([...yml.slice(env, end).matchAll(/^\s{6}(VYRE_[A-Z_]+):/gm)].map((m) => m[1]!));
};

test("every compose.env variable the daemon's config reads is passed into the vyred container", () => {
  const w = written(), r = readByDaemon(), passed = vyredEnvironment();
  assert.ok(w.size > 5 && r.size > 5 && passed.size > 5, "the three lists were read");
  const missing = [...w].filter((n) => r.has(n) && !passed.has(n));
  assert.deepEqual(missing, [], `written to compose.env and read by the daemon, but not in compose.server.yml's vyred environment: ${missing.join(", ")}`);
  // the two this round added are among them
  for (const n of ["VYRE_DOCKER_ROOT_DIR", "VYRE_DOCKER_ROOT_STATE", "VYRE_DISK_ENCRYPTION", "VYRE_NETWORK_REV"]) assert.ok(w.has(n) && r.has(n) && passed.has(n), n);
});
