// The one read as drawn rows: shapes, names from the answer's own Team rows, pins in the caller's order, the open row, and no raw id anywhere a person reads.
import test from "node:test";
import assert from "node:assert/strict";
import { itemsOf, openKeyFor, pinsOf } from "./side-data.ts";
import type { SideOut, SideRow } from "./side-data.ts";
import { buildLayout } from "./layout.ts";

const row = (o: Partial<SideRow> & { key: string; kind: SideRow["kind"]; title: string }): SideRow => ({
  faceIds: [],
  unread: 0,
  mentions: 0,
  failed: false,
  working: false,
  muted: false,
  pinned: null,
  lastAt: 1,
  ...o,
});
const sec = (rows: SideRow[]) => ({ total: rows.length, rows });
const out = (o: Partial<SideOut> = {}): SideOut => ({
  needs: { total: 1, items: [{ taskId: "tsk_1", title: "Send 12 invoices", verb: "Allow", askerId: "agt_docs" }] },
  goals: sec([
    row({
      key: "g:gol_1",
      kind: "goal",
      title: "Close onboarding",
      faceIds: ["agt_docs"],
      progress: { done: 3, total: 7 },
    }),
  ]),
  pinned: sec([
    row({ key: "c:thr_p", kind: "chat", title: "Pricing", faceIds: ["agt_docs"], pinned: 0, threadId: "thr_p" }),
  ]),
  chats: sec([
    row({
      key: "c:thr_a",
      kind: "chat",
      title: "Launch crew",
      faceIds: ["agt_docs", "agt_mira"],
      threadId: "thr_a",
      mentions: 2,
    }),
    row({ key: "c:thr_s", kind: "chat", title: "Ask", faceIds: ["assistant"], threadId: "thr_s" }),
  ]),
  channels: sec([row({ key: "ch:chn_1", kind: "channel", title: "launch", private: true, threadId: "thr_c" })]),
  team: sec([
    row({ key: "p:usr_s", kind: "person", title: "Sara Malik", personId: "usr_s", faceIds: ["usr_s"] }),
    row({ key: "f:agt_docs", kind: "agent", title: "Docs", agentId: "agt_docs", faceIds: ["agt_docs"] }),
    row({ key: "f:assistant", kind: "agent", title: "Assistant", agentId: "assistant", faceIds: ["assistant"] }),
  ]),
  rail: 3,
  ...o,
});

test("rows become items with the right shape; the Assistant is one shape everywhere; faces are named from the answer", () => {
  const { items } = itemsOf(out(), "assistant");
  const by = (k: string) => items.find((x) => x.key === k)!;
  assert.equal(by("c:thr_a").shape, "group");
  assert.equal(by("c:thr_s").shape, "assistant");
  assert.equal(by("f:assistant").shape, "assistant");
  assert.equal(by("p:usr_s").shape, "person");
  assert.equal(by("ch:chn_1").private, true);
  assert.equal(by("g:gol_1").faces[0]!.name, "Docs", "the lead's name comes from Team, not an id");
  assert.equal(by("n:tsk_1").sub, "Docs");
  assert.deepEqual(by("n:tsk_1").verb, { label: "Allow", tone: "accent" });
  for (const it of items)
    for (const f of it.faces) assert.ok(!/^(agt|usr)_/.test(f.name), `no raw id as a name (${f.name})`);
});

test("presence and working join from chats.presence", () => {
  const { items } = itemsOf(out(), "assistant", {
    people: new Map([["usr_s", "online"]]),
    working: new Set(["agt_docs"]),
  });
  assert.equal(items.find((x) => x.key === "p:usr_s")!.presence, "online");
  assert.equal(items.find((x) => x.key === "f:agt_docs")!.working, true);
});

test("the caller's pins come in their order, and the open row is found for each kind of route", () => {
  assert.deepEqual(pinsOf(out()), ["c:thr_p"]);
  const { refs } = itemsOf(out(), "assistant");
  assert.equal(openKeyFor("t:thr_a", refs), "c:thr_a");
  assert.equal(openKeyFor("t:thr_c", refs), "ch:chn_1");
  assert.equal(openKeyFor("g:gol_1", refs), "g:gol_1");
  assert.equal(openKeyFor("a:agt_docs", refs), "f:agt_docs");
  assert.equal(openKeyFor("tasks", refs), "tasks");
  assert.equal(openKeyFor("t:nope", refs), null);
});

test("the answer draws as the design says: Tasks, Goals, Pinned, Chats, Channels, Team, each once", () => {
  const { items } = itemsOf(out(), "assistant");
  const l = buildLayout({ items, pins: pinsOf(out()), filter: "all", folded: new Set(), more: new Set(), open: null });
  const heads = l.entries.flatMap((e) => (e.type === "head" ? [e.label] : []));
  assert.deepEqual(heads, ["Goals", "Pinned", "Chats", "Channels", "Team"]);
  const keys = l.entries.flatMap((e) => (e.type === "row" ? [e.key] : []));
  assert.equal(new Set(keys).size, keys.length);
});
