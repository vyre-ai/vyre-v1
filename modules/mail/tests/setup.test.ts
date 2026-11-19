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

// ---- mail.setup.test_send

import { testSend } from "../handlers/setup.ts";
import { script, seedDomain } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, seedMailbox } from "../fixtures/harness.ts";

const sendsTo = (h: ReturnType<typeof harness>) => h.called.filter((c) => c.cap === "mail.send");

test("test send goes through mail.send from an address on the default verified domain, to the address typed and nobody else", async () => {
  const h = harness();
  seedDomain(h, {
    id: "dom_t",
    name: "northwind.example",
    provider: "resend",
    verified: true,
    isDefault: true,
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
  });
  seedMailbox(h, "mbx_t", "hello@northwind.example", { kind: "shared" });
  script(h, { "mail.send": () => ({ messageId: "eml_test0001", status: "sent" }) });
  const out = await testSend(h.ctx, { to: " Maya@Example.com ", idempotencyKey: "idem-ts-1" });
  assert.deepEqual(contractErrors("mail.setup.test_send", "out", out), []);
  assert.deepEqual([out.status, out.from], ["sent", "hello@northwind.example"]);
  const call = sendsTo(h);
  assert.equal(call.length, 1);
  assert.deepEqual(call[0]!.input.to, [{ address: "maya@example.com" }]);
  assert.equal(call[0]!.input.route, "space_domain");
  assert.equal(call[0]!.input.idempotencyKey, "idem-ts-1");
});

test("test send says what is missing in words, and sends nothing, when the setup is not ready or there is no address to send from", async () => {
  const none = harness();
  await assert.rejects(
    () => testSend(none.ctx, { to: "maya@example.com", idempotencyKey: "k" }),
    (e: unknown) => codeOf(e) === "validation.precondition_failed",
  );
  const noBox = harness();
  seedDomain(noBox, {
    id: "dom_t",
    name: "northwind.example",
    provider: "resend",
    verified: true,
    isDefault: true,
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
  });
  await assert.rejects(
    () => testSend(noBox.ctx, { to: "maya@example.com", idempotencyKey: "k" }),
    (e: unknown) =>
      codeOf(e) === "validation.precondition_failed" &&
      /Make an address on northwind\.example/.test((e as { error: { message: string } }).error.message),
  );
  await assert.rejects(
    () => testSend(noBox.ctx, { to: "not an address", idempotencyKey: "k" }),
    (e: unknown) => codeOf(e) === "validation.bad_input",
  );
  assert.equal(sendsTo(none).length + sendsTo(noBox).length, 0);
});

test("a held or suppressed test is reported as such, not as sent", async () => {
  const h = harness();
  seedDomain(h, {
    id: "dom_t",
    name: "northwind.example",
    provider: "resend",
    verified: true,
    isDefault: true,
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
  });
  seedMailbox(h, "mbx_t", "hello@northwind.example", { kind: "shared" });
  script(h, { "mail.send": () => ({ status: "held", note: "Held until 9:00" }) });
  const out = await testSend(h.ctx, { to: "maya@example.com", idempotencyKey: "k2" });
  assert.deepEqual([out.status, out.note], ["held", "Held until 9:00"]);
});

// ---- mail.configure: the one tool a model is shown for email setup

import { setupTool } from "../handlers/setup.ts";

test("mail.configure routes each action to the capability behind the screen, keys the ones that change something, and refuses an action it does not know", async () => {
  const h = harness();
  const seen: { cap: string; input: Record<string, unknown> }[] = [];
  script(
    h,
    Object.fromEntries(
      [
        "mail.setup.status",
        "mail.setup.test_send",
        "mail.smtp.get",
        "mail.smtp.set",
        "mail.smtp.verify",
        "mail.address.list",
        "mail.address.add",
        "mail.address.move",
      ].map((cap) => [cap, (input: Record<string, unknown>) => (seen.push({ cap, input }), { ok: cap })]),
    ),
  );
  const route: [string, string][] = [
    ["status", "mail.setup.status"],
    ["test", "mail.setup.test_send"],
    ["smtp_get", "mail.smtp.get"],
    ["smtp_set", "mail.smtp.set"],
    ["smtp_verify", "mail.smtp.verify"],
    ["address_list", "mail.address.list"],
    ["address_add", "mail.address.add"],
    ["address_move", "mail.address.move"],
  ];
  const ARGS: Record<string, Record<string, unknown>> = {
    status: {},
    test: { to: "maya@example.com" },
    smtp_get: {},
    smtp_set: { host: "smtp.northwind.example", port: 587, username: "hello", passwordHandle: "#Smtp_Password" },
    smtp_verify: {},
    address_list: {},
    address_add: { domainId: "dom_1", localPart: "billing" },
    address_move: { domainId: "dom_1", localPart: "billing", fromMailboxId: "mbx_a", mailboxId: "mbx_b" },
  };
  for (const [action, cap] of route) {
    const out = await setupTool(h.ctx, { action: action as never, ...ARGS[action] });
    assert.deepEqual(out, { result: { ok: cap } });
  }
  assert.deepEqual(
    seen.map((s) => s.cap),
    route.map((r) => r[1]),
  );
  const keyed = seen.filter((s) => ["mail.setup.test_send", "mail.address.add", "mail.address.move"].includes(s.cap));
  assert.ok(
    keyed.every((s) => typeof s.input.idempotencyKey === "string" && (s.input.idempotencyKey as string).length > 0),
  );
  assert.ok(seen.filter((s) => !keyed.includes(s)).every((s) => !("idempotencyKey" in s.input)));
  // asking twice is the same key, so it is one call at the capability
  const again = await (async () => (
    (seen.length = 0),
    await setupTool(h.ctx, { action: "address_add", domainId: "dom_1", localPart: "a" }),
    await setupTool(h.ctx, { action: "address_add", domainId: "dom_1", localPart: "a" }),
    seen.map((s) => s.input.idempotencyKey)
  ))();
  assert.equal(again[0], again[1]);
  await assert.rejects(
    () => setupTool(h.ctx, { action: "nothing" as never }),
    (e: unknown) => codeOf(e) === "validation.bad_input",
  );
});

test("mail.configure answers a wrong or short call with that action's exact shape in one line, and calls nothing", async () => {
  const h = harness();
  const seen: string[] = [];
  script(h, {
    "mail.address.add": () => (seen.push("add"), {}),
    "mail.setup.test_send": () => (seen.push("test"), {}),
  });
  const said = async (input: Record<string, unknown>): Promise<string> =>
    setupTool(h.ctx, input as never).then(
      () => "",
      (e: unknown) =>
        (e as { error: { message: string; code: string } }).error.code +
        ": " +
        (e as { error: { message: string } }).error.message,
    );
  assert.equal(
    await said({ action: "address_add", domainId: "dom_1" }),
    "validation.bad_input: mail.configure address_add takes {domainId, localPart, mailboxId?, title?}; missing localPart.",
  );
  assert.equal(
    await said({ action: "test", address: "maya@example.com" }),
    "validation.bad_input: mail.configure test takes {to}; missing to; not used: address.",
  );
  assert.equal(
    await said({ action: "status", host: "x" }),
    "validation.bad_input: mail.configure status takes {}; not used: host.",
  );
  assert.match(
    await said({ action: "everything" }),
    /^validation\.bad_input: mail\.configure action is one of: status, test, smtp_get/,
  );
  assert.ok(!(await said({ action: "address_add", domainId: "dom_1", localPart: "a" })), "a right call goes through");
  assert.deepEqual(seen, ["add"], "the wrong calls reached no capability");
  assert.ok(
    !(await said({ action: "address_add", domainId: "dom_1", localPart: "a" }).then((x) => x.includes("\n"))),
    "one line",
  );
});
