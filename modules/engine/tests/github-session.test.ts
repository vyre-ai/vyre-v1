// GitHub for a CLI engine's process: the Space's git address and a proxy token for that process alone, never a GitHub token, and nothing when there is nothing to give.
import test from "node:test";
import assert from "node:assert/strict";
import { githubEnv, reposOfThread, withGithub } from "../github-session.ts";
import type { GithubSessionPort, GitProxyPort } from "../github-session.ts";
import { withGitHost } from "../session.ts";

type Called = { cap: string; input: Record<string, unknown>; as?: string | undefined };
function rig(o: { scope?: string; remotes?: Array<{ url: string }>; connected?: boolean; needsReconnect?: boolean; noGit?: boolean; base?: string } = {}) {
  const called: Called[] = [], minted: Array<Record<string, unknown>> = [], revoked: string[] = [];
  const git: GitProxyPort = {
    mint: (s) => { minted.push(s as never); return { token: "vgp_session_one", expiresAt: Date.now() + 3_600_000 }; },
    revoke: (t) => { revoked.push(t); },
    base: () => o.base ?? "https://space.vyre.test",
    serve: () => false,
  };
  const port: GithubSessionPort & { git?: GitProxyPort } = {
    async call(cap, input, as) {
      called.push({ cap, input: input as Record<string, unknown>, as });
      if (cap === "threads.get") return { thread: o.scope === "none" ? { scopeType: "space" } : { scopeType: "project", scopeId: "prj_site" } };
      if (cap === "projects.get") return { project: { folderId: "fld_site" } };
      if (cap === "git.status") return { remotes: o.remotes ?? [{ name: "origin", url: "https://github.com/northwind/site.git" }, { url: "https://gitlab.com/x/y.git" }, { url: "https://github.com/northwind/site" }] };
      if (cap === "github.me.status") return { connected: o.connected ?? true, needsReconnect: o.needsReconnect ?? false };
      throw new Error(`no ${cap}`);
    },
    ...(o.noGit ? {} : { git }),
  };
  return { port, called, minted, revoked };
}

test("the repositories are the GitHub remotes of the chat's project folder, once each", async () => {
  const r = rig();
  assert.deepEqual(await reposOfThread(r.port.call, "usr_maya", "thr_1"), ["northwind/site"]);
  assert.deepEqual(r.called.map((c) => [c.cap, c.as]), [["threads.get", "usr_maya"], ["projects.get", "usr_maya"], ["git.status", "usr_maya"]]);
  assert.deepEqual(await reposOfThread(rig({ scope: "none" }).port.call, "usr_maya", "thr_2"), []);
});

test("the environment points git at the Space with a proxy token, and holds no GitHub token", async () => {
  const r = rig();
  const g = await githubEnv(r.port, "usr_maya", "thr_1", "agt_coder");
  const env = g.env;
  assert.equal(env["VYRE_GIT_TOKEN"], "vgp_session_one");
  assert.equal(env["GH_TOKEN"], undefined, "no GitHub token under any name");
  assert.equal(env["GITHUB_TOKEN"], undefined);
  assert.equal(Object.values(env).some((v) => /gh[spuor]_/.test(v)), false);
  assert.equal(env["GIT_CONFIG_COUNT"], "3");
  assert.equal(env["GIT_CONFIG_KEY_0"], "url.https://space.vyre.test/git/github/.insteadOf");
  assert.equal(env["GIT_CONFIG_VALUE_0"], "https://github.com/");
  assert.equal(env["GIT_CONFIG_KEY_1"], "credential.https://space.vyre.test/git/github/.helper");
  assert.equal(env["GIT_CONFIG_VALUE_1"], "", "the helpers git would try first are cleared for this address only");
  assert.match(env["GIT_CONFIG_VALUE_2"]!, /password=\$VYRE_GIT_TOKEN/);
  assert.deepEqual(r.minted, [{ person: "usr_maya", agentId: "agt_coder", threadId: "thr_1", repos: ["northwind/site"], via: "address" }]);
  assert.deepEqual(r.revoked, []);
  g.end();
  assert.deepEqual(r.revoked, ["vgp_session_one"], "the token ends with the process");
});

test("behind the wall the session names the git address the wall answers itself, so a loopback-only Space works", async () => {
  const r = rig({ base: "http://127.0.0.1:41800" });
  const g = await githubEnv(r.port, "usr_maya", "thr_1", "agt_coder", "socket");
  assert.equal(g.env["GIT_CONFIG_KEY_0"], "url.http://vyre-git.invalid/git/github/.insteadOf");
  assert.equal(g.env["GIT_CONFIG_KEY_1"], "credential.http://vyre-git.invalid/git/github/.helper");
  assert.equal(Object.values(g.env).some((v) => v.includes("127.0.0.1")), false, "the loopback address is never named to the engine");
  assert.equal((await githubEnv(rig({ base: "" }).port, "usr_maya", "thr_1", "agt_coder", "socket")).env["VYRE_GIT_TOKEN"], "vgp_session_one", "no address is needed to name the wall's own");
});

test("nothing is given when the chat has no linked repository, GitHub is not connected, or there is no git address", async () => {
  for (const r of [rig({ scope: "none" }), rig({ connected: false }), rig({ needsReconnect: true }), rig({ noGit: true }), rig({ base: "" }), rig({ remotes: [{ url: "https://gitlab.com/x/y.git" }] })]) {
    const g = await githubEnv(r.port, "usr_maya", "thr_1");
    assert.deepEqual(g.env, {});
    assert.deepEqual(r.minted, []);
  }
});

test("withGithub sets the variables on the spawn last and leaves a spawn with none alone", () => {
  const spec = { argv: ["claude"], env: { PATH: "/bin", VYRE_GIT_TOKEN: "stale" } };
  assert.equal(withGithub(spec, {}), spec);
  assert.deepEqual(withGithub(spec, { VYRE_GIT_TOKEN: "new" }).env, { PATH: "/bin", VYRE_GIT_TOKEN: "new" });
});

test("a wall that lists hosts lets the Space's own address through, and never a loopback one", () => {
  const rule = (r: unknown) => ({ argv: ["claude"], env: { VYRE_EGRESS_RULE: JSON.stringify(r) } as Record<string, string> });
  const out = (spec: { env: Record<string, string> }) => JSON.parse(spec.env[Object.keys(spec.env)[0]!]!) as { allow?: string[] };
  assert.deepEqual(out(withGitHost(rule({ egress: "list", allow: ["api.anthropic.com"] }) as never, "https://space.vyre.test")).allow, ["api.anthropic.com", "space.vyre.test"]);
  assert.deepEqual(out(withGitHost(rule({ egress: "list", allow: ["space.vyre.test"] }) as never, "https://space.vyre.test")).allow, ["space.vyre.test"]);
  for (const base of ["http://127.0.0.1:41800", "http://localhost:41800", "http://[::1]:41800", "not a url"]) assert.deepEqual(out(withGitHost(rule({ egress: "list", allow: ["a"] }) as never, base)).allow, ["a"], base);
  assert.deepEqual(out(withGitHost(rule({ egress: "public" }) as never, "https://space.vyre.test")), { egress: "public" });
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
