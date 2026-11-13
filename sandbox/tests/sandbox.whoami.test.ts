// Owner, 13 Nov 2026 (lane f-agentpc, P7 section 10 item 1): an agent's CLI shell inside the bubblewrap sandbox must answer `whoami`. On origin/int/rc27 the sandbox binds no /etc/passwd, so the user
// that runs it is only a number and `whoami` prints "whoami: cannot find name for user ID 1000". A real bubblewrap run, as an ordinary user (the daemon is not root).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bwrapCommand } from "../src/bwrap.ts";
import { spec } from "./helpers.ts";

const linux = process.platform === "linux";
test(
  "in a real bubblewrap run `whoami` and `id -un` answer with a name",
  { skip: linux ? false : "needs Linux" },
  () => {
    assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bubblewrap is installed (the Linux runners have it)");
    const base = fs.mkdtempSync(path.join("/tmp", "vyre-whoami-"));
    fs.chmodSync(base, 0o755);
    const dir = path.join(base, "work");
    fs.mkdirSync(dir, { mode: 0o755 });
    const scratch = path.join(base, "scratch");
    fs.mkdirSync(scratch, { mode: 0o755 });
    try {
      const w = bwrapCommand(
        spec({ mounts: [{ host: dir, mode: "ro" }], scratch } as never),
        { work: [base], scratch: [base] },
        ["/usr/bin/sh", "-c", "whoami 2>&1; id -un 2>&1"],
      );
      const asUser =
        process.getuid?.() === 0
          ? ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", w.cmd, ...w.args]
          : [w.cmd, ...w.args];
      const r = spawnSync(asUser[0]!, asUser.slice(1), {
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
      });
      assert.equal(r.stdout, "agent\nagent\n", `${JSON.stringify(r.stdout)} ${r.stderr.slice(0, 200)}`);
      assert.equal(r.status, 0, "the sandbox ran");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
);
