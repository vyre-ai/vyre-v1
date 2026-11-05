// GitHub for a CLI engine's process: the broker's token, from the chat's project repositories, in the environment of that process only, and nothing when there is nothing to give.
import test from "node:test";
import assert from "node:assert/strict";
import { GITHUB_SESSION_NOTE, githubEnv, reposOfThread, withGithub } from "../github-session.ts";
import type { GithubSessionPort } from "../github-session.ts";

type Called = { cap: string; input: Record<string, unknown>; as?: string | undefined };
function rig(o: { scope?: string; remotes?: Array<{ url: string }>; sessionEnv?: unknown; token?: string | null; fail?: boolean } = {}) {
  const called: Called[] = [];
  const port: GithubSessionPort = {
    async call(cap, input, as) {
      called.push({ cap, input: input as Record<string, unknown>, as });
      if (cap === "threads.get") return { thread: o.scope === "none" ? { scopeType: "space" } : { scopeType: "project", scopeId: "prj_site" } };
      if (cap === "projects.get") return { project: { folderId: "fld_site" } };
      if (cap === "git.status") return { remotes: o.remotes ?? [{ name: "origin", url: "https://github.com/northwind/site.git" }, { url: "https://gitlab.com/x/y.git" }, { url: "https://github.com/northwind/site" }] };
      if (cap === "github.session_env") {
        if (o.fail) throw Object.assign(new Error("no"), { error: { code: "validation.precondition_failed" } });
        return o.sessionEnv ?? { env: { GH_TOKEN: "#fill_abc", GITHUB_TOKEN: "#fill_abc" }, gitConfig: ["credential.https://github.com.helper=", "credential.https://github.com.helper=!f() { echo password=$GH_TOKEN; }; f"] };
      }
      throw new Error(`no ${cap}`);
    },
    fill: (h) => (o.token === null ? null : h === "#fill_abc" ? (o.token ?? "ghs_real") : null),
  };
  return { port, called };
}

test("the repositories are the GitHub remotes of the chat's project folder, once each", async () => {
  const r = rig();
  assert.deepEqual(await reposOfThread(r.port.call, "usr_maya", "thr_1"), ["northwind/site"]);
  assert.deepEqual(r.called.map((c) => [c.cap, c.as]), [["threads.get", "usr_maya"], ["projects.get", "usr_maya"], ["git.status", "usr_maya"]]);
  assert.deepEqual(await reposOfThread(rig({ scope: "none" }).port.call, "usr_maya", "thr_2"), []);
});

test("the environment has the token, the same for GITHUB_TOKEN, and git's own config variables for the helper", async () => {
  const r = rig();
  const env = await githubEnv(r.port, "usr_maya", "thr_1");
  assert.equal(env["GH_TOKEN"], "ghs_real");
  assert.equal(env["GITHUB_TOKEN"], "ghs_real");
  assert.equal(env["GIT_CONFIG_COUNT"], "2");
  assert.equal(env["VYRE_GITHUB_NOTE"], GITHUB_SESSION_NOTE, "the session is told in plain words that it cannot push yet and how to open a pull request");
  assert.match(env["VYRE_GITHUB_NOTE"]!, /github\.pull_request\.create/, "the tool it is pointed at exists");
  assert.ok(fs.readFileSync(new URL("../../../manifests/github.ts", import.meta.url), "utf8").includes("'github.pull_request.create'"), "and the capability is in the GitHub manifest");
  assert.equal(env["GIT_CONFIG_KEY_0"], "credential.https://github.com.helper");
  assert.equal(env["GIT_CONFIG_VALUE_0"], "");
  assert.match(env["GIT_CONFIG_VALUE_1"]!, /password=\$GH_TOKEN/);
  const call = r.called.find((c) => c.cap === "github.session_env")!;
  assert.deepEqual(call.input, { repos: ["northwind/site"], consumer: "session.engine" });
  assert.equal(call.as, "usr_maya", "as the person whose turn it is");
});

test("nothing is given when the chat has no linked repository, the policy asks first, or the token is gone", async () => {
  assert.deepEqual(await githubEnv(rig({ scope: "none" }).port, "usr_maya", "thr_1"), {});
  assert.deepEqual(await githubEnv(rig({ fail: true }).port, "usr_maya", "thr_1"), {});
  assert.deepEqual(await githubEnv(rig({ token: null }).port, "usr_maya", "thr_1"), {});
  assert.deepEqual(await githubEnv(rig({ remotes: [{ url: "https://gitlab.com/x/y.git" }] }).port, "usr_maya", "thr_1"), {});
});

test("withGithub sets the variables on the spawn last and leaves a spawn with none alone", () => {
  const spec = { argv: ["claude"], env: { PATH: "/bin", GH_TOKEN: "stale" } };
  assert.equal(withGithub(spec, {}), spec);
  assert.deepEqual(withGithub(spec, { GH_TOKEN: "new" }).env, { PATH: "/bin", GH_TOKEN: "new" });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactTree } from "../github-session.ts";

test("files a session wrote are cleaned of the token: a saved environment, a remote with the token in its address, a log; binaries, big files and node_modules are left", () => {
  const T = "ghs_fileTOKEN0123456789abcdefABCDEF";   // secret-scan: fake
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-redact-"));
  try {
    fs.mkdirSync(path.join(dir, ".git"));
    fs.mkdirSync(path.join(dir, "src", "deep"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "config"), `[remote "origin"]\n\turl = https://x-access-token:${T}@github.com/northwind/site.git\n`);
    fs.writeFileSync(path.join(dir, "env.txt"), `PATH=/bin\nGH_TOKEN=${T}\nGITHUB_TOKEN=${T}\n`);
    fs.writeFileSync(path.join(dir, "src", "deep", "run.log"), `curl -H "Authorization: Bearer ${T}"\n`);
    fs.writeFileSync(path.join(dir, "node_modules", "x", "a.js"), T);
    fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(T)]));
    fs.writeFileSync(path.join(dir, "clean.txt"), "nothing here");
    const changed = redactTree(dir, [T]).map((f) => path.relative(dir, f)).sort();
    assert.deepEqual(changed, [".git/config", "env.txt", path.join("src", "deep", "run.log")]);
    assert.equal(fs.readFileSync(path.join(dir, ".git", "config"), "utf8").includes(T), false);
    assert.match(fs.readFileSync(path.join(dir, "env.txt"), "utf8"), /GH_TOKEN=\[token\]/);
    assert.equal(fs.readFileSync(path.join(dir, "node_modules", "x", "a.js"), "utf8"), T, "installed packages are not touched");
    assert.deepEqual(redactTree(dir, [T]).length, 0, "nothing left to clean");
    assert.deepEqual(redactTree(path.join(dir, "gone"), [T]), []);
    assert.deepEqual(redactTree(dir, []), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
