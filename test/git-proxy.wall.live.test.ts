// The git door as a walled engine reaches it, on a booted daemon (lane l-hooks-gitproxy): the daemon's own port for the engine's wall (d.gitPort), behind an egress proxy that answers the git name itself,
// the way a bubblewrap or Seatbelt engine's proxy does. A token made for the wall works there and nowhere else; a token made for the address works at the address and not through the wall.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import { createEgressProxy } from "../sandbox/src/egress.ts";
import { GIT_LOCAL_HOST } from "../modules/engine/github-session.ts";
import { fakeGithubGit } from "../host/tests/helpers/fake-github-git.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("a walled engine's token is honoured through the wall's own answer on the daemon, and only there", { timeout: 60_000 }, async () => {
  const gh = await fakeGithubGit(["vyre-ai/website"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gitwall-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_gitwall", "--space-name", "Space", "--space-kind", "personal"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "gitwall", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => "x", signRs256: async () => "" },
    gitUpstream: gh.url,
  });
  const wall = createEgressProxy({ allow: [], rule: { egress: "list", allow: [] }, local: () => ({ host: GIT_LOCAL_HOST, handle: (q, r) => d.gitPort.serve(q, r) }) });
  const { port } = await wall.listen();
  const viaWall = (token: string): Promise<{ status: number; text: string }> => new Promise((done, fail) => {
    const target = `http://${GIT_LOCAL_HOST}/git/github/other-org/secret.git/info/refs?service=git-upload-pack`;
    const r = http.request({ host: "127.0.0.1", port, path: target, headers: { host: GIT_LOCAL_HOST, authorization: `Basic ${Buffer.from(`vyre:${token}`).toString("base64")}` } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => done({ status: res.statusCode ?? 0, text: t })); });
    r.on("error", fail); r.end();
  });
  const atAddress = async (token: string): Promise<number> => (await fetch(`${d.url}/git/github/other-org/secret.git/info/refs?service=git-upload-pack`, { headers: { authorization: `Basic ${Buffer.from(`vyre:${token}`).toString("base64")}` } })).status;
  try {
    const walled = d.gitPort.mint({ person: "usr_a", agentId: "agt_a", threadId: "thr_1", repos: ["vyre-ai/website"], via: "socket" }).token;
    const plain = d.gitPort.mint({ person: "usr_a", agentId: "agt_a", threadId: "thr_1", repos: ["vyre-ai/website"], via: "address" }).token;
    const ok = await viaWall(walled);
    assert.equal(ok.status, 403, ok.text);
    assert.match(ok.text, /read only the repositories of its chat/, "the proxy itself answered: the token was honoured and the repository judged");
    assert.equal((await viaWall(plain)).status, 401, "an address token is refused through the wall");
    assert.equal(await atAddress(walled), 401, "a wall token is refused at the public address");
    assert.equal(await atAddress(plain), 403, "an address token is honoured at the address");
    assert.equal(gh.seen.length, 0, "nothing reached the stand-in GitHub");
  } finally { await wall.close(); await d.stop(); await gh.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
