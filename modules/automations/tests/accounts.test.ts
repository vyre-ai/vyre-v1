// A step keeps the account id it was given. Defaults apply only when the step has no id.
import test from "node:test";
import assert from "node:assert/strict";
import { chooseAccount, lastPicks } from "../accounts.ts";
import type { AccountOption } from "../accounts.ts";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, create, node } from "../fixtures/seed.ts";

const hub = (id: string, state: string, title = id): AccountOption => ({ app: "hubspot", id, title, state });
const kept = hub("con_kept", "active", "Kept");
const other = hub("con_other", "active", "Other");
const paused = hub("con_paused", "paused", "Paused");

function picks(h: Harness): { principal_id: string; app: string; account_id: string }[] {
  const rows = h.db.all("SELECT principal_id, app, account_id FROM automations_account_pick ORDER BY app") as { principal_id: string; app: string; account_id: string }[];
  return rows.map((row) => ({ principal_id: row.principal_id, app: row.app, account_id: row.account_id }));
}

test("a stored connectionId is kept when another active account exists", () => {
  assert.deepEqual(chooseAccount({
    input: { connectionId: "con_kept", connector: "hubspot" },
    app: "hubspot",
    accounts: [kept, other],
  }), { id: "con_kept", chosen: "stored" });
});

test("a single active account is the default only when the step has no id", () => {
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [kept] }), { id: "con_kept", chosen: "only" });
  assert.deepEqual(chooseAccount({
    input: { connectionId: "con_other" },
    app: "hubspot",
    accounts: [kept],
  }), { id: "con_other", chosen: "stored" });
});

test("two active accounts and no sibling and no last pick returns none", () => {
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [kept, other] }), { chosen: "none" });
});

test("a sibling id is reused", () => {
  assert.deepEqual(chooseAccount({
    input: {},
    app: "hubspot",
    nodes: [{ input: { connectionId: "con_kept", connector: "hubspot" } }],
    accounts: [kept, other],
  }), { id: "con_kept", chosen: "sibling" });
  assert.deepEqual(chooseAccount({
    input: {},
    app: "mail",
    nodes: [{ input: { mailboxId: "mbx_main" } }],
    accounts: [
      { app: "mail", id: "mbx_main", title: "Main", state: "active" },
      { app: "mail", id: "mbx_other", title: "Other", state: "active" },
    ],
  }), { id: "mbx_main", chosen: "sibling" });
});

test("a last pick is reused only when the step has no id", () => {
  const last = { hubspot: "con_other" };
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [kept, other], last }), { id: "con_other", chosen: "last" });
  assert.deepEqual(chooseAccount({
    input: { connectionId: "con_kept" },
    app: "hubspot",
    accounts: [kept, other],
    last,
  }), { id: "con_kept", chosen: "stored" });
});

test("a paused account is not chosen as a new default, but a stored paused id is kept", () => {
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [paused] }), { chosen: "none" });
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts: [paused, kept] }), { id: "con_kept", chosen: "only" });
  assert.deepEqual(chooseAccount({
    input: {},
    app: "hubspot",
    accounts: [kept, other, { app: "hubspot", id: "con_pending", title: "Wait", state: "pending" }],
    last: { hubspot: "con_pending" },
  }), { chosen: "none" });
  assert.deepEqual(chooseAccount({
    input: { connectionId: "con_paused" },
    app: "hubspot",
    accounts: [paused, other],
  }), { id: "con_paused", chosen: "stored" });
  assert.deepEqual(chooseAccount({
    input: { mailboxId: "mbx_paused" },
    app: "mail",
    accounts: [{ app: "mail", id: "mbx_live", title: "Live", state: "active" }],
  }), { id: "mbx_paused", chosen: "stored" });
});

test("create and update store the pick, and a step with no id can read it as last", async () => {
  const h = harness();
  const id = (await h.call("automations.create", create(), alice)).automation.id as string;
  assert.deepEqual(picks(h), []);

  await h.call("automations.update", {
    automationId: id,
    definition: {
      triggers: [{ key: "manual" }],
      nodes: [node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "active" }, connectionId: "con_kept", connector: "hubspot" })],
    },
  }, alice);
  assert.deepEqual(picks(h), [{ principal_id: alice.id, app: "hubspot", account_id: "con_kept" }]);

  await h.call("automations.create", create({
    name: "Mailbox and a bare connection",
    definition: {
      triggers: [{ key: "manual" }],
      nodes: [
        node("m", "send_email", { to: "a@example.com", subject: "Hi", body: "Hello", mailboxId: "mbx_main" }),
        node("b", "records.find", { type: "contact", connectionId: "con_bare" }),
      ],
    },
  }), alice);
  assert.deepEqual(picks(h), [
    { principal_id: alice.id, app: "connection", account_id: "con_bare" },
    { principal_id: alice.id, app: "hubspot", account_id: "con_kept" },
    { principal_id: alice.id, app: "mail", account_id: "mbx_main" },
  ]);

  const accounts = [kept, other];
  const last = lastPicks(h.db, alice.id);
  assert.deepEqual(chooseAccount({ input: {}, app: "hubspot", accounts, last }), { id: "con_kept", chosen: "last" });
  assert.deepEqual(chooseAccount({ input: { connectionId: "con_other" }, app: "hubspot", accounts, last }), { id: "con_other", chosen: "stored" });

  await h.call("automations.update", { automationId: id, name: "Renamed only" }, alice);
  assert.equal(picks(h).find((row) => row.app === "hubspot")?.account_id, "con_kept");
});

test("account_picks returns the stored app and id and nothing else", async () => {
  const h = harness();
  await h.call("automations.create", create({
    name: "Mailbox",
    definition: {
      triggers: [{ key: "manual" }],
      nodes: [node("m", "send_email", { to: "a@example.com", subject: "Hi", body: "Hello", mailboxId: "mbx_main" })],
    },
  }), alice);
  assert.deepEqual(await h.call("automations.account_picks", {}, alice), {
    picks: [{ app: "mail", accountId: "mbx_main" }],
  });
});
