// Chapters in the column (G9, G10): a heading before each chapter, folded ones out of the list, the current one open; the rail, one dot per chapter; and a long chat folded in a few milliseconds.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../../ui/src/testing/dom.ts";
import { ChapterHead } from "./ChapterHead.tsx";
import { ChapterLayer } from "./ChapterLayer.tsx";
import { useCurrentChapter } from "./current-chapter.ts";
import { ChapterRail } from "./ChapterRail.tsx";
import { chapterAt, isOpen, ownSeq, railOf, withChapters } from "./model.ts";
import type { ChapterInfo, ChapterRow } from "./model.ts";

installDom();

const clock = { now: Date.UTC(2026, 10, 14, 12, 0), offsetMin: 0 };
type R = { kind: string; key: string; message?: { threadSeq: number } };
const msg = (seq: number): R => ({ kind: "other", key: `m${seq}`, message: { threadSeq: seq } });
const rows = (n: number): R[] => Array.from({ length: n }, (_, i) => msg(i + 1));
const chap = (o: Partial<ChapterInfo> & { startSeq: number; endSeq: number }): ChapterInfo => ({
  startAt: Date.UTC(2026, 10, 14, 11, 4),
  count: o.endSeq - o.startSeq + 1,
  current: false,
  title: "Documents",
  summary: "Three milestones, Mira leads",
  by: "model",
  ...o,
});
const three = [
  chap({ startSeq: 1, endSeq: 30, title: "Plan" }),
  chap({ startSeq: 31, endSeq: 60, title: "Documents" }),
  chap({ startSeq: 61, endSeq: 90, title: "Launch", current: true }),
];
const keys = (list: Array<R | ChapterRow>): string[] => list.map((r) => r.key);

test("no chapters returns the same list: a short chat pays nothing", () => {
  const r = rows(20);
  assert.equal(withChapters(r, ownSeq, [], new Set(), clock), r);
});

test("a heading comes before each chapter, folded chapters keep only the heading, the current one is open", () => {
  const out = withChapters(rows(90), ownSeq, three, new Set(), clock);
  const ks = keys(out);
  assert.deepEqual(
    ks.filter((k) => k.startsWith("chapter-")),
    ["chapter-1", "chapter-31", "chapter-61"],
  );
  assert.equal(ks.filter((k) => k.startsWith("m")).length, 30, "only the current chapter's messages");
  assert.equal(ks[0], "chapter-1");
  assert.equal(ks[1], "chapter-31");
  assert.equal(ks[3], "m61");
  const head = out[1] as ChapterRow;
  assert.equal(head.open, false);
  assert.equal(head.time, "11:04 AM");
  assert.equal(head.summary, "Three milestones, Mira leads");
});

test("pressing a folded chapter opens it, pressing the current one folds it; a message that must show opens its chapter", () => {
  const open = withChapters(rows(90), ownSeq, three, new Set([31]), clock);
  assert.equal(keys(open).filter((k) => k.startsWith("m")).length, 60);
  const closed = withChapters(rows(90), ownSeq, three, new Set([61]), clock);
  assert.equal(keys(closed).filter((k) => k.startsWith("m")).length, 0);
  const shown = withChapters(rows(90), ownSeq, three, new Set(), clock, 10);
  assert.equal(keys(shown).filter((k) => k.startsWith("m")).length, 60, "chapter 1 and the current one");
  assert.equal(isOpen(three[2]!, new Set()), true);
  assert.equal(chapterAt(three, 45)?.title, "Documents");
});

test("a day mark or an hour mark rides with the first message of its chapter, after the heading", () => {
  const r: R[] = [msg(1), msg(2), { kind: "day", key: "d1" }, { kind: "hour", key: "h1" }, msg(31), msg(32)];
  const out = withChapters(
    r,
    ownSeq,
    [chap({ startSeq: 1, endSeq: 30 }), chap({ startSeq: 31, endSeq: 60, current: true })],
    new Set(),
    clock,
  );
  assert.deepEqual(keys(out), ["chapter-1", "chapter-31", "d1", "h1", "m31", "m32"]);
});

test("5,000 rows fold in a few milliseconds", () => {
  const r = rows(5000);
  const big = Array.from({ length: 50 }, (_, i) =>
    chap({ startSeq: i * 100 + 1, endSeq: i * 100 + 100, current: i === 49 }),
  );
  withChapters(r, ownSeq, big, new Set(), clock);
  const t = performance.now();
  for (let i = 0; i < 5; i++) withChapters(r, ownSeq, big, new Set(), clock);
  const ms = (performance.now() - t) / 5;
  console.log(
    "METRIC " + JSON.stringify({ name: "chapters", metric: "fold_5000", ms: Math.round(ms * 10) / 10, budget_ms: 16 }),
  );
  assert.ok(ms < 16, `folding took ${ms} ms`);
});

const rowOf = (o: Partial<ChapterRow> = {}): ChapterRow => ({
  kind: "chapter",
  key: "chapter-31",
  startSeq: 31,
  title: "Documents",
  summary: "Three milestones, Mira leads",
  time: "11:04 AM",
  count: 30,
  open: false,
  current: false,
  ...o,
});

test("a folded heading shows title, line and time and opens with a press; an open one shows title and time", async () => {
  const log: number[] = [];
  const closed = await mount(createRoot, <ChapterHead row={rowOf()} onToggle={(s) => log.push(s)} />);
  const t = textOf(find(closed, "chapter-31"));
  assert.match(t, /Documents/);
  assert.match(t, /Three milestones, Mira leads/);
  assert.match(t, /11:04 AM/);
  await press(find(closed, "chapter-31"));
  assert.deepEqual(log, [31]);
  const open = await mount(createRoot, <ChapterHead row={rowOf({ open: true })} onToggle={() => undefined} />);
  assert.doesNotMatch(textOf(find(open, "chapter-31")), /Three milestones/);
});

test("the rail has one dot per chapter, names it on hover, and a press goes there; one chapter has no rail", async () => {
  const log: number[] = [];
  const narrow = await mount(createRoot, <ChapterRail width={390} dots={railOf(three)} onJump={() => undefined} />);
  assert.equal(find(narrow, "chapter-rail"), null, "a phone has no rail");
  const rail = await mount(createRoot, <ChapterRail width={1440} dots={railOf(three)} onJump={(s) => log.push(s)} />);
  assert.ok(find(rail, "chapter-rail"));
  for (const c of three) assert.ok(find(rail, `chapter-dot-${c.startSeq}`));
  await press(find(rail, "chapter-dot-31"));
  assert.deepEqual(log, [31]);
  const one = await mount(
    createRoot,
    <ChapterRail width={1440} dots={railOf(three.slice(0, 1))} onJump={() => undefined} />,
  );
  assert.equal(find(one, "chapter-rail"), null);
});

test("the layer asks the server only for a long chat, lays the rows out in chapters, and a press on a heading opens it", async () => {
  const calls: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    calls.push(cap);
    return { chapters: three, wanted: 0 };
  };
  let seen: Array<{ kind: string; key: string }> = [];
  let flip: (s: number) => void = () => undefined;
  const el = (size: number) => (
    <ChapterLayer
      call={call}
      threadId="thr_1"
      size={size}
      newest={90}
      focusSeq={null}
      rows={rows(90)}
      own={ownSeq}
      clock={clock}
    >
      {(laid) => {
        seen = laid.rows;
        flip = laid.flip;
        return null;
      }}
    </ChapterLayer>
  );
  await mount(createRoot, el(10));
  await flush();
  assert.deepEqual(calls, [], "a short chat never asks");
  assert.equal(seen.length, 90);
  await mount(createRoot, el(90));
  await flush();
  assert.deepEqual(calls, ["chat.chapters"]);
  assert.deepEqual(
    seen.filter((r) => r.kind === "chapter").map((r) => r.key),
    ["chapter-1", "chapter-31", "chapter-61"],
  );
  assert.equal(seen.filter((r) => r.kind === "other").length, 30);
  await act(async () => flip(31));
  assert.equal(seen.filter((r) => r.kind === "other").length, 60);
});

test("the layer publishes the current chapter's title for the head's subtitle", async () => {
  const call = async (): Promise<unknown> => ({ chapters: three, wanted: 0 });
  let seen = "";
  const Probe = (): null => {
    seen = useCurrentChapter("thr_sub");
    return null;
  };
  await mount(
    createRoot,
    <>
      <Probe />
      <ChapterLayer
        call={call}
        threadId="thr_sub"
        size={90}
        newest={90}
        focusSeq={null}
        rows={rows(90)}
        own={ownSeq}
        clock={clock}
      >
        {() => null}
      </ChapterLayer>
    </>,
  );
  await flush();
  assert.equal(seen, "Launch");
});
