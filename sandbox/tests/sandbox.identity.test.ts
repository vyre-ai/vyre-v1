// The person inside a bubblewrap sandbox has a name, and no more than that (owner, 13 Nov 2026: an agent reported "uid 1000, it has no name entry, so whoami printed an error"). The sandbox bound the
// system read only but had no /etc/passwd or /etc/group, so the user that runs it was only a number. The host's own files would show the code every account of the machine, so both wrappers bind a
// generated two-user passwd and group (agent and nobody) instead, and a real bubblewrap run answers `whoami` and `id -un` with `agent`.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
process.env["TMPDIR"] = "/tmp";   // the generated files are under the system temp folder: a user other than the server's must be able to pass through it in the real run
const { bwrapCommand } = await import("../src/bwrap.ts");
const { groupOf, passwdOf } = await import("../src/identity.ts");
const { bwrapWallCommand } = await import("../src/net/bwrap.ts");
const { ROOTS, spec } = await import("./helpers.ts");

const who = { uid: 4242, gid: 4343 };
const bound = (args: readonly string[], dest: string): string | undefined => { const i = args.findIndex((a, k) => a === dest && args[k - 2] === "--ro-bind-try"); return i < 0 ? undefined : args[i - 1]; };

test("both bubblewrap wrappers bind a generated passwd and group, never the host's", () => {
  const base = fs.mkdtempSync(path.join("/tmp", "vyre-identity-unit-"));
  try {
    const plain = bwrapCommand(spec({ scratch: path.join(base, "scratch") } as never), { ...ROOTS, scratch: [base] }, ["whoami"], { proxyPort: 4040, identity: who });
    const walled = bwrapWallCommand(spec(), ROOTS, ["whoami"], { wallDir: base, identity: who });
    for (const [what, w] of [["the proxied sandbox", plain], ["the walled sandbox", walled]] as const) {
      for (const [dest, text] of [["/etc/passwd", passwdOf(who)], ["/etc/group", groupOf(who)]] as const) {
        const file = bound(w.args, dest);
        assert.ok(file, `${what} binds ${dest}`);
        assert.notEqual(file, dest, `${what}: ${dest} is not the host's own file`);
        assert.equal(fs.readFileSync(file!, "utf8"), text, `${what}: ${dest} is the generated one`);
      }
      assert.ok(!w.args.some((a, i) => a === "/etc/passwd" && w.args[i - 1] === "/etc/passwd"), `${what} does not bind the host's /etc/passwd`);
    }
    assert.match(passwdOf(who), /^agent:x:4242:4343:agent:\/home\/agent:\/bin\/sh\nnobody:/);
    assert.equal(passwdOf(who).split("\n").filter(Boolean).length, 2, "two users and nothing of the host");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

const linux = process.platform === "linux";
test("in a real bubblewrap run `whoami`, `id -un` and `id -gn` say agent, and the host's accounts are not there", { skip: linux ? false : "needs Linux" }, () => {
  // not a skip when bubblewrap is missing on Linux: the proof is the point of this test
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bubblewrap is installed (the Linux runners have it)");
  const base = fs.mkdtempSync(path.join("/tmp", "vyre-identity-"));
  fs.chmodSync(base, 0o755);
  const dir = path.join(base, "work");
  fs.mkdirSync(dir, { mode: 0o755 });
  const scratch = path.join(base, "scratch");
  fs.mkdirSync(scratch, { mode: 0o755 });
  try {
    const roots = { work: [base], scratch: [base] };
    const w = bwrapCommand(spec({ mounts: [{ host: dir, mode: "ro" }], scratch } as never), roots, ["/usr/bin/sh", "-c", "whoami; id -un; id -gn; cat /etc/passwd | wc -l; id -u"], { identity: { uid: 1000, gid: 1000 } });
    // an ordinary user, as the daemon is: root maps itself differently
    const asUser = process.getuid?.() === 0 ? ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", w.cmd, ...w.args] : [w.cmd, ...w.args];
    const r = spawnSync(asUser[0]!, asUser.slice(1), { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" } });
    assert.equal(r.status, 0, `the sandbox ran (${r.stderr.slice(0, 300)})`);
    assert.equal(r.stdout, "agent\nagent\nagent\n2\n1000\n", `${JSON.stringify(r.stdout)} ${r.stderr.slice(0, 200)}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
