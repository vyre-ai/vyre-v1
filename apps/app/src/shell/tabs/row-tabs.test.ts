// A row of the Vault's or the Inbox's sidebar is a tab of its own when opened beside (lane r32-nav): its own key and its own name, never the place's tab again.
import test from "node:test";
import assert from "node:assert/strict";
import { screenTitle, tabKey } from "./store.ts";

test("a Vault row and a Vault folder each have their own tab key and name", () => {
  assert.equal(tabKey("vault", "screen=vault.layout&select=logins"), "vault:select=logins");
  assert.equal(tabKey("vault", "screen=vault.layout&folder=fld_1"), "vault:folder=fld_1");
  assert.equal(tabKey("vault", ""), "vault");
  assert.equal(screenTitle("screen=vault.layout&select=logins"), "Logins");
  assert.equal(screenTitle("screen=vault.layout&folder=fld_1"), "Shared folder");
});

test("an Inbox row has its own tab key and name; two different rows are two tabs", () => {
  const a = "screen=inbox.contact-list&scope=all&view=thread";
  const b = "screen=inbox.contact-list&scope=starred";
  assert.notEqual(tabKey("inbox", a), tabKey("inbox", b));
  assert.equal(screenTitle(a), "All inboxes");
  assert.equal(screenTitle(b), "Starred");
  assert.equal(screenTitle("screen=inbox.contact-list&main=calendar"), "Calendar");
  assert.equal(tabKey("inbox", ""), "inbox");
});
