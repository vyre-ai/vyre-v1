// mail.address.list / add: a name on a Space domain, an alias into an inbox that exists, a half-finished add that a retry finishes, and a domain at your own mail server.
// Addresses are .example; no provider is called (Resend domains need none).
import test from "node:test";
import assert from "node:assert/strict";
import { addressAdd, addressList } from "../handlers/address.ts";
import { seedDomain } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

let n = 0;
const key = (): string => `idem-addr-${++n}`;
function setup(): Harness {
  const h = harness();
  seedDomain(h, { id: "dom_northwind", name: "northwind.example", provider: "resend", verified: true });
  seedDomain(h, { id: "dom_own", name: "own.example", provider: "smtp", verified: true });
  seedMailbox(h, "mbx_hello", "hello@northwind.example", { kind: "shared", privacy: "space" });
  return h;
}
const nothing = async <T>(p: Promise<T>): Promise<string> =>
  p.then(
    () => "",
    (e) => codeOf(e),
  );

test("typing billing@ makes the address and a shared inbox behind it, once, however often it is retried", async () => {
  const h = setup();
  const k = key();
  const a = await addressAdd(h.ctx, { domainId: "dom_northwind", localPart: " Billing ", idempotencyKey: k });
  assert.deepEqual(contractErrors("mail.address.add", "out", a), []);
  assert.equal(a.address.address, "billing@northwind.example");
  assert.equal(a.address.kind, "mailbox");
  assert.equal(a.address.receives, true);
  const again = await addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "billing", idempotencyKey: k });
  assert.equal(again.address.mailboxId, a.address.mailboxId);
  assert.equal(h.rows(`SELECT * FROM mail_mailbox WHERE address = ?`, "billing@northwind.example").length, 1);
  assert.equal(h.rows(`SELECT * FROM mail_route WHERE "localPart" = ? AND deleted_at IS NULL`, "billing").length, 1);
});

test("an alias delivers to an inbox that already exists and lists once under its own name", async () => {
  const h = setup();
  const a = await addressAdd(h.ctx, {
    domainId: "dom_northwind",
    localPart: "invoices",
    mailboxId: "mbx_hello",
    idempotencyKey: key(),
  });
  assert.equal(a.address.kind, "alias");
  assert.equal(a.address.mailboxId, "mbx_hello");
  assert.ok(a.address.routeId);
  const list = await addressList(h.ctx, {});
  assert.deepEqual(contractErrors("mail.address.list", "out", list), []);
  assert.deepEqual(
    list.addresses.map((x) => [x.address, x.kind, x.mailboxId]),
    [
      ["hello@northwind.example", "mailbox", "mbx_hello"],
      ["invoices@northwind.example", "alias", "mbx_hello"],
    ],
  );
});

test("a taken name, a bad name and a missing domain or inbox are refused in words, and nothing is half made", async () => {
  const h = setup();
  assert.equal(
    await nothing(addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "hello", idempotencyKey: key() })),
    "validation.duplicate",
  );
  assert.equal(
    await nothing(addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "bad name", idempotencyKey: key() })),
    "validation.bad_input",
  );
  assert.equal(
    await nothing(addressAdd(h.ctx, { domainId: "dom_missing", localPart: "x", idempotencyKey: key() })),
    "validation.not_found",
  );
  assert.equal(
    await nothing(
      addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "x", mailboxId: "mbx_gone", idempotencyKey: key() }),
    ),
    "validation.not_found",
  );
  assert.equal(h.rows(`SELECT * FROM mail_route`).length, 0);
});

test("an address on your own mail server can send but is told it does not receive; an alias there is refused", async () => {
  const h = setup();
  const a = await addressAdd(h.ctx, { domainId: "dom_own", localPart: "team", idempotencyKey: key() });
  assert.equal(a.address.receives, false);
  assert.equal(h.rows(`SELECT * FROM mail_route`).length, 0);
  assert.equal(
    await nothing(
      addressAdd(h.ctx, { domainId: "dom_own", localPart: "alias", mailboxId: "mbx_hello", idempotencyKey: key() }),
    ),
    "validation.bad_input",
  );
  const list = await addressList(h.ctx, { domainId: "dom_own" });
  assert.deepEqual(
    list.addresses.map((x) => [x.address, x.receives]),
    [["team@own.example", false]],
  );
});
