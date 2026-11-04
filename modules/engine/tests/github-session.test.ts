// GitHub for a CLI engine's process: the broker's token, from the chat's project repositories, in the environment of that process only, and nothing when there is nothing to give.
import test from "node:test";
import assert from "node:assert/strict";
import { githubEnv, reposOfThread, withGithub } from "../github-session.ts";
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
