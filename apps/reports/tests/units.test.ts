// The service's parts on their own: the limiter, the crypto it signs and verifies with, the bundle checks, the GitHub helpers, the stores and the settings.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RateLimit } from "../src/ratelimit.ts";
import { base64url, fromBase64url, generateSigningKey, hmacHex, loadSigningKey, safeEqual, sha256hex, sign, utf8, verify } from "../src/crypto.ts";
import { parseReport } from "../src/bundle.ts";
import { closedIssue, inline, issueBody, issueTitle, openIssue } from "../src/github.ts";
import type { Bundle } from "../src/bundle.ts";
import { DirObjectStore, FileDb, MemoryDb, MemoryObjectStore } from "../src/store.ts";
import type { ReportRow } from "../src/store.ts";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_LIMITS, webhookAllowed } from "../src/service.ts";
import { TRACE_A, bundle } from "./harness.ts";

test("rate limit: a window of hits per key, with the time to wait, and old keys are swept", () => {
  let now = 1_000_000;
  const rl = new RateLimit(2, 1000, () => now);
  assert.deepEqual(rl.take("a"), { ok: true, retryAfterSec: 0, remaining: 1 });
  now += 100;
  assert.deepEqual(rl.take("a"), { ok: true, retryAfterSec: 0, remaining: 0 });
  now += 100;
  const full = rl.take("a");
  assert.equal(full.ok, false);
  assert.equal(full.retryAfterSec, 1, "the oldest hit leaves in 800 ms: wait the next whole second");
  assert.equal(rl.take("b").ok, true, "another key has its own window");
  assert.equal(rl.take("a").ok, false, "a refused hit is not counted");
  now += 800;
  assert.equal(rl.take("a").ok, true, "the first hit has left the window");
  now += 5000;
  assert.equal(rl.sweep(), 2);
  assert.equal(rl.size, 0);
  const slow = new RateLimit(1, 60_000, () => now);
  slow.take("x");
  assert.equal(slow.take("x").retryAfterSec, 60);
});

test("crypto: base64url, SHA-256, HMAC-SHA256 and Ed25519 give the answers the standards give", async () => {
  assert.equal(base64url(new Uint8Array([251, 255, 254])), "-__-");
  assert.deepEqual(fromBase64url("-__-"), new Uint8Array([251, 255, 254]));
  assert.deepEqual(fromBase64url(base64url(new Uint8Array(0))), new Uint8Array(0));
  for (const bad of ["a", "ab=c", "a b", "a+b", "ab/c"]) assert.throws(() => fromBase64url(bad), /bad base64url/, bad);
  assert.equal(await sha256hex(utf8("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // RFC 4231, test case 2
  assert.equal(await hmacHex("Jefe", utf8("what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);

  const k = await generateSigningKey();
  assert.equal(k.publicKey.length, 32);
  const sig = await sign(k.key, "hello");
  assert.equal(fromBase64url(sig).length, 64);
  assert.equal(await verify(k.publicKey, "hello", sig), true);
  assert.equal(await verify(k.publicKey, "hellO", sig), false);
  assert.equal(await verify((await generateSigningKey()).publicKey, "hello", sig), false);
  for (const junk of ["", "short", "!!", sig.slice(0, -2), `${sig}AA`, "A".repeat(86)]) assert.equal(await verify(k.publicKey, "hello", junk), false, junk);
  assert.equal(await verify(new Uint8Array(31), "hello", sig), false, "a key of the wrong length");
  const again = await loadSigningKey(k.pkcs8);
  assert.deepEqual(again.publicKey, k.publicKey);
  assert.equal(await verify(k.publicKey, "x", await sign(again.key, "x")), true, "the saved key signs as the original did");
  await assert.rejects(loadSigningKey(new Uint8Array(10)));
});

test("bundle: the shape a Space sends, held to the caps the manifest names", () => {
  const ok = parseReport({ reportId: "rpt_aaaaaaaa1", bundle: bundle() });
  assert.equal(ok.ok, true);
  const minimal = parseReport({ reportId: "rpt_aaaaaaaa1", bundle: { context: { place: "Home" }, traceIds: [], events: [], versions: { app: "1", server: "1", device: "x" } } });
  assert.equal(minimal.ok, true);
  const field = (b: unknown): string | undefined => { const r = parseReport(b); return r.ok ? undefined : r.field; };
  assert.equal(field(null), "body");
  assert.equal(field([]), "body");
  assert.equal(field({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ context: { place: "a\u0000b" } }) }), "bundle.context.place", "control characters are refused");
  assert.equal(field({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ context: { place: "x".repeat(201) } }) }), "bundle.context.place");
  assert.equal(field({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ context: { place: "x", itemId: 5 } }) }), "bundle.context.itemId");
  assert.equal(field({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ events: Array.from({ length: 201 }, () => ({ type: "x", at: 1 })) }) }), "bundle.events");
  assert.equal(field({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ errors: Array.from({ length: 51 }, () => ({ code: "c", message: "m", at: 1 })) }) }), "bundle.errors");
  assert.equal(field({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ screenshotFileId: 3 }) }), "bundle.screenshotFileId");
  const long = parseReport({ reportId: "rpt_aaaaaaaa1", bundle: bundle({ note: "line one\nline two" }) });
  assert.equal(long.ok && long.body.bundle.note, "line one\nline two", "a note may have lines");
  assert.equal(field({ reportId: "RPT_AAAAAAAA1", bundle: bundle() }), "reportId");
  assert.equal(field({ reportId: "rpt_short", bundle: bundle() }), "reportId");
});

test("github: titles and bodies are one line and plain; the issue call; the closed webhook and its fixed-in label", async () => {
  assert.equal(inline("a`b|c<d>e\nf"), "a'b'c'd'e f");
  assert.equal(inline("x".repeat(300)).length, 200);
  const b = bundle({ note: undefined, events: [], errors: undefined, traceIds: [] }) as unknown as Bundle;
  assert.equal(issueTitle(b, "rpt_aaaaaaaa1"), "[report] Record page (rpt_aaaaaaaa1)", "no note: the place names it");
  const body = issueBody(b, { reportId: "rpt_aaaaaaaa1", spaceId: "spc_a", screenshotUrl: null, bundleUrl: null });
  assert.match(body, /- none captured\n\n\*\*Steps/);
  assert.equal(body.includes("Screenshot:"), false);
  assert.equal(body.includes("What the person wrote"), false);
  const many = bundle({ events: Array.from({ length: 30 }, (_, i) => ({ type: `e${i}`, at: 1_760_000_000_000 + i })), traceIds: [TRACE_A] }) as unknown as Bundle;
  const ev = issueBody(many, { reportId: "rpt_aaaaaaaa1", spaceId: "spc_a", screenshotUrl: "https://s/x", bundleUrl: "https://s/b" });
  assert.equal(ev.includes("`e9`"), false, "only the last 20 events");
  assert.ok(ev.includes("`e10`") && ev.includes("`e29`"));
  assert.ok(ev.includes("Screenshot: https://s/x") && ev.includes("Full bundle: https://s/b"));

  const seen: { url: string; method?: string; body?: string; headers?: Record<string, string> }[] = [];
  const outbound = (status: number, text: string) => async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => { seen.push({ url, ...init }); return { status, ok: status < 300, text: async () => text }; };
  const issue = await openIssue({ repo: "o/r", token: "t", outbound: outbound(201, JSON.stringify({ number: 7, html_url: "https://github.com/o/r/issues/7" })) }, "T", "B");
  assert.deepEqual(issue, { number: 7, url: "https://github.com/o/r/issues/7" });
  assert.equal(seen[0]?.url, "https://api.github.com/repos/o/r/issues");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), { title: "T", body: "B", labels: ["bug"] });
  await assert.rejects(openIssue({ repo: "o/r", token: "t", outbound: outbound(422, "{}") }, "T", "B"), (e: Error & { status?: number }) => e.status === 422);
  await assert.rejects(openIssue({ repo: "o/r", token: "t", outbound: outbound(201, "[]") }, "T", "B"), /no issue number/);

  assert.deepEqual(closedIssue("issues", { action: "closed", issue: { number: 5, labels: [{ name: "bug" }, { name: "fixed-in-1.2.3" }] } }), { number: 5, fixedIn: "1.2.3" });
  assert.deepEqual(closedIssue("issues", { action: "closed", issue: { number: 5, labels: ["fixed-in-2.0.0-rc.1"] } }), { number: 5, fixedIn: "2.0.0-rc.1" });
  assert.deepEqual(closedIssue("issues", { action: "closed", issue: { number: 5, labels: [{ name: "fixed-in-soon" }, { name: "wontfix" }] } }), { number: 5, fixedIn: null });
  assert.deepEqual(closedIssue("issues", { action: "closed", issue: { number: 5 } }), { number: 5, fixedIn: null });
  for (const no of [closedIssue("push", {}), closedIssue("issues", null), closedIssue("issues", { action: "opened", issue: { number: 5 } }), closedIssue("issues", { action: "closed", issue: { number: "5" } })]) assert.equal(no, null);
});

test("webhook addresses: https on a public host with the one path", () => {
  assert.equal(webhookAllowed("https://space.example.com/hooks/reports", false), true);
  assert.equal(webhookAllowed("https://space.example.com:8443/hooks/reports", false), true);
  assert.equal(webhookAllowed("https://8.8.8.8/hooks/reports", false), true);
  for (const no of ["http://space.example.com/hooks/reports", "https://space.example.com/hooks/other", "https://space.example.com/hooks/reports/", "not a url", "https://172.20.0.1/hooks/reports", "https://127.0.0.1/hooks/reports", "https://0.0.0.0/hooks/reports", "https://224.0.0.1/hooks/reports", "https://x.localhost/hooks/reports", "https://box.local/hooks/reports"]) {
    assert.equal(webhookAllowed(no, false), false, no);
  }
  assert.equal(webhookAllowed("http://127.0.0.1:9/hooks/reports", true), true, "tests and private networks may opt in");
  assert.equal(webhookAllowed("ftp://x/hooks/reports", true), false);
});

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  reportId: "rpt_aaaaaaaa1", spaceId: "spc_a", status: "stored", title: "t", traceIds: [TRACE_A], issueNumber: null, issueUrl: null, teamRecordId: null, viewToken: "tok",
  createdAt: 1, resolvedAt: null, fixedIn: null, notified: false, ...over,
});

test("stores: objects keep their type and refuse unsafe keys; the database finds what is pending and guards against replays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vyre-reports-"));
  for (const store of [new MemoryObjectStore(), new DirObjectStore(join(dir, "objects"))]) {
    await store.put("reports/rpt_a/bundle.json", utf8("{}"), "application/json");
    await store.put("reports/rpt_a/screenshot.png", new Uint8Array([1, 2, 3]), "image/png");
    assert.deepEqual(await store.get("reports/rpt_a/screenshot.png"), { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    assert.equal((await store.get("reports/rpt_a/bundle.json"))?.contentType, "application/json");
    assert.equal(await store.get("reports/rpt_a/nothing"), null);
    for (const bad of ["../x", "/abs", "a//b", "Upper", "dir/", "", "a/../b", "x".repeat(250)]) {
      await assert.rejects(store.put(bad, new Uint8Array(1), "x/y"), /bad object key/, bad);
      await assert.rejects(store.get(bad), /bad object key/, bad);
    }
  }
  const file = join(dir, "db", "reports.json");
  const db = await FileDb.open(file);
  assert.equal(await db.getSpace("spc_a"), null);
  await db.putSpace({ spaceId: "spc_a", publicKey: "k", webhook: "https://a/hooks/reports", registeredAt: 5 });
  await db.putReport(row());
  await db.putReport(row({ reportId: "rpt_aaaaaaaa2", issueNumber: 9, teamRecordId: "rec_1", status: "sent" }));
  await db.putReport(row({ reportId: "rpt_aaaaaaaa3", issueNumber: 10, teamRecordId: "rec_2", status: "resolved", notified: false }));
  await db.putReport(row({ reportId: "rpt_aaaaaaaa4", issueNumber: 11, teamRecordId: "rec_3", status: "resolved", notified: true }));
  assert.deepEqual((await db.pending()).map((r) => r.reportId).sort(), ["rpt_aaaaaaaa1", "rpt_aaaaaaaa3"]);
  assert.equal((await db.byIssue(9))?.reportId, "rpt_aaaaaaaa2");
  assert.equal(await db.byIssue(404), null);
  assert.equal(await db.firstSight("sig1", 2000, 1000), true);
  assert.equal(await db.firstSight("sig1", 2000, 1500), false, "inside its window");
  assert.equal(await db.firstSight("sig1", 4000, 2500), true, "after its window it is forgotten");

  const reopened = await FileDb.open(file);
  assert.equal((await reopened.getSpace("spc_a"))?.webhook, "https://a/hooks/reports");
  assert.equal((await reopened.getReport("rpt_aaaaaaaa2"))?.teamRecordId, "rec_1");
  assert.equal((await reopened.pending()).length, 2);
  assert.equal(await reopened.firstSight("sig1", 9999, 3000), false, "the replay guard survives a restart");
  const copy = await reopened.getReport("rpt_aaaaaaaa1");
  if (copy) copy.traceIds.push("x");
  assert.equal((await reopened.getReport("rpt_aaaaaaaa1"))?.traceIds.length, 1, "a read is a copy");
  await writeFile(file, "{not json");
  assert.equal(await (await FileDb.open(file)).getSpace("spc_a"), null, "a damaged file starts empty rather than stopping the service");
  assert.ok((await readFile(file, "utf8")).length > 0);
  assert.equal(await new MemoryDb().getReport("rpt_none"), null);
});

test("config: what the environment must say, and the plain sentence when it does not", () => {
  const env = { REPORTS_PUBLIC_URL: "https://reports.vyre.run/", GITHUB_TOKEN: "t", GITHUB_WEBHOOK_SECRET: "s" };
  const s = loadConfig(env);
  assert.equal(s.port, 8080);
  assert.equal(s.dataDir, "./data");
  assert.equal(s.trustProxy, false);
  assert.equal(s.config.publicUrl, "https://reports.vyre.run");
  assert.equal(s.config.github.repo, "vyre-ai/vyre");
  assert.equal(s.config.team, null);
  assert.deepEqual(s.config.limits, DEFAULT_LIMITS);
  const full = loadConfig({ ...env, PORT: "9000", REPORTS_DATA_DIR: "/data", REPORTS_TRUST_PROXY: "1", GITHUB_REPO: "o/r", TEAM_SPACE_URL: "https://team", TEAM_SPACE_TOKEN: "tok", TEAM_RECORD_TYPE: "problem", REPORTS_PER_SPACE: "5", REPORTS_SKEW_MS: "60000" });
  assert.equal(full.port, 9000);
  assert.equal(full.trustProxy, true);
  assert.deepEqual(full.config.team, { baseUrl: "https://team", token: "tok", recordType: "problem" });
  assert.equal(full.config.limits.perSpace, 5);
  assert.equal(full.config.limits.skewMs, 60000);
  const bad = (over: Record<string, string | undefined>, why: RegExp): void => assert.throws(() => loadConfig({ ...env, ...over }), why);
  bad({ REPORTS_PUBLIC_URL: undefined }, /REPORTS_PUBLIC_URL is not set/);
  bad({ REPORTS_PUBLIC_URL: "http://reports.example" }, /https/);
  bad({ GITHUB_TOKEN: undefined }, /GITHUB_TOKEN is not set/);
  bad({ GITHUB_WEBHOOK_SECRET: "" }, /GITHUB_WEBHOOK_SECRET is not set/);
  bad({ TEAM_SPACE_URL: "https://team" }, /set together/);
  bad({ TEAM_SPACE_TOKEN: "tok" }, /set together/);
  bad({ GITHUB_REPO: "not-a-repo" }, /owner\/name/);
  bad({ PORT: "eighty" }, /PORT must be a whole number/);
  bad({ REPORTS_PER_SPACE: "0" }, /at least 1/);
  assert.equal(loadConfig({ ...env, REPORTS_PUBLIC_URL: "http://127.0.0.1:8080", REPORTS_ALLOW_INSECURE: "1" }).config.allowInsecureWebhooks, true);
});
