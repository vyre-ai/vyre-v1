// ui/VirtualList: 10,000 rows render a window, and scrolling to the end keeps the layout stable.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Row } from "../Row/index.tsx";
import { renderWindowFor, VirtualList, rowOffsets, scrollWindowFor, windowFor } from "./index.tsx";

const rows = Array.from({ length: 10000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` }));

test("10,000 rows render only a window of Row items", () => {
  const html = renderToStaticMarkup(
    <VirtualList data={rows} rowHeight={28} keyOf={(r) => r.id} renderItem={(r) => <Row id={r.id} title={r.title} />} />,
  );
  const rendered = html.match(/data-testid="row-r\d+"/g)?.length ?? 0;
  assert.ok(rendered > 0 && rendered < 60, `rendered ${rendered} rows`);
  assert.match(html, /data-testid="row-r0"/);
  assert.doesNotMatch(html, /data-testid="row-r9999"/);
  assert.match(html, /height:280000px/, "the full height is reserved up front");
});

test("an explicit window renders exactly that range", () => {
  const html = renderToStaticMarkup(
    <VirtualList data={rows} rowHeight={28} window={{ start: 100, end: 105 }} keyOf={(r) => r.id} renderItem={(r) => <Row id={r.id} title={r.title} />} />,
  );
  assert.equal(html.match(/data-testid="row-r\d+"/g)?.length, 5);
  assert.match(html, /data-testid="row-r100"/);
  assert.match(html, /data-testid="row-r104"/);
});

test("scrolling to the end keeps the total height and ends on the last row", () => {
  const offsets = rowOffsets(10000, 28);
  const total = offsets[10000];
  assert.equal(total, 280000);
  const atEnd = windowFor(offsets, total, 640);
  assert.equal(atEnd.end, 10000);
  assert.ok(atEnd.start > 9900);
  const middle = windowFor(offsets, 140000, 640);
  assert.ok(middle.start <= 5000 && middle.end >= 5000 + 22, "the middle window covers the viewport");
  assert.equal(offsets[10000], total, "offsets do not change while scrolling");
});

test("measured heights use the estimate until a row reports its own", () => {
  const measured = new Map([[0, 80]]);
  const offsets = rowOffsets(3, "measure", measured);
  assert.equal(offsets[1], 80);
  assert.equal(offsets[3], 80 + 44 + 44);
});

test("an empty list renders no rows and no crash", () => {
  const html = renderToStaticMarkup(<VirtualList data={[] as string[]} rowHeight={28} renderItem={(s) => <Row title={s} />} />);
  assert.doesNotMatch(html, /data-testid="row-/);
});

test("window lookup over 10,000 rows is cheap (p95 under 1 ms)", () => {
  const offsets = rowOffsets(10000, 28);
  const times: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const t = performance.now();
    windowFor(offsets, (i * 137) % 279000, 640);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length * 0.95)] < 1, `p95 ${times[Math.floor(times.length * 0.95)]} ms`);
});

test("a 10,000-row Files fling keeps one buffered window across most animation frames", () => {
  const offsets = rowOffsets(10000, 38);
  const viewport = 640;
  let current = windowFor(offsets, 0, viewport);
  let changes = 0;
  for (let frame = 1; frame <= 600; frame++) {
    const top = frame * 120;
    const next = scrollWindowFor(offsets, top, viewport, 38, current);
    if (next !== current) changes++;
    current = next;
    const visible = windowFor(offsets, top, viewport, 0);
    assert.ok(current.start <= visible.start && current.end >= visible.end, `frame ${frame} remains covered`);
  }
  assert.ok(changes < 180, `${changes} React window updates during 600 animation frames`);
});

test("a Files fling bounds the rows mounted by each scrolling window update", () => {
  const offsets = rowOffsets(10000, 38);
  const viewport = 640;
  let current = windowFor(offsets, 0, viewport);
  let changes = 0;
  let maxEntered = 0;
  for (let frame = 1; frame <= 600; frame++) {
    const top = frame * 120;
    const next = scrollWindowFor(offsets, top, viewport, 38, current);
    if (next !== current) {
      changes++;
      const overlap = Math.max(0, Math.min(current.end, next.end) - Math.max(current.start, next.start));
      maxEntered = Math.max(maxEntered, next.end - next.start - overlap);
    }
    current = next;
    const visible = windowFor(offsets, top, viewport, 0);
    assert.ok(current.start <= visible.start && current.end >= visible.end, `frame ${frame} remains covered`);
  }
  assert.ok(maxEntered <= 16, `mounted at most 16 new rows per update, saw ${maxEntered}`);
  assert.ok(changes < 180, `${changes} React window updates during 600 animation frames`);
});

test("measured rows invalidate a cached scroll window when reflow moves the viewport beyond it", () => {
  const estimated = rowOffsets(10000, "measure");
  const current = scrollWindowFor(estimated, 2000, 640, "measure");
  const measured = new Map<number, number>();
  for (let i = current.start; i < current.end; i++) measured.set(i, 28);
  const reflowed = rowOffsets(10000, "measure", measured);
  const visible = windowFor(reflowed, 2000, 640, 0);
  assert.ok(current.end < visible.end, "the cached estimated window no longer covers the reflowed viewport");
  const resolved = renderWindowFor(reflowed, 2000, 640, current);
  assert.notDeepEqual(resolved, current);
  assert.ok(resolved.start <= visible.start && resolved.end >= visible.end, "the render window covers the viewport immediately after reflow");
});

test("scroll windows cover the viewport in both directions", () => {
  const offsets = rowOffsets(10000, 38);
  let current = windowFor(offsets, 72000, 640);
  for (let frame = 599; frame >= 0; frame--) {
    const top = frame * 120;
    current = scrollWindowFor(offsets, top, 640, 38, current);
    const visible = windowFor(offsets, top, 640, 0);
    assert.ok(current.start <= visible.start && current.end >= visible.end, `reverse frame ${frame} remains covered`);
  }
});
