// mail.address.list / add: a name on a Space domain, an alias into an inbox that exists, a half-finished add that a retry finishes, and a domain at your own mail server.
// Addresses are .example; no provider is called (Resend domains need none).
import test from "node:test";
import assert from "node:assert/strict";
import { addressAdd, addressList, addressMove } from "../handlers/address.ts";
import { hostError, script, seedDomain } from "../handlers/extra/kit.ts";
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

test("a bad name and a missing domain or inbox are refused in words, and nothing is half made", async () => {
  const h = setup();
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

const msg = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "",
    (e: unknown) => `${codeOf(e)}: ${(e as { error?: { message: string } }).error?.message ?? ""}`,
  );

test("adding a name that is taken is refused and says where its mail goes; nothing is repointed", async () => {
  const h = setup();
  seedMailbox(h, "mbx_accounts", "accounts@northwind.example", { kind: "shared", privacy: "space" });
  h.ctx.db.run(`UPDATE mail_mailbox SET title = ? WHERE id = ?`, "Accounts", "mbx_accounts");
  await addressAdd(h.ctx, {
    domainId: "dom_northwind",
    localPart: "billing",
    mailboxId: "mbx_accounts",
    idempotencyKey: key(),
  });
  const before = h.rows(`SELECT * FROM mail_route WHERE "localPart" = ? AND deleted_at IS NULL`, "billing");
  assert.equal(before.length, 1);
  // with no inbox chosen, and with another inbox chosen
  assert.match(
    await msg(addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "billing", idempotencyKey: key() })),
    /^validation\.duplicate: billing@northwind\.example already goes to Accounts/,
  );
  assert.match(
    await msg(
      addressAdd(h.ctx, {
        domainId: "dom_northwind",
        localPart: "billing",
        mailboxId: "mbx_hello",
        idempotencyKey: key(),
      }),
    ),
    /^validation\.duplicate: .*already goes to Accounts/,
  );
  // an inbox's own address is taken too
  assert.match(
    await msg(
      addressAdd(h.ctx, {
        domainId: "dom_northwind",
        localPart: "hello",
        mailboxId: "mbx_accounts",
        idempotencyKey: key(),
      }),
    ),
    /^validation\.duplicate/,
  );
  const after = h.rows(`SELECT * FROM mail_route WHERE "localPart" = ? AND deleted_at IS NULL`, "billing");
  assert.deepEqual(
    after.map((r) => r.mailboxId),
    ["mbx_accounts"],
    "the route still points at Accounts",
  );
  assert.equal(
    h.rows(`SELECT * FROM mail_mailbox WHERE address = ? AND deleted_at IS NULL`, "billing@northwind.example").length,
    0,
    "no empty inbox was made",
  );
});

test("a retry of the same add with the same key answers the same address, and a taken name's inbox title is never shown to someone who cannot open it", async () => {
  const h = setup();
  const k = key();
  const a = await addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "sales", idempotencyKey: k });
  const b = await addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "sales", idempotencyKey: k });
  assert.equal(b.address.mailboxId, a.address.mailboxId);
  h.denied.add(a.address.mailboxId);
  assert.match(
    await msg(addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "sales", idempotencyKey: key() })),
    /already goes to a private inbox\./,
  );
  const list = await addressList(h.ctx, {});
  assert.equal(list.addresses.find((x) => x.address === "sales@northwind.example")?.mailboxTitle, "A private inbox");
  assert.ok(list.addresses.find((x) => x.address === "hello@northwind.example")?.mailboxTitle !== "A private inbox");
});

test("an inbox the person cannot use, or someone else's personal inbox, cannot receive a new address", async () => {
  const h = setup();
  seedMailbox(h, "mbx_closed", "closed@northwind.example", { kind: "shared", privacy: "private" });
  seedMailbox(h, "mbx_maya", "maya@northwind.example", {
    kind: "personal",
    provider: "google",
    ownerId: "usr_other01",
  });
  h.denied.add("mbx_closed");
  assert.match(
    await msg(
      addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "a1", mailboxId: "mbx_closed", idempotencyKey: key() }),
    ),
    /^permission\.no_grant/,
  );
  assert.match(
    await msg(
      addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "a2", mailboxId: "mbx_maya", idempotencyKey: key() }),
    ),
    /^permission\.no_grant/,
  );
  assert.equal(h.rows(`SELECT * FROM mail_route`).length, 0);
});

test("a route that fails leaves no inbox behind, and the name can be added again with a new key", async () => {
  const h = harness();
  seedDomain(h, { id: "dom_mg", name: "mg.example", provider: "mailgun", verified: true, ref: "mg.example" });
  let down = true;
  script(h, {
    "mailgun.routes.create": () => {
      if (down) throw hostError(h, "provider.unavailable");
      return { route: { routeId: "mgr_1" } };
    },
  });
  await assert.rejects(() => addressAdd(h.ctx, { domainId: "dom_mg", localPart: "team", idempotencyKey: key() }));
  assert.equal(
    h.rows(`SELECT * FROM mail_mailbox WHERE address = ? AND deleted_at IS NULL`, "team@mg.example").length,
    0,
    "no orphan inbox",
  );
  down = false;
  const ok = await addressAdd(h.ctx, { domainId: "dom_mg", localPart: "team", idempotencyKey: key() });
  assert.equal(ok.address.address, "team@mg.example");
  assert.equal(
    h.rows(`SELECT * FROM mail_mailbox WHERE address = ? AND deleted_at IS NULL`, "team@mg.example").length,
    1,
  );
});

test("an inbox left without a route by an earlier stop is finished, not refused", async () => {
  const h = setup();
  seedMailbox(h, "mbx_orphan", "ops@northwind.example", { kind: "shared", privacy: "space" });
  const out = await addressAdd(h.ctx, { domainId: "dom_northwind", localPart: "ops", idempotencyKey: key() });
  assert.equal(out.address.mailboxId, "mbx_orphan");
  assert.equal(h.rows(`SELECT * FROM mail_route WHERE "localPart" = ? AND deleted_at IS NULL`, "ops").length, 1);
});

test("on your own mail server a new address is a send-only service inbox, never a shared inbox that looks like it receives", async () => {
  const h = setup();
  const a = await addressAdd(h.ctx, { domainId: "dom_own", localPart: "noreply", idempotencyKey: key() });
  assert.equal(a.address.receives, false);
  assert.equal(h.rows(`SELECT kind FROM mail_mailbox WHERE address = ?`, "noreply@own.example")[0]?.kind, "service");
});

test("move names the old and the new inbox, needs the person to see where it goes now, and to use the new inbox", async () => {
  const h = setup();
  seedMailbox(h, "mbx_accounts", "accounts@northwind.example", { kind: "shared", privacy: "space" });
  h.ctx.db.run(`UPDATE mail_mailbox SET title = ? WHERE id = ?`, "Accounts", "mbx_accounts");
  seedMailbox(h, "mbx_closed", "closed@northwind.example", { kind: "shared", privacy: "private" });
  await addressAdd(h.ctx, {
    domainId: "dom_northwind",
    localPart: "billing",
    mailboxId: "mbx_accounts",
    idempotencyKey: key(),
  });
  const move = (over: Record<string, unknown>) =>
    addressMove(h.ctx, {
      domainId: "dom_northwind",
      localPart: "billing",
      fromMailboxId: "mbx_accounts",
      mailboxId: "mbx_hello",
      idempotencyKey: key(),
      ...over,
    } as never);
  assert.match(
    await msg(move({ fromMailboxId: "mbx_hello" })),
    /^validation\.duplicate: .*now goes to Accounts, not where you saw it/,
  );
  h.denied.add("mbx_closed");
  assert.match(await msg(move({ mailboxId: "mbx_closed" })), /^permission\.no_grant/);
  assert.match(
    await msg(
      addressMove(h.ctx, {
        domainId: "dom_northwind",
        localPart: "nothing",
        fromMailboxId: "mbx_accounts",
        mailboxId: "mbx_hello",
        idempotencyKey: key(),
      }),
    ),
    /^validation\.not_found/,
  );
  const done = await move({});
  assert.deepEqual(contractErrors("mail.address.move", "out", done), []);
  assert.equal(done.from, "Accounts");
  assert.equal(done.address.mailboxId, "mbx_hello");
  assert.deepEqual(
    h
      .rows(`SELECT "mailboxId" FROM mail_route WHERE "localPart" = ? AND deleted_at IS NULL`, "billing")
      .map((r) => r.mailboxId),
    ["mbx_hello"],
  );
  // the same move again changes nothing
  assert.equal((await move({ fromMailboxId: "mbx_hello" })).address.mailboxId, "mbx_hello");
});
