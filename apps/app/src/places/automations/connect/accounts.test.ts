// The builder's account choice. A stored id stays. An empty list does not invent an account.
import test from "node:test";
import assert from "node:assert/strict";
import { accountMenu, applyAccount, chooseAccount } from "./accounts.ts";
import type { AccountOption } from "./accounts.ts";

const hub = (id: string, state: string, title = id): AccountOption => ({ app: "hubspot", id, title, state });
const kept = hub("con_kept", "active", "Kept");
const other = hub("con_other", "active", "Other");
const mailSchema = { type: "object", properties: { mailboxId: { type: "string" } } };
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
