// mail.route.list / set / remove (P-L5_01c): inbound routes from an address on a Space domain to a mailbox.
import test from "node:test";
import assert from "node:assert/strict";
import { mailgunExpression, routeList, routeRemove, routeSet } from "../handlers/extra/routes.ts";
import { eventErrors, hostError, script, seedDomain } from "../handlers/extra/kit.ts";
import { ingest } from "../handlers/ingest.ts";
import { codeOf, contractErrors, harness, letter, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

let keys = 0;
const key = (): string => `idem-rte-${++keys}`;

function setup(): Harness {
  const h = harness();
  seedMailbox(h, "mbx_hello", "hello@example.com", { kind: "shared", privacy: "space" });
  seedMailbox(h, "mbx_support", "support@example.com", { kind: "shared", privacy: "space" });
  seedDomain(h, { id: "dom_resend", name: "example.com", provider: "resend" });
  seedDomain(h, { id: "dom_mailgun", name: "mg.example.org", provider: "mailgun", ref: "mg.example.org" });
  return h;
}

const route = (h: Harness, id: string) => h.rows(`SELECT * FROM mail_route WHERE id = ?`, id)[0]!;

test("set routes an address on a Resend domain to a mailbox with no provider call", async () => {
  const h = setup();
  const out = await routeSet(h.ctx, { domainId: "dom_resend", localPart: " Hello ", mailboxId: "mbx_hello", idempotencyKey: key() });
  assert.deepEqual(contractErrors("mail.route.set", "out", out), []);
  const r = out.route;
  assert.deepEqual([r.domainId, r.localPart, r.mailboxId, r.provider], ["dom_resend", "hello", "mbx_hello", "resend"]);
  assert.match(r.id, /^rte_[a-z0-9]+$/);
  assert.equal(h.called.length, 0);
  assert.deepEqual(h.named("inbound_route.saved").map((e) => [e.subject, e.payload]), [["domain/dom_resend", { routeId: r.id, domainId: "dom_resend", localPart: "hello", mailboxId: "mbx_hello" }]]);
  assert.deepEqual(eventErrors(h), []);
});

test("set on a taken address moves it to the new mailbox and keeps one route", async () => {
  const h = setup();
  const first = await routeSet(h.ctx, { domainId: "dom_resend", localPart: "hello", mailboxId: "mbx_hello", idempotencyKey: key() });
  const moved = await routeSet(h.ctx, { domainId: "dom_resend", localPart: "hello", mailboxId: "mbx_support", idempotencyKey: key() });
  assert.equal(moved.route.id, first.route.id);
  assert.deepEqual([moved.route.mailboxId, route(h, first.route.id).version], ["mbx_support", 2]);
  assert.equal(h.rows(`SELECT id FROM mail_route`).length, 1);
  assert.equal(h.named("inbound_route.saved").length, 2);
  await routeSet(h.ctx, { domainId: "dom_resend", localPart: "hello", mailboxId: "mbx_support", idempotencyKey: key() });   // same target: no new version
  assert.equal(route(h, first.route.id).version, 2);
});

test("set with the same key answers the first route and announces nothing again", async () => {
  const h = setup();
  const k = key();
  const a = await routeSet(h.ctx, { domainId: "dom_resend", localPart: "sales", mailboxId: "mbx_hello", idempotencyKey: k });
  const b = await routeSet(h.ctx, { domainId: "dom_resend", localPart: "sales", mailboxId: "mbx_hello", idempotencyKey: k });
  assert.deepEqual(b, a);
  assert.equal(h.named("inbound_route.saved").length, 1);
});

test("set on a Mailgun domain creates the provider route and remembers its id", async () => {
  const h = setup();
  script(h, { "mailgun.routes.create": (i) => ({ route: { routeId: "mgr_1", expression: i.expression, forwardTo: [], priority: 0 } }) });
  const setKey = key();
  const out = await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "hello", mailboxId: "mbx_hello", idempotencyKey: setKey });
  assert.equal(out.route.provider, "mailgun");
  assert.deepEqual(h.calls("mailgun.routes.create").map((c) => c.input), [
    { idempotencyKey: `${setKey}:mailgun.routes.create`, expression: 'match_recipient("hello@mg.example.org")', description: "Vyre inbound route for hello@mg.example.org" },
  ]);
  assert.deepEqual(h.rows(`SELECT "providerRouteId" FROM mail_route_ext WHERE "routeId" = ?`, out.route.id).map((r) => r.providerRouteId), ["mgr_1"]);
  await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "hello", mailboxId: "mbx_support", idempotencyKey: key() });
  assert.equal(h.calls("mailgun.routes.create").length, 1);   // moving the target needs no new provider route
});

test("the catch-all route matches every address on the domain", async () => {
  assert.equal(mailgunExpression("*", "mg.example.org"), 'match_recipient(".*@mg\\.example\\.org")');
  assert.equal(mailgunExpression("hello", "mg.example.org"), 'match_recipient("hello@mg.example.org")');
  const h = setup();
  script(h, { "mailgun.routes.create": () => ({ route: { routeId: "mgr_9", expression: "", forwardTo: [], priority: 0 } }) });
  const out = await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "*", mailboxId: "mbx_hello", idempotencyKey: key() });
  assert.equal(out.route.localPart, "*");
});

test("set refuses a bad address part, an unknown domain or mailbox, and a provider that returns no route", async () => {
  const h = setup();
  for (const part of ["", "a b", "-x", "x-", "x@y", "a/b", "A".repeat(70)]) {
    await assert.rejects(routeSet(h.ctx, { domainId: "dom_resend", localPart: part, mailboxId: "mbx_hello", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input", part);
  }
  await assert.rejects(routeSet(h.ctx, { domainId: "dom_nope", localPart: "x", mailboxId: "mbx_hello", idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(routeSet(h.ctx, { domainId: "domain", localPart: "x", mailboxId: "mbx_hello", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(routeSet(h.ctx, { domainId: "dom_resend", localPart: "x", mailboxId: "mbx_nope", idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(routeSet(h.ctx, { domainId: "dom_resend", localPart: "x", mailboxId: "box", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(routeSet(h.ctx, { domainId: "dom_resend", localPart: "x", mailboxId: "mbx_hello", idempotencyKey: "" }), (e) => codeOf(e) === "validation.bad_input");
  script(h, { "mailgun.routes.create": () => ({ route: {} }) });
  await assert.rejects(routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "x", mailboxId: "mbx_hello", idempotencyKey: key() }), (e) => codeOf(e) === "provider.bad_response");
  assert.equal(h.rows(`SELECT id FROM mail_route`).length, 0);
  assert.equal(h.emitted.length, 0);
});

test("a route lets mail for its address land in the mailbox", async () => {
  const h = setup();
  await routeSet(h.ctx, { domainId: "dom_resend", localPart: "billing", mailboxId: "mbx_support", idempotencyKey: key() });   // billing@ is no mailbox address, only a route
  const landed = await ingest(h.ctx, letter("pat@acme.test", "<r1@x>", "re-in-1", { source: "resend", envelopeTo: "Billing@Example.com" }));
  assert.equal(h.rows(`SELECT "mailboxId" FROM mail_message WHERE id = ?`, landed.messageId)[0]!.mailboxId, "mbx_support");
  await routeRemove(h.ctx, { routeId: (await routeList(h.ctx, {})).routes[0]!.id, domainId: "dom_resend" });
  await assert.rejects(ingest(h.ctx, letter("pat@acme.test", "<r2@x>", "re-in-2", { source: "resend", envelopeTo: "billing@example.com" })), (e) => codeOf(e) === "validation.not_found");
});

test("list shows routes by domain and address, filters by domain and pages", async () => {
  const h = setup();
  script(h, { "mailgun.routes.create": () => ({ route: { routeId: "mgr_1" } }) });
  await routeSet(h.ctx, { domainId: "dom_resend", localPart: "sales", mailboxId: "mbx_hello", idempotencyKey: key() });
  await routeSet(h.ctx, { domainId: "dom_resend", localPart: "hello", mailboxId: "mbx_hello", idempotencyKey: key() });
  await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "help", mailboxId: "mbx_support", idempotencyKey: key() });
  const all = await routeList(h.ctx, {});
  assert.deepEqual(contractErrors("mail.route.list", "out", all), []);
  assert.deepEqual(all.routes.map((r) => `${r.domainId}/${r.localPart}`), ["dom_mailgun/help", "dom_resend/hello", "dom_resend/sales"]);
  assert.deepEqual((await routeList(h.ctx, { domainId: "dom_resend" })).routes.map((r) => [r.localPart, r.provider]), [["hello", "resend"], ["sales", "resend"]]);
  const page = await routeList(h.ctx, { limit: 2 });
  assert.deepEqual([page.routes.length, page.next, page.total], [2, "2", 3]);
  await assert.rejects(routeList(h.ctx, { domainId: "x" }), (e) => codeOf(e) === "validation.bad_input");
});

test("remove deletes the route and its Mailgun route, announces once, and a retry is quiet", async () => {
  const h = setup();
  script(h, { "mailgun.routes.create": () => ({ route: { routeId: "mgr_1" } }), "mailgun.routes.delete": () => ({ deleted: true }) });
  const { route: r } = await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "help", mailboxId: "mbx_support", idempotencyKey: key() });
  const out = await routeRemove(h.ctx, { routeId: r.id, domainId: "dom_mailgun" });
  assert.deepEqual(contractErrors("mail.route.remove", "out", out), []);
  assert.deepEqual(out, { removed: true });
  assert.deepEqual(h.calls("mailgun.routes.delete").map((c) => c.input), [{ idempotencyKey: `mail.routes.remove:${r.id}`, routeId: "mgr_1" }]);
  assert.equal(route(h, r.id).deleted_at, NOW);
  assert.deepEqual(h.named("inbound_route.removed").map((e) => [e.subject, e.payload]), [["domain/dom_mailgun", { routeId: r.id, domainId: "dom_mailgun" }]]);
  assert.deepEqual(await routeRemove(h.ctx, { routeId: r.id, domainId: "dom_mailgun" }), { removed: true });
  assert.equal(h.named("inbound_route.removed").length, 1);
  assert.equal(h.calls("mailgun.routes.delete").length, 1);
  assert.deepEqual((await routeList(h.ctx, {})).routes, []);
  // The address can be routed again after it was removed.
  const again = await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "help", mailboxId: "mbx_support", idempotencyKey: key() });
  assert.notEqual(again.route.id, r.id);
  assert.deepEqual(eventErrors(h), []);
});

test("remove tolerates a provider that lost the route, stops on any other provider error, and checks the domain", async () => {
  const h = setup();
  script(h, { "mailgun.routes.create": () => ({ route: { routeId: "mgr_1" } }) });
  const { route: r } = await routeSet(h.ctx, { domainId: "dom_mailgun", localPart: "help", mailboxId: "mbx_support", idempotencyKey: key() });
  script(h, { "mailgun.routes.delete": () => { throw hostError(h, "provider.auth_failed"); } });
  await assert.rejects(routeRemove(h.ctx, { routeId: r.id, domainId: "dom_mailgun" }), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(route(h, r.id).deleted_at, null);
  script(h, { "mailgun.routes.delete": () => { throw hostError(h, "validation.not_found"); } });
  assert.deepEqual(await routeRemove(h.ctx, { routeId: r.id, domainId: "dom_mailgun" }), { removed: true });
  await assert.rejects(routeRemove(h.ctx, { routeId: r.id, domainId: "dom_resend" }), (e) => codeOf(e) === "validation.not_found");   // wrong domain
  await assert.rejects(routeRemove(h.ctx, { routeId: "rte_nope", domainId: "dom_resend" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(routeRemove(h.ctx, { routeId: "route", domainId: "dom_resend" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(routeRemove(h.ctx, { routeId: r.id, domainId: "domain" }), (e) => codeOf(e) === "validation.bad_input");
});
