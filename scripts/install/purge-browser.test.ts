// `--uninstall --purge` and the Space browser (lead 12 Nov; fifth look): one container and one volume serve every Space on a Docker engine. A purge removes only THIS Space's profiles (browserd's
// purge_space closes their browsers and deletes their folders); the container, its volume and its network go only when nothing else is on the volume and no other install is on the engine. Proved here
// with a stand-in `docker` that records what it is asked and answers as browserd would (the real two-Space run is sbrowser.purge.heavy.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// PURGE_ANSWER: what browserd's purge_space answers ("" = it cannot be asked)
const FAKE = `#!/bin/sh
echo "$*" >> "$DOCKER_LOG"
case "$1" in
  inspect) case "$*" in *State.Running*) echo true ;; *Mounts*) echo "vyre-sbrowser-data " ;; esac; exit 0 ;;
  exec) [ -n "$PURGE_ANSWER" ] || exit 3; echo "$PURGE_ANSWER"; exit 0 ;;
  network) case "$2" in ls) echo n_browser ;; esac; exit 0 ;;
esac
exit 0
`;

function run(os_: "linux" | "macos", answer: string, otherInstalls: "0" | "1"): { asked: string[]; out: string } {
  const script = path.join(HERE, os_, "install.sh");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-purge-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "docker"), FAKE, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const log = path.join(dir, "docker.log");
  try {
    const r = spawnSync("sh", ["-c", `. "${script}"\npurge_browser spc_mine`], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, VYRE_SOURCE_ONLY: "1", VYRE_TEST_MODE: "1", VYRE_TEST_OS: os_ === "linux" ? "Linux" : "Darwin", DOCKER_LOG: log, PURGE_ANSWER: answer, VYRE_TEST_OTHER_INSTALLS: otherInstalls } });
    assert.equal(r.status, 0, r.stderr);
    return { asked: fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [], out: r.stdout };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const removedAll = (asked: string[]): boolean => asked.includes("rm -f vyre-sbrowser") && asked.includes("volume rm -f vyre-sbrowser-data") && asked.includes("network rm n_browser");
const removedAny = (asked: string[]): boolean => asked.some((a) => /^rm -f|^volume rm|^network rm/.test(a));

for (const os_ of ["linux", "macos"] as const) {
  test(`${os_}: a purge asks browserd to remove only this Space's profiles, by its Space id`, () => {
    const { asked } = run(os_, '{"removed":2,"others":0,"unmarked":0}', "0");
    assert.ok(asked.some((a) => a === 'exec vyre-sbrowser /opt/browserd/ctl purge_space {"spaceId":"spc_mine"}'), asked.join(" | "));
  });
  test(`${os_}: another Space's profiles on the volume: the container, its volume and its network stay, and the purge says so`, () => {
    const { asked, out } = run(os_, '{"removed":2,"others":3,"unmarked":0}', "0");
    assert.equal(removedAny(asked), false, asked.join(" | "));
    assert.match(out, /Removed this Space's 2 agent browser profiles\. The Space browser stays: it also holds 3 other profiles/);
  });
  test(`${os_}: profiles that name no Space (made before Spaces were written down, perhaps another Space's): the container and the volume stay`, () => {
    const { asked, out } = run(os_, '{"removed":1,"others":0,"unmarked":2}', "0");
    assert.equal(removedAny(asked), false, asked.join(" | "));
    assert.match(out, /it also holds 2 other profiles/);
  });
  test(`${os_}: another install on the engine: they stay too, though nothing else is on the volume yet`, () => {
    assert.equal(removedAny(run(os_, '{"removed":1,"others":0,"unmarked":0}', "1").asked), false);
  });
  test(`${os_}: nothing else on the volume and no other install: the container, the volume and the network go`, () => {
    assert.equal(removedAll(run(os_, '{"removed":1,"others":0,"unmarked":0}', "0").asked), true);
  });
  test(`${os_}: browserd cannot be asked: everything goes only when this install is the engine's only one`, () => {
    assert.equal(removedAll(run(os_, "", "0").asked), true);
    const shared = run(os_, "", "1");
    assert.equal(removedAny(shared.asked), false);
    assert.match(shared.out, /left as it is/);
  });
  test(`${os_}: uninstall calls it only for a purge, after compose's own removal`, () => {
    const text = fs.readFileSync(path.join(HERE, os_, "install.sh"), "utf8");
    assert.match(text.slice(text.indexOf("\nuninstall() {")), /if \[ "\$PURGE" = 1 \] && \[ "\$DRY" != 1 \]; then purge_browser; fi/);
    assert.match(text, /space_id_of\(\) \{\n[^\n]*space_db query "\$DATA_DIR\/space\/events\.db"/, "the Space id is read through space_db, the one way to open a database");
  });
}
