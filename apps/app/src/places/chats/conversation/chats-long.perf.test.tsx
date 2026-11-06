// A chat with 2,000 messages stays light (lane l-chatfmt). The list draws a row again only when something it shows changed, so a key typed in the composer does not redraw every row; the work that scales with
// the chat (the timeline, the markdown of every body, the "did this row change" check) has a time budget; and the buttons of a skipped row still call the newest version.
import test from "node:test";
import assert from "node:assert/strict";
import { timeline, bodyBlocks } from "./model.ts";
import type { Message } from "./model.ts";
import { createSample } from "./sample.ts";
import { sameData, sameRow } from "./MessageView.tsx";
import type { MessageViewProps } from "./MessageView.tsx";
import { newDelegates, stableActions } from "./stable-actions.ts";

const N = 2000;
const s = createSample("long");
const base = (s.data.screens.query("chats.conversation", "messages", { threadId: "c1" }).getSnapshot() as { data: { messages: Message[] } }).data.messages;
const many: Message[] = Array.from({ length: N }, (_, i) => { const b = base[i % base.length]!; return { ...b, messageId: `x${i}`, threadSeq: i + 1, createdAt: b.createdAt + Math.floor(i / base.length) * 3_600_000, body: i % 9 === 0 ? `${b.body}\n\n> [!section] Detail ${i}\n> ==shown== when asked, with ++underline++.\n\n- [ ] one\n- [x] two` : b.body }; });
const ctx = { meId: "usr_irfad", nameOf: s.data.nameOf, kindOf: s.data.kindOf, clock: s.data.clock() };
const ms = (f: () => void): number => { const t = performance.now(); f(); return performance.now() - t; };
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const mkActions = (log: string[]) => ({ copy: (t: string) => log.push(`copy:${t}`), openAgent: () => undefined, remove: () => undefined, host: { open: () => undefined }, nameOf: (id: string) => id, humanChat: false, agentMute: { me: "u", mute: (p: string) => log.push(`mute:${p}`) } }) as unknown as MessageViewProps["actions"];

test("2,000 messages: the timeline and every body's markdown are ready inside the budget", () => {
  timeline(many, ctx);
  const tl = median([ms(() => timeline(many, ctx)), ms(() => timeline(many, ctx)), ms(() => timeline(many, ctx))]);
  const md = ms(() => { for (const m of many) bodyBlocks(m.messageId, m.body); });
  const again = ms(() => { for (const m of many) bodyBlocks(m.messageId, m.body); });
  console.log("METRIC " + JSON.stringify({ name: "chat_long", metric: "timeline_2000", ms: Math.round(tl), budget_ms: 400, markdown_first_ms: Math.round(md), markdown_cached_ms: Math.round(again) }));
  assert.ok(tl < 400, `timeline took ${tl} ms`);
  assert.ok(md < 1500, `markdown took ${md} ms`);
  assert.ok(again < 100, `cached markdown took ${again} ms`);
});

test("a render that changes nothing a row shows leaves all 2,000 rows alone, and checking them is cheap", () => {
  const d = newDelegates();
  const a1 = stableActions(d, mkActions([]));
  const a2 = stableActions(d, mkActions([]));
  const first = timeline(many, ctx).filter((it) => it.kind !== "day");
  const second = timeline(many, ctx).filter((it) => it.kind !== "day");
  assert.ok(first[0] !== second[0], "the list builds its items again every render");
  const row = (it: (typeof first)[number], actions: MessageViewProps["actions"]): MessageViewProps => ({ item: it, actions, meId: "usr_irfad" });
  let same = 0;
  const t = ms(() => { for (let i = 0; i < first.length; i++) if (sameRow(row(first[i]!, a1), row(second[i]!, a2))) same++; });
  console.log("METRIC " + JSON.stringify({ name: "chat_long", metric: "same_row_check", rows: first.length, same, ms: Math.round(t), budget_ms: 150 }));
  assert.equal(same, first.length, "every row is skipped");
  assert.ok(t < 150, `checking ${first.length} rows took ${t} ms`);
});

test("a row whose message changed, or whose data changed, is drawn again; the rest are not", () => {
  const d = newDelegates();
  const a = stableActions(d, mkActions([]));
  const before = timeline(many, ctx).filter((it) => it.kind === "other");
  const edited = many.map((m, i) => (i === 5 ? { ...m, body: m.body + " (edited)" } : m));
  const after = timeline(edited, ctx).filter((it) => it.kind === "other");
  const changed = before.filter((it, i) => !sameRow({ item: it, actions: a, meId: "u" }, { item: after[i]!, actions: a, meId: "u" })).length;
  assert.equal(changed, 1, "only the edited message");
  const a2 = stableActions(d, { ...(mkActions([]) as object), humanChat: true } as MessageViewProps["actions"]);
  assert.equal(sameRow({ item: before[0]!, actions: a, meId: "u" }, { item: before[0]!, actions: a2, meId: "u" }), false, "data in the actions changed");
  assert.equal(sameRow({ item: before[0]!, actions: a, meId: "u", mark: "match" }, { item: before[0]!, actions: a, meId: "u" }), false, "a find mark");
});

test("a skipped row's buttons call the newest version, also one level down", () => {
  const log: string[] = [];
  const d = newDelegates();
  const old = stableActions(d, mkActions(["old" as never]) as never) as unknown as { copy(t: string): void; agentMute: { mute(p: string): void } };
  stableActions(d, mkActions(log));
  old.copy("hello");
  old.agentMute.mute("p1");
  assert.deepEqual(log, ["copy:hello", "mute:p1"]);
});

test("sameData: functions are equal, data by value to a depth, anything odd is different", () => {
  assert.ok(sameData({ a: [1, { b: "x" }], f: () => 1 }, { a: [1, { b: "x" }], f: () => 2 }, 4));
  assert.ok(!sameData({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] }, 4));
  assert.ok(!sameData({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }, 2), "past the depth is different");
  assert.ok(!sameData(new Set([1]), new Set([1]), 4), "a Set is different unless it is the same one");
  const set = new Set([1]);
  assert.ok(sameData({ s: set }, { s: set }, 4));
});
