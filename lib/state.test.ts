// The pure rules of per-person state (lib/state.ts): arrival, read, set, merge, the badge arithmetic. No database, no clock.
import test from "node:test";
import assert from "node:assert/strict";
import {
  arrive,
  blank,
  changedFlags,
  counted,
  delta,
  joinScope,
  merge,
  MUTE_FOREVER,
  read,
  recount,
  reopens,
  set,
  splitScope,
  unreadOf,
  weigh,
} from "./state.ts";
import type { Entry, PersonState } from "./state.ts";

const NOW = 1_760_000_000_000;
const own = (by: string | null, pos: number): Entry => ({ pos, by });

test("no row means read, open, not starred, not followed, not muted", () => {
  const s = blank(7);
  assert.deepEqual(s, { readUpto: 7, unread: 0, doneAt: null, starredAt: null, follow: null, alert: false, mutedUntil: null, hidden: false });
  assert.equal(counted(s, NOW), false);
});

test("someone else's entry is one more unread; a row made now starts at the old head", () => {
  const a = arrive(null, { headBefore: 4, pos: 5, person: "usr_maya", by: null, mentioned: false, reopen: "new_entry" });
  assert.equal(a.readUpto, 4, "what came before you could see it counts as read");
  assert.equal(a.unread, 1);
  assert.equal(arrive(a, { headBefore: 5, pos: 6, person: "usr_maya", by: null, mentioned: false, reopen: "new_entry" }).unread, 2);
});

test("the author's own entry moves their cursor, clears their unread and never reopens their Done", () => {
  const done: PersonState = { ...blank(3), unread: 2, doneAt: NOW };
  const mine = arrive(done, { headBefore: 5, pos: 6, person: "usr_maya", by: "usr_maya", mentioned: false, reopen: "new_entry" });
  assert.equal(mine.readUpto, 6);
  assert.equal(mine.unread, 0);
  assert.equal(mine.doneAt, NOW);
});

test("what brings a done thing back is the kind's rule: any new entry, only a mention, or nothing", () => {
  const done: PersonState = { ...blank(0), doneAt: NOW };
  const a = (reopen: "new_entry" | "mention" | "never", mentioned: boolean) =>
    arrive(done, { headBefore: 0, pos: 1, person: "usr_maya", by: null, mentioned, reopen }).doneAt;
  assert.equal(a("new_entry", false), null);
  assert.equal(a("mention", false), NOW);
  assert.equal(a("mention", true), null);
  assert.equal(a("never", true), NOW);
  assert.equal(reopens("never", true), false);
});

test("read moves forward only; unread and fromPos move back", () => {
  const entries = [own(null, 1), own("usr_jonas", 2), own(null, 3), own(null, 4)];
  const row: PersonState = { ...blank(4), readUpto: 4 };
  assert.equal(read({ ...row, readUpto: 2, unread: 2 }, 4, entries, "usr_maya", { upto: 1 })!.readUpto, 2, "upto never moves back");
  assert.equal(read(blank(0), 4, entries, "usr_maya", { upto: 99 })!.readUpto, 4, "upto is held at the head");
  const back = read(row, 4, entries, "usr_maya", { fromPos: 3 })!;
  assert.equal(back.readUpto, 2);
  assert.equal(back.unread, 2);
  const un = read(row, 4, entries, "usr_maya", { unread: true })!;
  assert.equal(un.readUpto, 3);
  assert.equal(un.unread, 1);
  assert.equal(read(row, 1, [own("usr_maya", 1)], "usr_maya", { unread: true }), null, "nothing from anyone else to mark unread");
});

test("unread skips the person's own entries", () => {
  assert.equal(unreadOf([own("usr_maya", 1), own(null, 2), own("usr_jonas", 3)], 0, "usr_maya"), 2);
});

test("set: done, star, follow, alert and mute are separate; a field left out is left alone", () => {
  const s = set(null, 3, { done: true, star: true }, NOW);
  assert.equal(s.doneAt, NOW);
  assert.equal(s.starredAt, NOW);
  assert.equal(s.readUpto, 3);
  assert.equal(set(s, 3, { done: true }, NOW + 5).doneAt, NOW, "done twice keeps the first time");
  assert.equal(set(s, 3, { done: false }, NOW).doneAt, null);
  assert.equal(set(s, 3, { done: false }, NOW).starredAt, NOW);
  assert.equal(set(s, 3, { follow: "following", alert: true }, NOW).follow, "following");
  assert.equal(set(s, 3, { mute: { until: MUTE_FOREVER } }, NOW).mutedUntil, MUTE_FOREVER);
  assert.equal(set(set(s, 3, { mute: { until: NOW + 1 } }, NOW), 3, { mute: null }, NOW).mutedUntil, null);
});

test("a badge counts a thing with something unread that is not done, not muted and not lost", () => {
  const unread: PersonState = { ...blank(0), unread: 3 };
  assert.deepEqual(weigh(unread, NOW), { things: 1, entries: 3 });
  assert.deepEqual(weigh({ ...unread, doneAt: NOW }, NOW), { things: 0, entries: 0 });
  assert.deepEqual(weigh({ ...unread, mutedUntil: NOW + 1 }, NOW), { things: 0, entries: 0 });
  assert.deepEqual(weigh({ ...unread, mutedUntil: NOW }, NOW), { things: 1, entries: 3 }, "a mute that has ended counts again");
  assert.deepEqual(weigh({ ...unread, hidden: true }, NOW), { things: 0, entries: 0 });
  assert.deepEqual(weigh(null, NOW), { things: 0, entries: 0 });
});

test("delta is what a change does to the badge", () => {
  const before: PersonState = { ...blank(0), unread: 2 };
  assert.deepEqual(delta(null, before, NOW), { things: 1, entries: 2 });
  assert.deepEqual(delta(before, { ...before, unread: 5 }, NOW), { things: 0, entries: 3 });
  assert.deepEqual(delta(before, { ...before, doneAt: NOW }, NOW), { things: -1, entries: -2 });
  assert.deepEqual(delta(before, null, NOW), { things: -1, entries: -2 });
});

test("changedFlags names what moved", () => {
  const before = blank(2);
  assert.deepEqual(changedFlags(before, { ...before, unread: 1 }, 2), ["read"]);
  assert.deepEqual(changedFlags(before, set(before, 2, { done: true, star: true, mute: { until: NOW } }, NOW), 2), ["done", "star", "mute"]);
  assert.deepEqual(changedFlags(null, blank(2), 2), []);
});

test("merge keeps flags; a Done survives only when both were done; the cursor is the higher one only where both were fully read", () => {
  const a: PersonState = { ...blank(5), doneAt: NOW, starredAt: NOW + 10, follow: "left" };
  const b: PersonState = { ...blank(9), doneAt: NOW + 5, follow: "following", alert: true };
  const m = merge(a, b);
  assert.equal(m.doneAt, NOW + 5);
  assert.equal(m.readUpto, 9);
  assert.equal(m.starredAt, NOW + 10);
  assert.equal(m.follow, "following");
  assert.equal(m.alert, true);
  const m2 = merge({ ...a, unread: 1 }, b);
  assert.equal(m2.readUpto, 5);
  assert.equal(merge({ ...a, doneAt: null }, b).doneAt, null, "open on one side: open");
});

test("recount keeps the cursor and follows the entries", () => {
  const row: PersonState = { ...blank(2), readUpto: 2, unread: 9 };
  assert.equal(recount(row, [own(null, 1), own(null, 2), own(null, 3)], "usr_maya").unread, 1);
});

test("a scope is one string", () => {
  assert.deepEqual(splitScope("mailbox:mbx_a"), { type: "mailbox", id: "mbx_a" });
  assert.deepEqual(splitScope("chats"), { type: "chats", id: "" });
  assert.deepEqual(splitScope("notices:inbox:x"), { type: "notices", id: "inbox:x" });
  assert.equal(joinScope("chats", ""), "chats");
  assert.equal(joinScope("mailbox", "mbx_a"), "mailbox:mbx_a");
});
