// The Grok worker harness end to end with fakes: a stub tracker over HTTP, a bare scratch origin, a fake grok binary and a fake gh.
// A fake grok that edits a forbidden path is rejected and nothing is pushed; an allowed edit passes CI verification and posts its proof.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.resolve(here, "../grok-run.py");
const python = spawnSync("python3", ["--version"]).status === 0;

type Call = { method: string; url: string; body: any };
const ID = { good: "P-T1", bad: "P-T2" };

function packet(id: string, status = "ready") {
  return {
    id, status, lane_id: "L4", title: "demo packet", owns_files: ["notes/**"],
    checklist: [
      { id: 1, pos: 1, kind: "build", text: "Write the note", done: 0 },
      { id: 2, pos: 2, kind: "test", text: "Write and pass scripts/workers/tests-grok/demo.test.ts", done: 0 },
      { id: 3, pos: 3, kind: "proof", text: "Post the test run output for the files above as proof", done: 0 },
    ],
    approvals: [], comments: [],
  };
}

async function stubTracker(): Promise<{ url: string; calls: Call[]; close(): void }> {
  const calls: Call[] = [];
  const state: Record<string, string> = { [ID.good]: "ready", [ID.bad]: "ready" };
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = req.url ?? "";
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method ?? "", url, body });
      const send = (data: unknown, text = false) => { res.setHeader("content-type", text ? "text/plain" : "application/json"); res.end(text ? String(data) : JSON.stringify({ data })); };
      let m: RegExpExecArray | null;
      if ((m = /^\/api\/packets\/([\w-]+)\/(\w+)$/.exec(url)) && req.method === "POST") {
        if (m[2] === "submit") state[m[1]!] = "done"; // the lead approves at once so the merge thread finishes
        return send({});
      }
      if ((m = /^\/api\/packets\/([\w-]+)$/.exec(url))) return send(packet(m[1]!, state[m[1]!]));
      if ((m = /^\/api\/brief\/([\w-]+)$/.exec(url))) return send(`brief for ${m[1]}`, true);
      send({});
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(srv.address() as any).port}`, calls, close: () => srv.close() };
}

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function script(file: string, body: string) { fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return file; }

async function scenario(id: string, grokBody: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-h-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "Irfad Imtiaz", GIT_AUTHOR_EMAIL: "irfadimtiaz7@gmail.com", GIT_COMMITTER_NAME: "Irfad Imtiaz", GIT_COMMITTER_EMAIL: "irfadimtiaz7@gmail.com", GIT_CONFIG_GLOBAL: "/dev/null" };
  const origin = path.join(root, "origin.git"), seed = path.join(root, "seed");
  sh("git", ["init", "--bare", "-b", "main", origin], root, env);
  sh("git", ["clone", "-q", origin, seed], root, env);
  fs.writeFileSync(path.join(seed, "README.md"), "# scratch\n");
  sh("git", ["add", "."], seed, env); sh("git", ["commit", "-q", "-m", "chore: seed"], seed, env); sh("git", ["push", "-q", "origin", "main"], seed, env);
  const grok = script(path.join(root, "grok"), grokBody);
  const gh = script(path.join(root, "gh"), `
case "$1 $2" in
  "run list") sha=$(git rev-parse HEAD); echo "[{\\"databaseId\\":7,\\"headSha\\":\\"$sha\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\",\\"url\\":\\"https://ci.example/runs/7\\"}]";;
  "run view") echo "ok   scripts/workers/tests-grok/demo.test.ts 12 ms";;
  "pr create") echo "https://example/pr/1";;
  "pr merge") echo merged;;
esac`);
  const tracker = await stubTracker();
  const logs = path.join(root, "logs");
  const child = spawn("python3", [RUN, "one", "--packet", id, "--repo", seed, "--wt-root", path.join(root, "wt"), "--grok-bin", grok, "--no-sandbox", "--merge-poll", "0", "--ci-poll", "0", "--retries", "1", "--actor", "test-harness"], {
    env: { ...env, VYRE_TRACKER_URL: tracker.url, VYRE_TRACKER_TOKEN: "t", VYRE_GH: gh, VYRE_HARNESS_LOG: logs }, stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  const code: number = await new Promise((r) => child.on("close", r));
  const branches = sh("git", ["branch", "--list", "-a"], origin, env);
  const start = out.indexOf("\n{\n") + 1, end = out.indexOf("\n}\n", start) + 2;
  const result = start > 0 && end > start ? out.slice(start, end) : "";
  tracker.close();
  return { code, out, calls: tracker.calls, branches, result: (() => { try { return JSON.parse(result); } catch { return null; } })(), root };
}

const GOOD = `mkdir -p notes; echo hello > notes/a.md; git add notes/a.md; git commit -q -m "feat: add note" -- notes/a.md; mkdir -p .harness; echo '{"done":[1],"evidence":{"1":"wrote notes/a.md"},"summary":"added a note"}' > .harness/report.json; echo '{"usage":{"input_tokens":1000,"output_tokens":200}}'`;
const BAD = `mkdir -p notes; echo a > notes/a.md; echo oops >> README.md; git add notes README.md; git commit -q -m "feat: both"; echo '{"usage":{"input_tokens":10,"output_tokens":5}}'`;

test("an allowed edit passes, CI-verified tests are ticked, proof and usage are posted, the packet is submitted and merged", { skip: !python }, async () => {
  const s = await scenario(ID.good, GOOD);
  assert.equal(s.code, 0, s.out);
  assert.equal(s.result?.ok, true, s.out);
  assert.deepEqual(s.result.files, ["notes/a.md"]);
  assert.match(s.branches, /packet\/P-T1/, "branch pushed to origin");
  const post = (u: RegExp) => s.calls.filter((c) => c.method === "POST" && u.test(c.url));
  assert.deepEqual(post(/\/proofs$/).map((c) => [c.body.kind, c.body.result]), [["test_run", "pass"]]);
  assert.equal(post(/\/proofs$/)[0]!.body.ref, "https://ci.example/runs/7");
  assert.equal(post(/\/api\/usage$/)[0]!.body.tokens_in, 1000);
  assert.equal(post(/\/api\/usage$/)[0]!.body.lane, "L4");
  const ticked = s.calls.filter((c) => c.method === "PATCH").map((c) => c.url).sort();
  assert.deepEqual(ticked, ["/api/checklist/1", "/api/checklist/2", "/api/checklist/3"]);
  assert.equal(post(/\/submit$/).length, 1);
  assert.ok(s.calls.some((c) => /\/api\/comments$/.test(c.url) && /squash-merged/.test(c.body.body)), "merge comment posted");
  assert.equal(post(/\/block$/).length, 0);
});

test("a fake grok that edits a forbidden path is rejected: blocked, nothing pushed, no proof, no submit", { skip: !python }, async () => {
  const s = await scenario(ID.bad, BAD);
  assert.equal(s.result?.ok, false, s.out);
  assert.match(s.result.error, /owns_files violation: \['README\.md'\]/);
  assert.doesNotMatch(s.branches, /packet\/P-T2/, "violating work never reaches origin");
  const posts = s.calls.filter((c) => c.method === "POST").map((c) => c.url);
  assert.ok(posts.some((u) => /\/block$/.test(u)));
  assert.ok(!posts.some((u) => /\/(submit|proofs)$/.test(u)));
  const block = s.calls.find((c) => /\/block$/.test(c.url))!;
  assert.match(block.body.reason, /owns_files violation/);
});

test("deny-rules.json keeps the rules the harness relies on", () => {
  const r = JSON.parse(fs.readFileSync(path.resolve(here, "../deny-rules.json"), "utf8"));
  for (const d of ["Bash(node:*)", "Bash(npm:*)", "Bash(git push:*)", "Bash(git reset:*)", "Bash(gh pr merge:*)", "Bash(curl:*)", "Read(~/Claude/simba/**)"]) assert.ok(r.deny.includes(d), d);
  assert.ok(r.secret_paths.includes("~/.ssh") && r.secret_paths.includes("~/Claude/simba/secrets"));
  assert.ok(new RegExp(r.env_strip).test("RAILWAY_TOKEN") && !new RegExp(r.env_strip).test("PATH"));
});
