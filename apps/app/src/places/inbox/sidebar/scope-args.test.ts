// An Inbox sidebar row as an address, so a tab can open on it (lane r32-nav, Open in New Tab).
import test from "node:test";
import assert from "node:assert/strict";
import { scopeArgs, scopeOfArgs } from "./model.ts";
import type { InboxAddress } from "./model.ts";

test("an inbox, a list and each main view round-trip through their address", () => {
  const rows: InboxAddress[] = [
    { scope: { kind: "all" }, view: "contact" },
    { scope: { kind: "all" }, view: "thread" },
    { scope: { kind: "mailbox", id: "mbx_1" }, view: "thread" },
    { scope: { kind: "number", id: "num_1" } },
    { scope: { kind: "starred" } },
    { scope: { kind: "follow" } },
    { main: "calendar" },
    { main: "meetings" },
    { main: "replies" },
  ];
  for (const r of rows) assert.deepEqual(scopeOfArgs(scopeArgs(r)), r);
});

test("an address the Inbox does not understand gives no first state", () => {
  assert.deepEqual(scopeOfArgs({ scope: "mailbox:", view: "x", main: "y" }), {});
});
