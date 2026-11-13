// The generated passwd and group are never written where the sandbox can reach (second review, 13 Nov 2026). The first version wrote them into the scratch folder, which the sandbox binds read-write: code
// in the sandbox could plant a symlink at the path the next spawn writes, and the server would overwrite whatever it pointed at. Now they live in a folder of the server's own that no sandbox binds.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
process.env["TMPDIR"] = "/tmp";   // the folder is under the system temp folder: a user other than the server's must be able to pass through it in this test
const { bwrapCommand } = await import("../src/bwrap.ts");
const { ROOTS, spec } = await import("./helpers.ts");

const linux = process.platform === "linux";
test("code in the sandbox cannot make the next spawn write through a planted symlink, and identity still works", { skip: linux ? false : "needs Linux" }, () => {
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bubblewrap is installed (the Linux runners have it)");
  const base = fs.mkdtempSync("/tmp/vyre-identity-plant-");
  fs.chmodSync(base, 0o755);
  const scratch = path.join(base, "scratch");
  const work = path.join(base, "work");
  fs.mkdirSync(scratch, { mode: 0o777 }); fs.chmodSync(scratch, 0o777);
  fs.mkdirSync(work, { mode: 0o755 });
  const victim = path.join(base, "victim.txt");
  fs.writeFileSync(victim, "VICTIM\n");
  try {
    const roots = { work: [base], scratch: [base] };
    const run = (script: string) => {
      const w = bwrapCommand(spec({ mounts: [{ host: work, mode: "ro" }], scratch } as never), roots, ["/usr/bin/sh", "-c", script], { identity: { uid: 1000, gid: 1000 } });
      const as = process.getuid?.() === 0 ? ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", w.cmd, ...w.args] : [w.cmd, ...w.args];
      return spawnSync(as[0]!, as.slice(1), { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
    };
    // the sandbox plants links at every path an earlier version wrote: the identity folder of the scratch, and the generic ones
    const plant = run(`for d in ${scratch}/.identity-1000-1000 ${scratch}; do mkdir -p $d; ln -sf ${victim} $d/passwd; ln -sf ${victim} $d/group; done; echo planted`);
    assert.equal(plant.status, 0, plant.stderr);
    // the next spawn: the server builds the command again (and, in the first version, wrote through the link)
    const next = run("whoami; id -un");
    assert.equal(fs.readFileSync(victim, "utf8"), "VICTIM\n", "the file the link pointed at is unchanged");
    assert.equal(next.stdout, "agent\nagent\n", `identity still works: ${JSON.stringify(next.stdout)} ${next.stderr.slice(0, 200)}`);
    assert.ok(!fs.existsSync(path.join(scratch, ".identity-1000-1000", "passwd")) || fs.lstatSync(path.join(scratch, ".identity-1000-1000", "passwd")).isSymbolicLink(), "the server wrote nothing into the scratch folder");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
