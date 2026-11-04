// @nocache  (real git and a real child process)
// The GitHub token a session held never reaches a commit or the repository config: a process given the token writes it into a file and into .git/config (a remote with the token in its address), and the crew's
// commit-leftovers path cleans both first. Real git in temp folders, a real child process standing in for the CLI.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { commitLeftovers, git, prepareClone } from "../crew-git.ts";
import { forgetSecrets, holdSecret } from "../../../agent/src/drivers/cli/redact.ts";

const T = "ghs_gitTOKEN0123456789abcdefABCDEFxyz";   // secret-scan: fake
const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-crew-redact-")));
const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

test("commit leftovers: the token a process wrote into a file and into .git/config is in no commit and no config", async () => {
  forgetSecrets();
  holdSecret(T, Date.now() + 60_000);
  const src = tmp();
  await git(["init", "--quiet", "-b", "main"], src);
  fs.writeFileSync(path.join(src, "README.md"), "hello\n");
  await git(["add", "-A"], src, ID);
  assert.equal((await git(["commit", "--quiet", "-m", "first"], src, ID)).code, 0);
  const dest = path.join(tmp(), "work");
  await prepareClone({ repo: src, dest, branch: "crew/ember-1", base: "main", ident: { name: "Ember", email: "ember@vyre.invalid" } });

  // the "CLI": it has GH_TOKEN, saves its environment to a file, adds a remote with the token in the address, and writes a script that curls with it
  const script = `
    const fs = require("node:fs");
    fs.writeFileSync("env.txt", "GH_TOKEN=" + process.env.GH_TOKEN + "\\n");
    fs.writeFileSync("deploy.sh", "curl -H 'Authorization: Bearer " + process.env.GH_TOKEN + "' https://api.github.com/user\\n");
    require("node:child_process").execFileSync("git", ["remote", "add", "tokenized", "https://x-access-token:" + process.env.GH_TOKEN + "@github.com/northwind/site.git"]);
  `;
  const ran = spawnSync(process.execPath, ["-e", script], { cwd: dest, env: { ...process.env, GH_TOKEN: T }, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(fs.readFileSync(path.join(dest, ".git", "config"), "utf8").includes(T), true, "the process really did put the token in the config");

  assert.equal(await commitLeftovers(dest, "work of the teammate"), true);

  assert.equal(fs.readFileSync(path.join(dest, ".git", "config"), "utf8").includes(T), false, "not in the repository config");
  const history = await git(["log", "--all", "-p", "--format=%H %s"], dest);
  assert.equal(history.code, 0);
  assert.equal(history.out.includes(T), false, "not in any commit");
  assert.match(history.out, /GH_TOKEN=\[token\]/, "the file was committed with the token taken out");
  const everything = spawnSync("git", ["grep", "-I", T, "--", "."], { cwd: dest, encoding: "utf8" });
  assert.equal(everything.status, 1, "git finds the token nowhere in the tree");
  const objects = spawnSync("sh", ["-c", `git rev-list --all --objects | cut -d' ' -f1 | git cat-file --batch | grep -c ${T} || true`], { cwd: dest, encoding: "utf8" });
  assert.equal(objects.stdout.trim(), "0", "not in any object of the repository");
  forgetSecrets();
});
