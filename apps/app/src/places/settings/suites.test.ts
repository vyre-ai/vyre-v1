import test from "node:test";
import assert from "node:assert/strict";
import { NOT_CONNECTED, suiteSections, throughFirm } from "./suites.ts";

test("a person sees their mailboxes and calendars under the suite they come through", () => {
  const s = suiteSections(
    [{ id: "mbx_1", address: "noah@firm.test", provider: "google", state: "syncing" }, { id: "mbx_2", address: "me@elsewhere.test", provider: "imap", state: "syncing" }],
    [{ id: "cld_1", title: "Google Calendar", provider: "google", state: "syncing" }, { id: "cld_2", title: "Personal", provider: "local", state: "syncing" }],
  );
  assert.deepEqual(s.map((x) => [x.key, x.title, x.rows.map((r) => [r.service, r.detail, r.state])]), [["google", "Google Workspace", [["Mail", "noah@firm.test", "Syncing"], ["Calendar", "Google Calendar", "Syncing"]]]]);
  assert.equal(throughFirm(s[0]!), "Connected by your admin");
});

test("Microsoft comes through the same way, and a suite with nothing for this person is not listed", () => {
  const s = suiteSections([{ id: "mbx_3", address: "noah@firm.test", provider: "microsoft", state: "pending" }], []);
  assert.deepEqual(s.map((x) => x.title), ["Microsoft 365"]);
  assert.equal(s[0]!.rows[0]!.state, "Connecting");
  assert.deepEqual(suiteSections([], []), []);
});

test("a connection that needs attention tells the person who to ask", () => {
  const s = suiteSections([{ id: "mbx_4", address: "a@firm.test", provider: "google", state: "error" }], []);
  assert.match(throughFirm(s[0]!), /Needs attention: ask your admin/);
});

test("when the admin has not connected a suite, the line is one short sentence that says who to ask and where", () => {
  assert.match(NOT_CONNECTED, /Ask your admin: Console, Integrations/);
  assert.ok(NOT_CONNECTED.length < 70, "a line, not a paragraph");
});
