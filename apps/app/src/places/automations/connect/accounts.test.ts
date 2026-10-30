// The builder's account choice. A stored id stays. An empty list does not invent an account.
import test from "node:test";
import assert from "node:assert/strict";
import { accountDefaultInput, accountMenu, accountsFromVault, applyAccount, chooseAccount, picksByApp } from "./accounts.ts";
import type { AccountOption } from "./accounts.ts";

const hub = (id: string, state: string, title = id): AccountOption => ({ app: "hubspot", id, title, state });
const kept = hub("con_kept", "active", "Kept");
const other = hub("con_other", "active", "Other");
const mailSchema = { type: "object", properties: { mailboxId: { type: "string" } } };
const connectionSchema = { type: "object", properties: { connectionId: { type: "string" } } };
const plainSchema = { type: "object", properties: { to: { type: "string" } } };

test("a stored connectionId is kept when another active account exists", () => {
  const menu = accountMenu({ input: { connectionId: "con_kept", connector: "hubspot" }, accounts: [kept, other] });
  assert.equal(menu?.value, "Kept (active)");
  assert.equal(menu?.items.find((item) => item.checked)?.account?.id, "con_kept");
  assert.deepEqual(chooseAccount({ input: { connectionId: "con_kept" }, app: "hubspot", accounts: [kept, other] }), { id: "con_kept", chosen: "stored" });
});

test("a single active account is the default only when the step has no id", () => {
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [kept] }), { id: "con_kept", chosen: "only" });
  assert.deepEqual(chooseAccount({ input: { connectionId: "con_old" }, app: "hubspot", accounts: [kept] }), { id: "con_old", chosen: "stored" });
});

test("two active accounts and no sibling and no last pick returns none", () => {
  const menu = accountMenu({ input: { connector: "hubspot" }, schema: { type: "object", properties: { connectionId: { type: "string" } } }, accounts: [kept, other] });
  assert.equal(menu?.value, "Choose an account");
  assert.equal(menu?.items.some((item) => item.checked), false);
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [kept, other] }), { chosen: "none" });
});

test("a sibling id is reused", () => {
  assert.deepEqual(chooseAccount({
    input: {},
    app: "hubspot",
    nodes: [{ input: { connectionId: "con_kept", connector: "hubspot" } }],
    accounts: [kept, other],
  }), { id: "con_kept", chosen: "sibling" });
});

test("a last pick is reused only when the step has no id", () => {
  const last = { hubspot: "con_other" };
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [kept, other], last }), { id: "con_other", chosen: "last" });
  assert.deepEqual(chooseAccount({ input: { connectionId: "con_kept" }, app: "hubspot", accounts: [kept, other], last }), { id: "con_kept", chosen: "stored" });
});

test("a paused account is not a new default, and a stored paused id stays with needs reconnect", () => {
  const paused = hub("con_paused", "paused", "Old");
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [paused] }), { chosen: "none" });
  assert.deepEqual(chooseAccount({ input: { connectionId: "con_paused" }, app: "hubspot", accounts: [paused, other] }), { id: "con_paused", chosen: "stored" });
  const menu = accountMenu({ input: { connectionId: "con_paused", connector: "hubspot" }, accounts: [paused, other] });
  assert.equal(menu?.value, "Old (needs reconnect)");
  assert.equal(menu?.items.find((item) => item.checked)?.account?.id, "con_paused");
});

test("an empty list says there are no accounts and does not invent one", () => {
  const menu = accountMenu({ input: {}, schema: mailSchema, accounts: [] });
  assert.equal(menu?.field, "mailboxId");
  assert.equal(menu?.value, "No accounts yet");
  assert.deepEqual(menu?.items, [{ label: "No accounts yet", checked: false }]);
  assert.equal(accountMenu({ input: { to: "a@b.c" }, schema: plainSchema }), undefined);
});

test("a stored id with an empty list stays, and the empty row does not clear it", () => {
  const menu = accountMenu({ input: { connectionId: "con_kept", connector: "hubspot", subject: "Hi" }, accounts: [] });
  assert.equal(menu?.value, "con_kept");
  assert.equal(menu?.items[0]?.account, undefined);
  const next = applyAccount({ connectionId: "con_kept", connector: "hubspot", subject: "Hi" }, "connectionId", other);
  assert.deepEqual(next, { connectionId: "con_other", connector: "hubspot", subject: "Hi" });
});

test("the catalog schema shows the picker before an id is stored", () => {
  const menu = accountMenu({
    input: {},
    schema: mailSchema,
    accounts: [{ app: "mail", id: "mbx_main", title: "Main", state: "active" }],
  });
  assert.equal(menu?.field, "mailboxId");
  assert.equal(menu?.value, "Main (active)");
  const written = applyAccount({}, "mailboxId", { app: "mail", id: "mbx_main", title: "Main", state: "active" });
  assert.deepEqual(written, { mailboxId: "mbx_main" });
  assert.equal("connectionId" in written, false);
});

test("a computed default is written once, and a stored id is not replaced", () => {
  const only = accountDefaultInput({
    input: { connector: "hubspot", subject: "Hi" },
    schema: connectionSchema,
    accounts: [kept],
  });
  assert.deepEqual(only, { connector: "hubspot", subject: "Hi", connectionId: "con_kept" });
  assert.equal(accountDefaultInput({ input: only!, schema: connectionSchema, accounts: [kept, other] }), undefined);

  const sibling = accountDefaultInput({
    input: { connector: "hubspot" },
    schema: connectionSchema,
    nodes: [{ input: { connectionId: "con_kept", connector: "hubspot" } }],
    accounts: [kept, other],
  });
  assert.deepEqual(sibling, { connector: "hubspot", connectionId: "con_kept" });

  const last = accountDefaultInput({
    input: { connector: "hubspot" },
    schema: connectionSchema,
    accounts: [kept, other],
    last: { hubspot: "con_other" },
  });
  assert.deepEqual(last, { connector: "hubspot", connectionId: "con_other" });
  assert.equal(accountDefaultInput({ input: last!, schema: connectionSchema, accounts: [kept, other], last: { hubspot: "con_kept" } }), undefined);
});

test("no real checked account writes nothing, and an id is not cleared", () => {
  assert.equal(accountDefaultInput({ input: { connector: "hubspot" }, schema: connectionSchema, accounts: [kept, other] }), undefined);
  assert.equal(accountDefaultInput({ input: {}, schema: mailSchema, accounts: [] }), undefined);
  assert.equal(accountDefaultInput({ input: { connector: "hubspot" }, schema: connectionSchema, accounts: [hub("con_paused", "paused", "Old")] }), undefined);
  assert.equal(accountDefaultInput({ input: { connectionId: "con_kept", connector: "hubspot", subject: "Hi" }, accounts: [] }), undefined);
  const mail = accountDefaultInput({
    input: { to: "a@b.c" },
    schema: mailSchema,
    accounts: [{ app: "mail", id: "mbx_main", title: "Main", state: "active" }],
  });
  assert.deepEqual(mail, { to: "a@b.c", mailboxId: "mbx_main" });
  assert.equal(accountDefaultInput({ input: mail!, schema: mailSchema, accounts: [] }), undefined);
});

test("vault rows become account options, and failing, error, and disconnected are not a new default", () => {
  const rows = accountsFromVault(
    { connections: [
      { connectionId: "con_ok", connector: "hubspot", title: "Ok", state: "active", secrets: { token: "hidden" } },
      { connectionId: "con_bad", connector: "hubspot", title: "Bad", state: "failing" },
      { title: "Missing id", connector: "hubspot", state: "active" },
    ] },
    { mailboxes: [
      { id: "mbx_sync", title: "Sync", address: "a@b.c", state: "syncing" },
      { id: "mbx_err", title: "Err", address: "e@b.c", state: "error" },
      { id: "mbx_off", address: "off@b.c", state: "disconnected" },
      { id: "mbx_live", title: "", address: "live@b.c", state: "active" },
    ] },
  );
  assert.deepEqual(rows, [
    { app: "hubspot", id: "con_ok", title: "Ok", state: "active" },
    { app: "hubspot", id: "con_bad", title: "Bad", state: "needs_reconnect" },
    { app: "mail", id: "mbx_sync", title: "Sync", state: "active" },
    { app: "mail", id: "mbx_err", title: "Err", state: "needs_reconnect" },
    { app: "mail", id: "mbx_off", title: "off@b.c", state: "needs_reconnect" },
    { app: "mail", id: "mbx_live", title: "live@b.c", state: "active" },
  ]);
  assert.equal(accountsFromVault(null, { mailboxes: [] }), null);
  assert.equal(accountsFromVault({ connections: [] }, { boxes: [] }), null);
  assert.deepEqual(picksByApp({ picks: [{ app: "mail", accountId: "mbx_main", secret: "no" }, { app: "", accountId: "x" }] }), { mail: "mbx_main" });
  assert.equal(picksByApp({}), null);

  const next = accountDefaultInput({ input: { connector: "hubspot" }, schema: connectionSchema, accounts: rows ?? [] });
  assert.deepEqual(next, { connector: "hubspot", connectionId: "con_ok" });
  assert.equal(accountDefaultInput({ input: { connectionId: "con_bad", connector: "hubspot" }, accounts: rows ?? [] }), undefined);
  const mail = accountDefaultInput({
    input: {},
    schema: mailSchema,
    accounts: (rows ?? []).filter((account) => account.id !== "mbx_live"),
  });
  assert.deepEqual(mail, { mailboxId: "mbx_sync" });
});
