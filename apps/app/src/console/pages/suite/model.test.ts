import test from "node:test";
import assert from "node:assert/strict";
import { memberNote, microsoftSecret, parseGoogleKey, personLine, serviceRows, shortScope, summaryOf } from "./model.ts";

// secret-scan: fake (a made-up key body, not a credential)
const key = (o: Record<string, unknown> = {}) => JSON.stringify({ type: "service_account", project_id: "firm-prod", client_id: "104857384729183746501", client_email: "vyre@firm-prod.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", ...o });

test("a service-account key gives back only its public identity", () => {
  const r = parseGoogleKey(key());
  assert.deepEqual(r, { ok: true, value: { clientId: "104857384729183746501", clientEmail: "vyre@firm-prod.iam.gserviceaccount.com", projectId: "firm-prod" } });
  assert.ok(!JSON.stringify(r).includes("PRIVATE KEY"));
});

test("a key that is not a service account says what to paste", () => {
  for (const text of ["", "not json", "{}", key({ type: "authorized_user" }), key({ client_id: "abc" }), key({ private_key: "nope" }), key({ client_email: "nobody" })]) {
    const r = parseGoogleKey(text);
    assert.equal(r.ok, false, text);
  }
  const bad = parseGoogleKey("{}");
  assert.ok(!bad.ok && bad.problem.includes("Create new key, JSON"));
});

test("Microsoft app values become the Vault text, and each wrong value is named", () => {
  const ok = microsoftSecret({ tenantId: " 11111111-2222-3333-4444-555555555555 ", clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", clientSecret: "s3cr3t-value~123" });
  assert.deepEqual(ok.ok && JSON.parse(ok.value), { tenantId: "11111111-2222-3333-4444-555555555555", clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", clientSecret: "s3cr3t-value~123" });
  const app = { tenantId: "firm.com", clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", clientSecret: "longenough1" };
  assert.ok(microsoftSecret(app).ok);
  assert.match((microsoftSecret({ ...app, tenantId: "bad tenant" }) as { problem: string }).problem, /tenant ID/);
  assert.match((microsoftSecret({ ...app, clientId: "xyz" }) as { problem: string }).problem, /client\) ID/);
  assert.match((microsoftSecret({ ...app, clientSecret: "a b" }) as { problem: string }).problem, /Value/);
});

test("not set up reads healthy with a hint, for both suites", () => {
  for (const p of ["google", "microsoft"] as const) {
    const rows = serviceRows(p, { configured: false, checked: null, lastOk: undefined });
    assert.ok(rows.length >= 4);
    assert.ok(rows.every((r) => r.state === "healthy" && /Not set up yet/.test(r.hint)));
    const s = summaryOf(p, rows, false, 0);
    assert.equal(s.tone, "ok");
    assert.match(s.title, /not connected/);
  }
});

test("a check that names a missing scope degrades only the services that need it, and says where to add it", () => {
  const rows = serviceRows("google", { configured: true, lastOk: false, checked: { ok: false, missing: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"] } });
  assert.deepEqual(rows.map((r) => [r.key, r.state]), [["mail", "healthy"], ["calendar", "healthy"], ["drive", "degraded"], ["meet", "healthy"], ["docs", "degraded"]]);
  assert.equal(rows[2]!.hint, "Add drive in the Google Admin console, then check again.");
  assert.equal(rows[4]!.hint, "Add documents in the Google Admin console, then check again.");
  const s = summaryOf("google", rows, true, 4);
  assert.equal(s.tone, "warn");
  assert.match(s.line, /Drive, Docs and Sheets need a change/);
});

test("Microsoft permissions map to Mail, Calendar, OneDrive and SharePoint, Teams and People", () => {
  const rows = serviceRows("microsoft", { configured: true, lastOk: false, checked: { ok: false, missing: ["Mail.Send", "OnlineMeetingTranscript.Read.All"] } });
  assert.deepEqual(rows.filter((r) => r.state === "degraded").map((r) => r.key), ["mail", "teams"]);
  assert.match(rows[0]!.hint, /Add Mail.Send in the Azure app registration/);
});

test("a good check, a remembered check and a never-checked connection each read as they are", () => {
  const good = serviceRows("google", { configured: true, lastOk: null, checked: { ok: true, missing: [] } });
  assert.ok(good.every((r) => r.state === "healthy" && /is working/.test(r.hint)));
  assert.match(summaryOf("google", good, true, 1).line, /1 member is included/);
  assert.match(summaryOf("google", good, true, 3).line, /3 members are included/);
  assert.ok(serviceRows("google", { configured: true, lastOk: true, checked: null }).every((r) => /last check/.test(r.hint)));
  assert.ok(serviceRows("google", { configured: true, lastOk: null, checked: null }).every((r) => r.state === "healthy" && /Not checked yet/.test(r.hint)));
  assert.ok(serviceRows("google", { configured: true, lastOk: false, checked: null }).every((r) => r.state === "degraded"));
  const down = serviceRows("google", { configured: true, lastOk: false, checked: { ok: false, missing: [], detail: "Gmail answered 403 for admin@firm.com." } });
  assert.ok(down.every((r) => r.state === "degraded" && r.hint.includes("403")));
});

test("people see what is connected for them and what to ask their admin", () => {
  assert.equal(personLine(true, false, "Google Workspace"), "Connected through your firm");
  assert.match(personLine(true, true, "Google Workspace"), /excluded/);
  assert.match(personLine(false, false, "Microsoft 365"), /Ask your admin to open Console, Integrations, Microsoft 365/);
  assert.match(memberNote({ email: "a@b.co", mapped: true, excluded: true }), /never reads/);
  assert.match(memberNote({ email: "a@b.co", mapped: true, excluded: false, mailboxState: "pending" }), /Waiting/);
  assert.match(memberNote({ email: "a@b.co", mapped: false, excluded: false }), /Not matched/);
});

test("small helpers", () => {
  assert.equal(shortScope("https://www.googleapis.com/auth/gmail.modify"), "gmail.modify");
});
