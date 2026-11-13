// The person inside a bubblewrap sandbox has a name (owner, 13 Nov 2026: an agent reported "uid 1000, it has no name entry, so whoami printed an error"). The sandbox bound the system read only but not
// /etc/passwd or /etc/group, so the user that runs it, mapped in as itself, was only a number: `id` printed no names and `whoami` failed with "cannot find name for user ID". Both wrappers bind the two files
// (read only, world readable, no passwords in them), and a real bubblewrap run answers `whoami` and `id -un`.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bwrapCommand } from "../src/bwrap.ts";
import { bwrapWallCommand } from "../src/net/bwrap.ts";
import { ROOTS, spec } from "./helpers.ts";

const binds = (args: readonly string[]): string[] => args.flatMap((a, i) => (args[i - 1] === "--ro-bind-try" ? [a] : []));

test("both bubblewrap wrappers bind /etc/passwd and /etc/group read only, so the user has a name", () => {
  const plain = bwrapCommand(spec(), ROOTS, ["whoami"], { proxyPort: 4040 });
  const walled = bwrapWallCommand(spec(), ROOTS, ["whoami"], { wallDir: "/srv/vyre/scratch/dana/wall" });
  for (const [what, w] of [["the proxied sandbox", plain], ["the walled sandbox", walled]] as const) {
    const b = binds(w.args);
    assert.ok(b.includes("/etc/passwd"), `${what} binds /etc/passwd`);
    assert.ok(b.includes("/etc/group"), `${what} binds /etc/group`);
    for (const f of ["/etc/passwd", "/etc/group"]) assert.ok(w.args.every((a, i) => a !== f || w.args[i - 1] === "--ro-bind-try" || w.args[i - 1] === f), `${what} binds ${f} read only`);
  }
});

/** The first ordinary user of this computer (uid 1000 and up), who is what a sandbox started by that user runs as. */
function ordinaryUser(): { uid: number; gid: number; name: string } | null {
  for (const line of fs.readFileSync("/etc/passwd", "utf8").split("\n")) {
    const f = line.split(":");
    const uid = Number(f[2]), gid = Number(f[3]);
    if (f[0] && uid >= 1000 && uid < 60000 && Number.isInteger(gid)) return { uid, gid, name: f[0] };
  }
  return null;
}

test("in a real bubblewrap run `whoami` and `id -un` answer with the user's name", { skip: process.platform !== "linux" || spawnSync("bwrap", ["--version"]).status !== 0 ? "needs Linux with bubblewrap" : false }, () => {
  const user = ordinaryUser();
  if (!user) return;
  // under /tmp, not the runner's own temp folder: the user it runs as has to reach it
  const base = fs.mkdtempSync(path.join("/tmp", "vyre-identity-"));
  fs.chmodSync(base, 0o755);
  const dir = path.join(base, "work");
  fs.mkdirSync(dir, { mode: 0o755 });
  try {
    const roots = { work: [base], scratch: [base] };
    const w = bwrapCommand(spec({ mounts: [{ host: dir, mode: "ro" }] }), roots, ["/usr/bin/sh", "-c", "whoami; id -un; id -gn"], {});
    // run as an ordinary user, as the daemon does: root maps itself differently, so only a non-root caller shows what a sandbox user sees
    const asUser = process.getuid?.() === 0 ? ["setpriv", `--reuid=${user.uid}`, `--regid=${user.gid}`, "--clear-groups", w.cmd, ...w.args] : [w.cmd, ...w.args];
    const r = spawnSync(asUser[0]!, asUser.slice(1), { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
    assert.equal(r.status, 0, `the sandbox ran (${r.stderr.slice(0, 300)})`);
    assert.match(r.stdout, new RegExp(`^${user.name}\\n${user.name}\\n`), `whoami and id -un say ${user.name}: ${JSON.stringify(r.stdout)} ${r.stderr.slice(0, 200)}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
