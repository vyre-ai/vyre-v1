// Where Notes sits in the app: its row under Tasks and Threads in the Chats sidebar, its route and tab, and a note found in the top search (vyre://note/<id>) opening in Notes.
import test from "node:test";
import assert from "node:assert/strict";
import { START, fromHash, openKeyOf, step } from "../mounts/route.ts";
import { buildEntries, openEntry } from "../sidebar/model.ts";
import type { SidebarInput } from "../sidebar/model.ts";
import { hashOfHit, placeOfHit } from "../../../shell/cmdk/gate.ts";
import { screenTitle, tabKey } from "../../../shell/tabs/store.ts";

const input: SidebarInput = { faces: [], workingAgents: new Set(), groups: [], channels: [], filter: "all", closed: new Set() };

test("the Notes row sits under Tasks and Threads where the shell has Notes, and is the open row on the Notes page", () => {
  assert.deepEqual(buildEntries({ ...input, notes: true }).filter((e) => e.type === "nav").map((e) => e.key), ["nav:tasks", "nav:threads", "nav:notes"]);
  assert.deepEqual(buildEntries(input).filter((e) => e.type === "nav").map((e) => e.key), ["nav:tasks", "nav:threads"], "no Notes page, no row");
  assert.equal(buildEntries({ ...input, notes: true, searching: true }).some((e) => e.key === "nav:notes"), false, "searching the sidebar hides the top rows");
  assert.equal(openEntry(buildEntries({ ...input, notes: true }), "notes"), "nav:notes");
});

test("Notes is a route of Chats with a tab of its own; a link with a note id opens that note; Take a note opens the bar again each time", () => {
  assert.deepEqual(fromHash("screen=chats.notes").route, { view: "notes" });
  assert.deepEqual(fromHash("screen=chats.notes&noteId=nte_1").route, { view: "notes", noteId: "nte_1" });
  assert.equal(openKeyOf(fromHash("screen=chats.notes").route), "notes");
  const once = step(START, { t: "notes", take: true });
  assert.deepEqual(once.route, { view: "notes", take: 1 });
  assert.deepEqual(step(once, { t: "notes", take: true }).route, { view: "notes", take: 2 });
  assert.equal(tabKey("chats", "screen=chats.notes"), "chats:chats.notes");
  assert.equal(tabKey("chats", "screen=chats.notes&noteId=nte_1"), "chats:chats.notes", "one Notes tab, whichever note is open");
  assert.equal(screenTitle("screen=chats.notes"), "Notes");
});

test("a note found in the top search opens in Notes", () => {
  const hit = { kind: "note" as const, id: "nte_1", title: "Weinberger intake call", link: "vyre://note/nte_1", score: 1 };
  assert.equal(placeOfHit(hit), "chats");
  assert.equal(hashOfHit(hit), "screen=chats.notes&noteId=nte_1");
  assert.deepEqual(fromHash(hashOfHit(hit)).route, { view: "notes", noteId: "nte_1" });
  assert.equal(hashOfHit({ ...hit, kind: "record", id: "rec_1" }), "subject=record:rec_1", "other results open as their subject");
});
