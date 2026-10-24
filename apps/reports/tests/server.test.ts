// The process end to end over real HTTP on a port the system picks: settings, a signing key kept across a restart, the report database kept on disk,
// the size cap, and the retry the process runs. GitHub, the team Space and the reporter Space are the same recorded answers as in the contract test.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMessage, reportMessage, sha256hex, utf8 } from "../src/crypto.ts";
import { start } from "../src/main.ts";
import type { HttpLike } from "../src/github.ts";
import { ISSUE, WEBHOOK_SECRET, makeSpace, reportBody } from "./harness.ts";
import type { Space } from "./harness.ts";

const get = globalThis.fetch.bind(globalThis);

function outbound(): { fn: HttpLike; calls: string[]; githubOk: { value: boolean } } {
  const calls: string[] = [];
  const githubOk = { value: true };
  const fn: HttpLike = async (url) => {
    calls.push(url);
    const github = url.startsWith("https://api.github.com/");
    const status = github ? (githubOk.value ? 201 : 500) : 200;
    const body = github ? JSON.stringify(ISSUE) : JSON.stringify({ data: { record: { id: "rec_team1" } } });
    return { status, ok: status < 300, text: async () => body };
  };
  return { fn, calls, githubOk };
}

const envFor = (dir: string): Record<string, string> => ({
  PORT: "0", REPORTS_DATA_DIR: dir, REPORTS_PUBLIC_URL: "http://127.0.0.1", REPORTS_ALLOW_INSECURE: "1", GITHUB_TOKEN: "ghp_test", GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
  TEAM_SPACE_URL: "https://team.vyre.test", TEAM_SPACE_TOKEN: "svc_team", REPORTS_PER_IP: "1000",
});

async function register(base: string, space: Space): Promise<number> {
  const body = utf8(JSON.stringify({ spaceId: space.spaceId, publicKey: space.publicKey, webhook: space.webhook }));
  const ts = String(Date.now());
  const sig = await space.sign(registerMessage(ts, await sha256hex(body)));
  return (await get(`${base}/v1/spaces`, { method: "POST", headers: { "x-vyre-ts": ts, "x-vyre-sig": sig }, body })).status;
}

async function post(base: string, space: Space, body: Uint8Array): Promise<{ status: number; json: { data?: Record<string, unknown>; error?: { code: string } } }> {
  const ts = String(Date.now());
  const sig = await space.sign(reportMessage(ts, await sha256hex(body)));
  const res = await get(`${base}/v1/reports`, { method: "POST", headers: { "x-vyre-space": space.spaceId, "x-vyre-ts": ts, "x-vyre-sig": sig }, body });
  return { status: res.status, json: (await res.json()) as never };
}

test("process: serves health and its key, takes a registered Space's report, and answers the size cap and unknown routes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vyre-reports-"));
  const out = outbound();
  const running = await start(envFor(dir), { outbound: out.fn, retryMs: 3_600_000 });
  const base = `http://127.0.0.1:${running.port}`;
  try {
    assert.deepEqual(await (await get(`${base}/healthz`)).json(), { data: { ok: true } });
    const key = ((await (await get(`${base}/v1/key`)).json()) as { data: { publicKey: string } }).data.publicKey;
    assert.equal(key.length, 43, "a 32-byte public key, base64url");
    const alpha = await makeSpace("spc_alpha1");
    assert.equal(await register(base, alpha), 201);
    const res = await post(base, alpha, reportBody("rpt_aaaaaaaa1"));
    assert.equal(res.status, 201);
    assert.equal(res.json.data?.issueNumber, 1234);
    assert.equal(out.calls.filter((u) => u.startsWith("https://api.github.com/")).length, 1);
    assert.equal((await get(`${base}/nope`)).status, 404);
    assert.equal((await get(`${base}/v1/reports`)).status, 404);
    const big = await get(`${base}/v1/reports`, { method: "POST", body: new Uint8Array(4 * 1024 * 1024 + 10) });
    assert.equal(big.status, 413);
    assert.equal((await post(base, alpha, utf8("not json"))).status, 400);
    const stranger = await makeSpace("spc_nobody1");
    assert.equal((await post(base, stranger, reportBody("rpt_aaaaaaaa2"))).status, 401);
  } finally {
    await running.close();
  }
});

test("process: the signing key and the reports survive a restart, and a report sent again is the same issue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vyre-reports-"));
  const out = outbound();
  const alpha = await makeSpace("spc_alpha1");
  let first = await start(envFor(dir), { outbound: out.fn, retryMs: 3_600_000 });
  let base = `http://127.0.0.1:${first.port}`;
  const keyBefore = ((await (await get(`${base}/v1/key`)).json()) as { data: { publicKey: string } }).data.publicKey;
  assert.equal(await register(base, alpha), 201);
  assert.equal((await post(base, alpha, reportBody("rpt_aaaaaaaa1"))).status, 201);
  await first.close();
  const saved = JSON.parse(await readFile(join(dir, "signing-key.json"), "utf8")) as { pkcs8: string };
  assert.ok(saved.pkcs8.length > 40);

  first = await start(envFor(dir), { outbound: out.fn, retryMs: 3_600_000 });
  base = `http://127.0.0.1:${first.port}`;
  try {
    const keyAfter = ((await (await get(`${base}/v1/key`)).json()) as { data: { publicKey: string } }).data.publicKey;
    assert.equal(keyAfter, keyBefore, "Spaces keep verifying the same service key");
    await new Promise((r) => setTimeout(r, 5));
    const again = await post(base, alpha, reportBody("rpt_aaaaaaaa1"));
    assert.equal(again.status, 201, "the Space is still registered");
    assert.equal(again.json.data?.issueNumber, 1234);
    assert.equal(out.calls.filter((u) => u.startsWith("https://api.github.com/")).length, 1, "no second issue after the restart");
  } finally {
    await first.close();
  }
});

test("process: a report GitHub could not take is finished by the retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vyre-reports-"));
  const out = outbound();
  out.githubOk.value = false;
  const alpha = await makeSpace("spc_alpha1");
  const running = await start(envFor(dir), { outbound: out.fn, retryMs: 3_600_000 });
  const base = `http://127.0.0.1:${running.port}`;
  try {
    assert.equal(await register(base, alpha), 201);
    const kept = await post(base, alpha, reportBody("rpt_aaaaaaaa1"));
    assert.equal(kept.status, 202);
    assert.equal(kept.json.data?.issueNumber, null);
    out.githubOk.value = true;
    assert.equal(await running.retry(), 1, "the retry opens the issue and files the record");
    const db = JSON.parse(await readFile(join(dir, "reports.json"), "utf8")) as { reports: Record<string, { issueNumber: number | null; teamRecordId: string | null }> };
    assert.equal(db.reports["rpt_aaaaaaaa1"]?.issueNumber, 1234);
    assert.equal(db.reports["rpt_aaaaaaaa1"]?.teamRecordId, "rec_team1");
  } finally {
    await running.close();
  }
});

test("process: settings that are missing stop it with a sentence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vyre-reports-"));
  await assert.rejects(start({ ...envFor(dir), GITHUB_TOKEN: "" }), /GITHUB_TOKEN is not set/);
  await assert.rejects(start({ PORT: "0" }), /REPORTS_PUBLIC_URL is not set/);
});
