// Lead, 12 Nov: `--uninstall --purge` left the Space browser's container and its profiles volume (every agent's sign-ins) on the server: the daemon makes them, not compose, so compose's down and its
// project label never named them. Both installers now remove them by the Space browser's own label. Proved with a stand-in `docker` that records what it is asked (no real Docker is touched).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = `#!/bin/sh
echo "$*" >> "$DOCKER_LOG"
case "$1 $2" in
  "ps -aq") case "$*" in *vyre.sbrowser=1*) echo c_browser ;; esac ;;
  "inspect -f") echo "vyre-sbrowser-data " ;;
  "network ls") case "$*" in *vyre.sbrowser=1*) echo n_browser ;; esac ;;
esac
exit 0
`;

for (const os_ of ["linux", "macos"] as const) {
  test(`${os_}: a purge removes the Space browser's container, its profiles volume and its network; a plain uninstall leaves the volume`, () => {
    const script = path.join(HERE, os_, "install.sh");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-purge-"));
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "docker"), FAKE, { mode: 0o755 });
    const log = path.join(dir, "docker.log");
    try {
      const r = spawnSync("sh", ["-c", `. "${script}"\npurge_browser`], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: os_ === "linux" ? "Linux" : "Darwin", DOCKER_LOG: log } });
      assert.equal(r.status, 0, r.stderr);
      const asked = fs.readFileSync(log, "utf8").trim().split("\n");
      assert.ok(asked.includes("rm -f c_browser"), `the browser's container is removed: ${asked.join(" | ")}`);
      assert.ok(asked.includes("volume rm -f vyre-sbrowser-data"), "and the volume it mounts, with every agent's sign-ins");
      assert.ok(asked.includes("network rm n_browser"), "and its network");
      assert.ok(asked.indexOf("rm -f c_browser") < asked.indexOf("volume rm -f vyre-sbrowser-data"), "the container goes first (a volume in use cannot be removed)");
      // uninstall calls it only for a purge, after compose's own removal
      const text = fs.readFileSync(script, "utf8");
      const body = text.slice(text.indexOf("\nuninstall() {"));
      assert.match(body, /if \[ "\$PURGE" = 1 \] && \[ "\$DRY" != 1 \]; then purge_browser; fi/);
      assert.equal((text.match(/purge_browser/g) ?? []).length, 2, "defined once, called once (only under --purge)");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
