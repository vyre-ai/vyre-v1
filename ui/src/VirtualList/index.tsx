// ui/VirtualList: one list subscription, rows read a window (ARCH 7, F9). Native uses FlashList; web uses a windowed
// scroller with fixed or measured row heights and a reserved total height, so scrolling to the end never shifts layout.
// Rows do not subscribe to anything: they render from the item the window hands them.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { NativeList } from "./NativeList";
import type { VirtualListProps, VirtualWindow } from "./props.ts";

export type { VirtualListProps, VirtualWindow, RowHeight } from "./props.ts";

const OVERSCAN = 4;
// Keep scrolling swaps small enough to commit inside one frame. A larger buffer updates less often, but each boundary then mounts dozens of
// Files rows at once; 456 px is 12 list rows (or four grid rows) and keeps the work of one swap bounded.
const SCROLL_BUFFER_PX = 456;
const ESTIMATE = 44;
const DEFAULT_VIEWPORT = 640;

/** Row offsets: offsets[i] is the top of row i, offsets[n] is the total height. */
export function rowOffsets(count: number, rowHeight: number | "measure", measured: ReadonlyMap<number, number> = new Map()): Float64Array {
  const out = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const h = typeof rowHeight === "number" ? rowHeight : measured.get(i) ?? ESTIMATE;
    out[i + 1] = out[i] + h;
  }
  return out;
}

/** The rows to render for a scroll position: binary search on offsets, plus overscan. */
export function windowFor(offsets: Float64Array, scrollTop: number, viewport: number, overscan = OVERSCAN, current?: VirtualWindow): VirtualWindow {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const find = (y: number): number => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const top = Math.max(0, Math.min(scrollTop, offsets[count]));
  const first = find(top);
  const last = find(Math.max(0, Math.min(top + viewport, offsets[count]) - 1));
  if (current && current.start <= first && current.end >= last + 1) return current;
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) };
}

/** The web scrolling policy: enough hysteresis to avoid updating every frame, without mounting a large batch at a boundary. */
export function scrollWindowFor(
  offsets: Float64Array,
  scrollTop: number,
  viewport: number,
  rowHeight: number | "measure",
  current?: VirtualWindow,
): VirtualWindow {
  const height = typeof rowHeight === "number" ? rowHeight : ESTIMATE;
  return windowFor(offsets, scrollTop, viewport, Math.max(OVERSCAN, Math.ceil(SCROLL_BUFFER_PX / height)), current);
}

/** Reuse a cached scrolling window only while it still covers the viewport under the current offsets. */
export function renderWindowFor(
  offsets: Float64Array,
  scrollTop: number,
  viewport: number,
  current?: VirtualWindow,
): VirtualWindow {
  const visible = windowFor(offsets, scrollTop, viewport, 0);
  if (current && current.end <= offsets.length - 1 && current.start <= visible.start && current.end >= visible.end) return current;
  return windowFor(offsets, scrollTop, viewport);
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  if (Platform.OS === "web") return <WindowedList {...props} />;
  return <NativeList {...props} />;
}

function WindowedList<T>({ data, renderItem, rowHeight, window: controlled, keyOf, onEndReached }: VirtualListProps<T>) {
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [scrolled, setScrolled] = useState<VirtualWindow | null>(null);
  const scrollTop = useRef(0);
  const [version, setVersion] = useState(0);
  const measured = useRef(new Map<number, number>());
  const ended = useRef(false);
  const offsets = useMemo(
    () => rowOffsets(data.length, rowHeight, measured.current),
    // version bumps when a measured height changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.length, rowHeight, version],
  );
  // Keep the first paint lean. The slightly wider scrolling window is created only after the initial viewport is crossed.
  const computed = useMemo(() => windowFor(offsets, scrollTop.current, viewport), [offsets, viewport]);
  // Measured rows can move the viewport beyond a cached window without another scroll event. Revalidate it on every offsets version.
  const win = controlled ?? renderWindowFor(offsets, scrollTop.current, viewport, scrolled ?? undefined);
  const total = offsets[data.length];

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollTop.current = y;
    // Re-render only when the set of rows changes, not on every scroll event.
    const height = e.nativeEvent.layoutMeasurement.height || viewport;
    setScrolled((cur) => {
      const prior = cur ?? computed;
      const next = scrollWindowFor(offsets, y, height, rowHeight, prior);
      return next === prior ? cur : next;
    });
    const nearEnd = y + e.nativeEvent.layoutMeasurement.height >= total - 1;
    if (nearEnd && !ended.current) { ended.current = true; onEndReached?.(); }
    if (!nearEnd) ended.current = false;
  }, [onEndReached, total, offsets, viewport, computed, rowHeight]);

  const onMeasure = useCallback((i: number, h: number) => {
    if (h > 0 && measured.current.get(i) !== h) { measured.current.set(i, h); setVersion((v) => v + 1); }
  }, []);

  const items: ReactNode[] = [];
  for (let i = win.start; i < win.end && i < data.length; i++) {
    const item = data[i];
    const key = keyOf ? keyOf(item, i) : String(i);
    const top = offsets[i];
    const height = rowHeight === "measure" ? 0 : offsets[i + 1] - top;
    items.push(<Cell key={key} item={item} index={i} top={top} height={height} render={renderItem} onMeasure={rowHeight === "measure" ? onMeasure : undefined} />);
  }

  return (
    <ScrollView
      testID="virtual-list"
      style={{ flex: 1 }}
      scrollEventThrottle={16}
      onScroll={onScroll}
      onLayout={(e) => setViewport(e.nativeEvent.layout.height || DEFAULT_VIEWPORT)}
    >
      <View testID="virtual-list-body" accessibilityLabel={`${data.length} rows`} style={{ height: total, width: "100%" }}>{items}</View>
    </ScrollView>
  );
}

interface CellProps<T> {
  item: T;
  index: number;
  top: number;
  height: number;
  render: (item: T, index: number) => unknown;
  onMeasure?: (index: number, height: number) => void;
}

/** One positioned row. Memoised, so a scroll that keeps a row in the window does not re-render it. */
const Cell = memo(function Cell<T>({ item, index, top, height, render, onMeasure }: CellProps<T>) {
  return (
    <View
      onLayout={onMeasure ? (e: LayoutChangeEvent) => onMeasure(index, Math.round(e.nativeEvent.layout.height)) : undefined}
      style={{ position: "absolute", top, left: 0, right: 0, height: height || undefined }}
    >
      {render(item, index) as ReactNode}
    </View>
  );
}) as unknown as <T>(props: CellProps<T>) => ReactNode;
