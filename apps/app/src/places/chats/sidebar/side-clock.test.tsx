// A goal's check-in line in the sidebar reads the chat's one clock format (the message rows' timeLabel), not the device's own: "Next check-in Wed 9:00 AM" (was "Wed 9:00" style through toLocaleTimeString).
import test from "node:test";
import assert from "node:assert/strict";
import { timeLabel } from "../conversation/model.ts";
import { itemsOf } from "./side-data.ts";
import type { SideOut, SideRow } from "./side-data.ts";
import { sayWhen } from "./side-clock.ts";

const at = Date.UTC(2026, 10, 18, 21, 5); // a Wednesday
const goal = (key: string, extra: Partial<SideRow>): SideRow =>
  ({
    key,
    kind: "goal",
    title: key,
    faceIds: [],
    unread: 0,
    mentions: 0,
    failed: false,
    working: false,
    muted: false,
    pinned: null,
    lastAt: 1,
    ...extra,
  }) as SideRow;
const none = { total: 0, rows: [] as SideRow[] };
const out = (rows: SideRow[]): SideOut =>
  ({
    needs: { total: 0, items: [] },
    goals: { total: rows.length, rows },
    pinned: none,
    chats: none,
    channels: none,
    team: none,
  }) as unknown as SideOut;

test("the check-in time is said exactly as a message row says it, on the chat's clock", () => {
  const c = { now: Date.UTC(2026, 10, 15, 12, 0), offsetMin: 0 };
  const { items } = itemsOf(out([goal("g:b", { nextCheckinAt: at })]), "assistant", undefined, undefined, sayWhen(c));
  assert.equal(items[0]!.sub, `Next check-in Wed ${timeLabel(at, c)}`);
  assert.equal(items[0]!.sub, "Next check-in Wed 9:05 PM");
});

test("the Space's offset moves the weekday and the time together", () => {
  const c = { now: Date.UTC(2026, 10, 15, 12, 0), offsetMin: 180 }; // 21:05 UTC is 00:05 on Thursday there
  const { items } = itemsOf(out([goal("g:b", { nextCheckinAt: at })]), "assistant", undefined, undefined, sayWhen(c));
  assert.equal(items[0]!.sub, "Next check-in Thu 12:05 AM");
});
