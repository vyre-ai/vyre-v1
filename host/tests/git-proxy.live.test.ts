// The git door on a booted daemon (lane l-hooks-gitproxy): the route is mounted ahead of the API, a request without a session token is turned away with git's own ask for a credential, and nothing
// reaches the stand-in GitHub. The pushes themselves are walked against real git in git-proxy.test.ts; this holds that the daemon serves the address at all.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import { fakeGithubGit } from "./helpers/fake-github-git.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("the daemon serves /git/github/ and turns away a request with no session", { timeout: 60_000 }, async () => {
  const gh = await fakeGithubGit(["vyre-ai/website"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gitlive-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_gitp", "--space-name", "Space", "--space-kind", "team"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "gitp", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => "x", signRs256: async () => "" },
    gitUpstream: gh.url,
  });
  try {
    const adv = await fetch(`${d.url}/git/github/vyre-ai/website.git/info/refs?service=git-receive-pack`);
    assert.equal(adv.status, 401);
    assert.match(adv.headers.get("www-authenticate") ?? "", /^Basic/);
    const wrong = await fetch(`${d.url}/git/github/vyre-ai/website.git/git-receive-pack`, { method: "POST", headers: { authorization: `Basic ${Buffer.from("vyre:vgp_unknown").toString("base64")}`, "content-type": "application/x-git-receive-pack-request" }, body: "0000" });
    assert.equal(wrong.status, 401);
    const gone = await fetch(`${d.url}/git/github/nothing`);
    assert.equal(gone.status, 404);
    assert.equal(gh.seen.length, 0, "nothing reached the stand-in GitHub");
  } finally { await d.stop(); await gh.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
