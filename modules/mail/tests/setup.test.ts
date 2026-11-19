// mail.setup.status: which steps of the Space's email setup are done and what comes next, for every provider and every half-finished state.
// Pure: no socket, no DNS. Addresses and hosts are .example.
import test from "node:test";
import assert from "node:assert/strict";
import { planSetup } from "../handlers/setup.ts";
import type { SetupProvider } from "../handlers/setup.ts";
import type { DomainOut } from "../handlers/extra/domains.ts";
import type { SmtpOut } from "../handlers/smtp.ts";

const none: SmtpOut = { configured: false, state: "none" };
const smtp = (state: SmtpOut["state"], detail?: string): SmtpOut => ({
  configured: true,
  host: "smtp.northwind.example",
  port: 587,
  security: "starttls",
  username: "hello@northwind.example",
  state,
  ...(detail ? { detail } : {}),
});
const dom = (over: Partial<DomainOut> = {}): DomainOut => ({
  id: "dom_1",
  name: "northwind.example",
  provider: "resend",
  spf: "pass",
  dkim: "pass",
  dmarc: "pass",
  verified: true,
  isDefault: true,
  ...over,
});

test("a fresh Space on Resend or Mailgun is asked for a domain first", () => {
  for (const p of ["resend", "mailgun"] as SetupProvider[]) {
    const r = planSetup(p, none, []);
    assert.equal(r.step, "add_domain");
    assert.equal(r.ready, false);
    assert.deepEqual(r.done, ["choose_provider"]);
  }
});
test("SMTP asks for the server before anything else, and says why a failed test failed", () => {
  assert.equal(planSetup("smtp", none, []).step, "connect_server");
  assert.equal(planSetup("smtp", smtp("unchecked"), []).step, "connect_server");
  const failed = planSetup("smtp", smtp("failed", "Port 587 is blocked on this server."), []);
  assert.equal(failed.step, "connect_server");
  assert.match(failed.next, /Port 587 is blocked/);
  assert.equal(failed.ready, false);
});
test("a domain at another provider does not count for the chosen one", () => {
  assert.equal(planSetup("mailgun", none, [dom({ provider: "resend" })]).step, "add_domain");
});
test("a domain whose DNS has not passed asks for the records, a verified one that is not default asks for the default", () => {
  assert.equal(
    planSetup("resend", none, [dom({ verified: false, spf: "pending", isDefault: false })]).step,
    "publish_dns",
  );
  assert.equal(planSetup("resend", none, [dom({ isDefault: false })]).step, "set_default");
});
test("every provider reaches ready, with the steps ticked in order", () => {
  const r = planSetup("smtp", smtp("ok"), [dom({ provider: "smtp" })]);
  assert.equal(r.ready, true);
  assert.equal(r.step, "ready");
  assert.deepEqual(r.done, ["choose_provider", "connect_server", "add_domain", "publish_dns", "set_default"]);
  assert.deepEqual(planSetup("resend", none, [dom()]).done, [
    "choose_provider",
    "add_domain",
    "publish_dns",
    "set_default",
  ]);
});
test("no state is a dead end: every state has a next sentence and only ready has none to do", () => {
  const cases: [SetupProvider, SmtpOut, DomainOut[]][] = [
    ["resend", none, []],
    ["smtp", none, []],
    ["smtp", smtp("failed"), []],
    ["smtp", smtp("ok"), []],
    ["mailgun", none, [dom({ provider: "mailgun", verified: false })]],
    ["resend", none, [dom({ isDefault: false })]],
    ["resend", none, [dom()]],
  ];
  for (const [p, s, d] of cases) {
    const r = planSetup(p, s, d);
    assert.ok(r.next.length > 10);
    assert.equal(r.ready, r.step === "ready");
  }
});
