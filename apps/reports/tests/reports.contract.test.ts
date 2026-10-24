// Contract for POST /v1/reports (spec 4.18, ARCH 7.14 test 4): a Space-signed request, the rate limit, and the GitHub issue against a recorded response;
// plus the rest of the service's door: registering a Space, the team record, the resolved webhook back to the reporter, and the links in the issue.

import test from "node:test";
import assert from "node:assert/strict";
import { base64url, fromBase64url, hmacHex, resolvedMessage, sha256hex, utf8, verify } from "../src/crypto.ts";
import { CLOSED, ISSUE, NOW, PNG, TRACE_A, TRACE_B, WEBHOOK_SECRET, bundle, makeSpace, reportBody, world } from "./harness.ts";

const rid = (n: number): string => `rpt_aaaaaaaa${n}`;
const png = (): Record<string, unknown> => ({ screenshotPng: base64url(PNG) });

test("register: a Space proves it holds the key it names, and the webhook it gives must be a public https address", async () => {
  const w = await world({ limits: { registerPerIp: 100 } });
  const alpha = await makeSpace();
  const res = await w.register(alpha);
  assert.equal(res.status, 201);
  assert.deepEqual(w.json(res).data, { spaceId: "spc_alpha1", registered: true });
  assert.equal((await w.db.getSpace("spc_alpha1"))?.publicKey, alpha.publicKey);
  assert.equal((await w.register(alpha)).status, 200, "registering again is an update");

  const bad = async (body: Record<string, unknown>, field: string): Promise<void> => {
    const r = await w.register(alpha, { body });
    assert.equal(r.status, 422, field);
    assert.equal(w.json(r).error?.details?.field, field);
  };
  await bad({ spaceId: "alpha" }, "spaceId");
  await bad({ publicKey: "short" }, "publicKey");
  await bad({ publicKey: base64url(new Uint8Array(31)) }, "publicKey");
  await bad({ webhook: "ftp://alpha.test/hooks/reports" }, "webhook");
  await bad({ webhook: "http://alpha.test/elsewhere" }, "webhook");
  await bad({ webhook: "http://alpha.test/hooks/reports?x=1" }, "webhook");
  await bad({ webhook: "http://user:pw@alpha.test/hooks/reports" }, "webhook");

  assert.equal((await w.register(alpha, { bad: true })).status, 401, "a signature that does not verify");
  const otherKey = await makeSpace("spc_alpha1");
  assert.equal((await w.register(alpha, { body: { publicKey: otherKey.publicKey } })).status, 401, "signed by a key other than the one it names");
  const stale = await w.register(alpha, { ts: String(NOW - 10 * 60_000) });
  assert.equal(stale.status, 401);
  assert.equal(w.json(stale).error?.code, "auth.expired");
  assert.equal((await w.send({ method: "POST", path: "/v1/spaces", body: utf8("{}") })).status, 422);
  assert.equal((await w.send({ method: "POST", path: "/v1/spaces", body: utf8("nope") })).status, 400);
  assert.equal((await w.send({ method: "POST", path: "/v1/spaces", body: new Uint8Array(5000) })).status, 413);
});

test("register: a Space's key changes only when the current key agrees, and the strict webhook rules refuse private hosts", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  const rekeyed = await makeSpace("spc_alpha1");
  assert.equal((await w.register(rekeyed)).status, 409, "a new key alone is not enough");
  assert.equal((await w.register(rekeyed, { current: alpha })).status, 200);
  assert.equal((await w.db.getSpace("spc_alpha1"))?.publicKey, rekeyed.publicKey);
  assert.equal((await w.register(alpha, { current: alpha })).status, 409, "the old key no longer speaks for it");

  const strict = await world({ config: { allowInsecureWebhooks: false } });
  for (const hook of ["http://alpha.example/hooks/reports", "https://localhost/hooks/reports", "https://10.0.0.5/hooks/reports", "https://192.168.1.9/hooks/reports", "https://169.254.169.254/hooks/reports", "https://[::1]/hooks/reports", "https://intranet/hooks/reports", "https://svc.internal/hooks/reports"]) {
    const s = await makeSpace("spc_strict1", hook);
    assert.equal((await strict.register(s)).status, 422, hook);
  }
  assert.equal((await strict.register(await makeSpace("spc_strict1", "https://alpha.example/hooks/reports"))).status, 201);

  const limited = await world({ limits: { registerPerIp: 2 } });
  const s = await makeSpace("spc_limit1");
  assert.equal((await limited.register(s)).status, 201);
  assert.equal((await limited.register(s)).status, 200);
  const third = await limited.register(s);
  assert.equal(third.status, 429);
  assert.match(third.headers["retry-after"] ?? "", /^\d+$/);
  assert.equal((await limited.register(s, { ip: "198.51.100.1" })).status, 200, "another address is not held up");
});

test("POST /v1/reports: a signed report is stored, opens a bug issue with the trace ids, and files the team record", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  const res = await w.report(alpha, reportBody(rid(1), png()));
  assert.equal(res.status, 201);
  assert.deepEqual(w.json(res).data, { reportId: rid(1), stored: true, issueNumber: 1234, issueUrl: ISSUE.html_url });

  const gh = w.callsTo("https://api.github.com/");
  assert.equal(gh.length, 1);
  assert.equal(gh[0]?.url, "https://api.github.com/repos/vyre-ai/vyre/issues");
  assert.equal(gh[0]?.method, "POST");
  assert.equal(gh[0]?.headers.authorization, "Bearer ghp_test");
  const issue = JSON.parse(gh[0]?.body ?? "{}") as { title: string; body: string; labels: string[] };
  assert.deepEqual(issue.labels, ["bug"]);
  assert.equal(issue.title, `[report] The save button did nothing (${rid(1)})`);
  for (const must of [TRACE_A, TRACE_B, "Mac, Safari 19", "record.updated", "validation.version_conflict", "spc_alpha1", "```text\nThe save button did nothing\n```", "Record page"]) assert.ok(issue.body.includes(must), must);
  const row = await w.db.getReport(rid(1));
  assert.ok(row);
  assert.ok(issue.body.includes(`https://reports.vyre.test/v1/reports/${rid(1)}/screenshot?t=${row.viewToken}`), "the screenshot is linked, with the secret only the issue carries");
  assert.ok(issue.body.includes(`/v1/reports/${rid(1)}/bundle?t=${row.viewToken}`));

  const team = w.callsTo("https://team.vyre.test/");
  assert.equal(team.length, 1);
  assert.equal(team[0]?.url, "https://team.vyre.test/v1/records/create");
  assert.equal(team[0]?.headers.authorization, "Bearer svc_team");
  assert.deepEqual(JSON.parse(team[0]?.body ?? "{}"), {
    type: "report", idempotencyKey: `report-${rid(1)}`,
    fields: { title: "The save button did nothing", status: "sent", traceIds: `${TRACE_A},${TRACE_B}`, issueNumber: 1234 },
  });

  assert.equal(row.status, "sent");
  assert.equal(row.teamRecordId, "rec_team1");
  assert.equal(row.issueNumber, 1234);
  const stored = w.objects.objects.get(`reports/${rid(1)}/bundle.json`);
  assert.ok(stored);
  assert.equal((JSON.parse(new TextDecoder().decode(stored.bytes)) as { spaceId: string }).spaceId, "spc_alpha1");
  assert.deepEqual(w.objects.objects.get(`reports/${rid(1)}/screenshot.png`)?.bytes, PNG);
  assert.equal(w.objects.objects.get(`reports/${rid(1)}/screenshot.png`)?.contentType, "image/png");
});

test("POST /v1/reports: what a person typed cannot break out of the issue", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  const nasty = bundle({ note: "`code` | <img src=x onerror=1>\n[click](javascript:alert(1))", context: { place: "x`|<b>y" } });
  assert.equal((await w.report(alpha, utf8(JSON.stringify({ reportId: rid(2), bundle: nasty })))).status, 201);
  const issue = JSON.parse(w.callsTo("https://api.github.com/")[0]?.body ?? "{}") as { title: string; body: string };
  assert.equal(issue.title, `[report] 'code' ' 'img src=x onerror=1' (${rid(2)})`);
  assert.ok(issue.body.includes("```text\n'code' ' 'img src=x onerror=1'\n[click](javascript:alert(1))\n```"), "the words sit in a code fence, nothing in them renders");
  assert.equal(issue.body.includes("<img"), false);
  assert.equal(issue.body.includes("<b>"), false);
  assert.ok(issue.body.includes("`x'''b'y`"), "the place is neutralised");
});

test("POST /v1/reports: no signature, an unknown Space, a forged or tampered request, and a stale time are all refused", async () => {
  const w = await world();
  const alpha = await makeSpace();
  const mallory = await makeSpace("spc_mallory");
  await w.register(alpha);
  const body = reportBody(rid(3));
  const code = async (p: Promise<{ status: number; body: Uint8Array | string }>): Promise<[number, string | undefined]> => { const r = await p; return [r.status, w.json(r as never).error?.code]; };

  assert.deepEqual(await code(w.report(alpha, body, { noSig: true })), [401, "auth.unauthenticated"]);
  assert.deepEqual(await code(w.report(mallory, body)), [401, "auth.unauthenticated"], "a Space that never registered");
  assert.deepEqual(await code(w.report(alpha, body, { signWith: mallory })), [401, "auth.unauthenticated"], "signed by another key");
  assert.deepEqual(await code(w.report(alpha, body, { tamper: true })), [401, "auth.unauthenticated"], "the body changed after signing");
  assert.deepEqual(await code(w.report(alpha, body, { spaceHeader: "alpha" })), [401, "auth.unauthenticated"]);
  assert.deepEqual(await code(w.report(alpha, body, { ts: String(NOW - 6 * 60_000) })), [401, "auth.expired"]);
  assert.deepEqual(await code(w.report(alpha, body, { ts: String(NOW + 6 * 60_000) })), [401, "auth.expired"]);
  assert.deepEqual(await code(w.report(alpha, body, { ts: "yesterday" })), [401, "auth.expired"]);
  const unknown = w.json(await w.report(mallory, body)).error?.message, forged = w.json(await w.report(alpha, body, { signWith: mallory })).error?.message;
  assert.equal(unknown, forged, "the answer does not say whether a Space exists");
  assert.equal(w.callsTo("https://api.github.com/").length, 0, "nothing reaches GitHub without a good signature");
  assert.equal(await w.db.getReport(rid(3)), null);

  // a signed request is good once: the same bytes sent again are a replay
  assert.equal((await w.report(alpha, body)).status, 201);
  assert.deepEqual(await code(w.report(alpha, body)), [401, "auth.unauthenticated"]);
});

test("POST /v1/reports: a Space is held to its hourly limit, another Space is not, and an address is held to its own", async () => {
  const w = await world({ limits: { perSpace: 3, perIp: 4 } });
  const alpha = await makeSpace(), beta = await makeSpace("spc_beta01", "http://beta.test/hooks/reports");
  await w.register(alpha); await w.register(beta);
  for (let i = 1; i <= 3; i++) assert.equal((await w.report(alpha, reportBody(rid(10 + i)))).status, 201, `report ${i}`);
  w.advance(1000);
  const limited = await w.report(alpha, reportBody(rid(14)));
  assert.equal(limited.status, 429);
  assert.equal(w.json(limited).error?.code, "rate_limit.exceeded");
  assert.ok(Number(limited.headers["retry-after"]) >= 3590 && Number(limited.headers["retry-after"]) <= 3600, "it says when to come back");
  assert.equal(await w.db.getReport(rid(14)), null, "a limited report is not stored");
  assert.equal(w.callsTo("https://api.github.com/").length, 3);
  w.advance(3_600_000);
  assert.equal((await w.report(alpha, reportBody(rid(14)))).status, 201, "an hour later it goes through");
  w.advance(1000);
  assert.equal((await w.report(beta, reportBody(rid(15)), { ip: "198.51.100.9" })).status, 201, "another Space is not held up by alpha's limit");
  const garbage = await world({ limits: { perIp: 2 } });
  for (let i = 0; i < 2; i++) assert.equal((await garbage.send({ method: "POST", path: "/v1/reports", body: utf8("x") })).status, 401);
  assert.equal((await garbage.send({ method: "POST", path: "/v1/reports", body: utf8("x") })).status, 429, "unsigned traffic is counted too");
});

test("POST /v1/reports: a report that is not valid says which field", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  const field = async (body: Uint8Array): Promise<string | undefined> => {
    w.advance(1000);
    const r = await w.report(alpha, body);
    assert.equal(r.status, 422);
    return w.json(r).error?.details?.field as string | undefined;
  };
  const make = (over: Record<string, unknown>, id = rid(20)): Uint8Array => utf8(JSON.stringify({ reportId: id, bundle: bundle(over) }));
  assert.equal(await field(utf8(JSON.stringify({ reportId: "bad", bundle: bundle() }))), "reportId");
  assert.equal(await field(utf8(JSON.stringify({ reportId: rid(20) }))), "bundle");
  assert.equal(await field(make({ context: { place: "" } })), "bundle.context.place");
  assert.equal(await field(make({ traceIds: ["nothex"] })), "bundle.traceIds");
  assert.equal(await field(make({ traceIds: Array.from({ length: 21 }, () => TRACE_A) })), "bundle.traceIds");
  assert.equal(await field(make({ versions: { app: "1" } })), "bundle.versions");
  assert.equal(await field(make({ note: "x".repeat(501) })), "bundle.note");
  assert.equal(await field(make({ events: [{ type: "x", at: "now" }] })), "bundle.events");
  assert.equal(await field(make({ errors: [{ code: "c", message: "m", at: 1, traceId: "bad" }] })), "bundle.errors");
  assert.equal(await field(utf8(JSON.stringify({ reportId: rid(20), bundle: bundle(), screenshotPng: base64url(utf8("not a png at all")) }))), "screenshotPng");
  assert.equal(await field(utf8(JSON.stringify({ reportId: rid(20), bundle: bundle(), screenshotPng: "a+b/c" }))), "screenshotPng");
  assert.equal(await field(utf8(JSON.stringify({ reportId: rid(20), bundle: bundle(), screenshotPng: base64url(new Uint8Array(2 * 1024 * 1024 + 9).fill(1)) }))), "screenshotPng");
  w.advance(1000);
  assert.equal((await w.report(alpha, utf8("not json"))).status, 400);
  assert.equal((await w.report(alpha, new Uint8Array(4 * 1024 * 1024 + 1))).status, 413);
  assert.equal(w.callsTo("https://api.github.com/").length, 0);
  assert.equal(w.objects.objects.size, 0, "nothing is stored for a report that is refused");
});

test("POST /v1/reports: sending the same report again returns the same issue; another Space cannot take its id", async () => {
  const w = await world();
  const alpha = await makeSpace(), beta = await makeSpace("spc_beta01", "http://beta.test/hooks/reports");
  await w.register(alpha); await w.register(beta);
  const first = await w.report(alpha, reportBody(rid(30)));
  w.advance(1000);
  const again = await w.report(alpha, reportBody(rid(30)));
  assert.deepEqual(w.json(again).data, w.json(first).data);
  assert.equal(w.callsTo("https://api.github.com/").length, 1, "one issue however many times the Space asks");
  assert.equal(w.callsTo("https://team.vyre.test/").length, 1);
  w.advance(1000);
  const stolen = await w.report(beta, reportBody(rid(30)));
  assert.equal(stolen.status, 409);
  assert.equal((await w.db.getReport(rid(30)))?.spaceId, "spc_alpha1");
});

test("POST /v1/reports: when GitHub or the team Space is down the report is kept, answered 202 or 201, and finished by the retry", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  w.state.github = { status: 500, body: "{}" };
  const kept = await w.report(alpha, reportBody(rid(40)));
  assert.equal(kept.status, 202);
  assert.deepEqual(w.json(kept).data, { reportId: rid(40), stored: true, issueNumber: null });
  assert.equal(w.callsTo("https://team.vyre.test/").length, 0, "the record waits for the issue number");
  assert.equal((await w.db.getReport(rid(40)))?.status, "stored");
  assert.equal(await w.svc.retryPending(), 0, "still down: nothing finished");
  assert.equal(w.callsTo("https://api.github.com/").length, 2);

  w.state.github = { status: 201, body: JSON.stringify(ISSUE) };
  w.state.team = { status: 503, body: "{}" };
  assert.equal(await w.svc.retryPending(), 1, "the issue is opened now");
  let row = await w.db.getReport(rid(40));
  assert.equal(row?.issueNumber, 1234);
  assert.equal(row?.status, "sent");
  assert.equal(row?.teamRecordId, null, "the team Space is down");

  w.state.team = { status: 200, body: JSON.stringify({ data: { record: { id: "rec_late" } } }) };
  assert.equal(await w.svc.retryPending(), 1);
  row = await w.db.getReport(rid(40));
  assert.equal(row?.teamRecordId, "rec_late");
  assert.equal(await w.svc.retryPending(), 0, "nothing left to do");
  assert.equal(w.callsTo("https://api.github.com/").length, 3, "one more try for the issue, then done");

  // an answer that is not an issue is a failure too
  for (const bad of [{ status: 201, body: "not json" }, { status: 201, body: JSON.stringify({ html_url: "x" }) }, { status: 403, body: "{}" }, { status: 200, body: JSON.stringify(ISSUE) }]) {
    w.state.github = bad;
    w.advance(1000);
    const r = await w.report(alpha, reportBody(`rpt_bbbbbbbb${bad.status}${bad.body.length}`));
    assert.equal(r.status, 202, JSON.stringify(bad));
  }
  const noTeam = await world({ config: { team: null } });
  const gamma = await makeSpace("spc_gamma1");
  await noTeam.register(gamma);
  assert.equal((await noTeam.report(gamma, reportBody(rid(41)))).status, 201);
  assert.equal(noTeam.callsTo("https://team.vyre.test/").length, 0, "no team Space configured, no record filed");
});

test("resolved: GitHub's closed-issue webhook is told to the reporter Space with a signed call it can verify", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  await w.report(alpha, reportBody(rid(50)));
  w.advance(60_000);
  const res = await w.githubHook(CLOSED);
  assert.equal(res.status, 200);
  assert.deepEqual(w.json(res).data, { reportId: rid(50), resolved: true, notified: true });

  const hooks = w.callsTo("http://alpha.test/hooks/reports");
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0]?.method, "POST");
  assert.deepEqual(JSON.parse(hooks[0]?.body ?? "{}"), { reportId: rid(50), issueNumber: 1234, fixedIn: "0.7.2" });
  const ts = hooks[0]?.headers["x-vyre-reports-ts"] ?? "";
  assert.equal(ts, String(NOW + 60_000));
  const key = fromBase64url(String(w.json(await w.send({ method: "GET", path: "/v1/key" })).data?.publicKey));
  assert.equal(await verify(key, resolvedMessage(ts, await sha256hex(utf8(hooks[0]?.body ?? ""))), hooks[0]?.headers["x-vyre-reports-sig"] ?? ""), true, "the Space can check it came from the service");
  assert.equal(await verify(key, resolvedMessage(ts, await sha256hex(utf8("{}"))), hooks[0]?.headers["x-vyre-reports-sig"] ?? ""), false);

  const row = await w.db.getReport(rid(50));
  assert.equal(row?.status, "resolved");
  assert.equal(row?.fixedIn, "0.7.2");
  assert.equal(row?.resolvedAt, NOW + 60_000);
  assert.equal(row?.notified, true);
  // GitHub sends the delivery again: the Space is not told twice
  assert.equal((await w.githubHook(CLOSED)).status, 200);
  assert.equal(w.callsTo("http://alpha.test/hooks/reports").length, 1);
});

test("resolved: a webhook that is not GitHub's, not a close, or not ours does nothing; a Space that cannot be reached is told by the retry", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  await w.report(alpha, reportBody(rid(51)));
  assert.equal((await w.githubHook(CLOSED, { secret: "wrong" })).status, 401);
  assert.equal((await w.send({ method: "POST", path: "/v1/github/webhook", body: utf8(JSON.stringify(CLOSED)) })).status, 401);
  const ignored = async (r: Promise<{ status: number; body: Uint8Array | string }>) => { const x = await r; assert.equal(x.status, 200); assert.equal(w.json(x as never).data?.ignored, true); };
  await ignored(w.githubHook(CLOSED, { event: "ping" }));
  await ignored(w.githubHook({ ...CLOSED, action: "opened" }));
  await ignored(w.githubHook({ ...CLOSED, issue: { number: 999, labels: [] } }));
  await ignored(w.githubHook({ zen: "hello" }));
  assert.equal((await w.send({ method: "POST", path: "/v1/github/webhook", headers: { "x-hub-signature-256": `sha256=${await hmacHex(WEBHOOK_SECRET, utf8("{not json"))}` }, body: utf8("{not json") })).status, 400);
  assert.equal(w.callsTo("http://alpha.test/hooks/reports").length, 0);
  assert.equal((await w.db.getReport(rid(51)))?.status, "sent");

  w.state.hook = { status: 502 };
  const res = await w.githubHook(CLOSED);
  assert.equal(res.status, 200);
  assert.deepEqual(w.json(res).data, { reportId: rid(51), resolved: true, notified: false });
  assert.equal((await w.db.getReport(rid(51)))?.status, "resolved");
  assert.equal(await w.svc.retryPending(), 0, "the Space is still down");
  w.state.hook = { status: 200 };
  assert.equal(await w.svc.retryPending(), 1);
  assert.equal((await w.db.getReport(rid(51)))?.notified, true);
  assert.equal(await w.svc.retryPending(), 0);
});

test("links in the issue: the screenshot and the bundle open with the report's secret and nothing else", async () => {
  const w = await world();
  const alpha = await makeSpace();
  await w.register(alpha);
  await w.report(alpha, reportBody(rid(60), png()));
  const row = await w.db.getReport(rid(60));
  const get = (what: string, t?: string) => w.send({ method: "GET", path: `/v1/reports/${rid(60)}/${what}`, ...(t === undefined ? {} : { query: { t } }) });
  const shot = await get("screenshot", row?.viewToken);
  assert.equal(shot.status, 200);
  assert.equal(shot.headers["content-type"], "image/png");
  assert.equal(shot.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(shot.body, PNG);
  const b = await get("bundle", row?.viewToken);
  assert.equal(b.status, 200);
  assert.equal((JSON.parse(new TextDecoder().decode(b.body as Uint8Array)) as { reportId: string }).reportId, rid(60));
  for (const t of [undefined, "", "wrong", `${row?.viewToken}x`]) assert.equal((await get("screenshot", t)).status, 404, String(t));
  assert.equal((await w.send({ method: "GET", path: "/v1/reports/rpt_nothere99/screenshot", query: { t: row?.viewToken ?? "" } })).status, 404);
  // a report without a screenshot has none to show
  await w.report(alpha, reportBody(rid(61)));
  const bare = await w.db.getReport(rid(61));
  assert.equal((await w.send({ method: "GET", path: `/v1/reports/${rid(61)}/screenshot`, query: { t: bare?.viewToken ?? "" } })).status, 404);
});

test("service: health, its public key, unknown routes, and a failure inside is a plain 500", async () => {
  const w = await world();
  assert.deepEqual(w.json(await w.send({ method: "GET", path: "/healthz" })).data, { ok: true });
  assert.equal(w.json(await w.send({ method: "GET", path: "/v1/key" })).data?.publicKey, base64url(w.key.publicKey));
  assert.equal((await w.send({ method: "GET", path: "/v1/reports" })).status, 404);
  assert.equal((await w.send({ method: "DELETE", path: "/v1/reports" })).status, 404);
  assert.equal((await w.send({ method: "GET", path: "/nope" })).status, 404);
  const alpha = await makeSpace();
  await w.register(alpha);
  w.db.getSpace = async () => { throw new Error("disk gone"); };
  const res = await w.report(alpha, reportBody(rid(70)));
  assert.equal(res.status, 500);
  assert.equal(w.json(res).error?.code, "internal.unexpected");
  assert.equal(JSON.stringify(w.json(res)).includes("disk gone"), false, "the inside is not shown to the caller");
});
