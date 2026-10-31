// Inbox channels: when something can send, and the tiles of the connect choice. Pure, so it runs with plain `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { CONNECT_TILES, canSend } from "./model.ts";
import type { Counts, Mailbox } from "./model.ts";

const box = (o: Partial<Mailbox>): Mailbox => ({ id: "mbx_1", kind: "personal", address: "a@example.test", title: "A", provider: "google", privacy: "space", state: "syncing", ...o }) as Mailbox;
const counts = (byInbox: Array<{ id: string; kind: "mailbox" | "number"; unread: number }>): Counts => ({ total: 0, byInbox }) as unknown as Counts;

test("nothing connected can send nothing", () => {
  assert.equal(canSend([], null), false);
  assert.equal(canSend([], counts([])), false);
});

test("a live mailbox can send, in any state but disconnected", () => {
  for (const state of ["pending", "syncing", "paused", "error"] as const) assert.equal(canSend([box({ state })], null), true, state);
  assert.equal(canSend([box({ state: "disconnected" })], null), false);
});

test("a receive-only mailbox cannot send", () => {
  assert.equal(canSend([box({ provider: "inbound_only" })], counts([])), false);
});

test("a claimed number can send", () => {
  assert.equal(canSend([], counts([{ id: "+14155550132", kind: "number", unread: 0 }])), true);
});

test("the tiles are Gmail, Outlook, other email and Twilio, each with its own flow and no em dash", () => {
  assert.deepEqual(CONNECT_TILES.map((t) => t.kind), ["gmail", "outlook", "imap", "twilio"]);
  assert.deepEqual(CONNECT_TILES.map((t) => t.label), ["Gmail", "Outlook", "Other email", "Twilio"]);
  for (const t of CONNECT_TILES) assert.ok(!(t.label + t.hint).includes(String.fromCharCode(0x2014)));
});
