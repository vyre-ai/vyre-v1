// ui/VirtualList: one list subscription, rows read a window (ARCH 7, F9). Native uses FlashList; web uses a windowed
// scroller with fixed or measured row heights and a reserved total height, so scrolling to the end never shifts layout.
// Rows do not subscribe to anything: they render from the item the window hands them.

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { VirtualListProps, VirtualWindow } from "./props.ts";

export type { VirtualListProps, VirtualWindow, RowHeight } from "./props.ts";

const OVERSCAN = 6;
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
export function windowFor(offsets: Float64Array, scrollTop: number, viewport: number, overscan = OVERSCAN): VirtualWindow {
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
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) };
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  if (Platform.OS === "web") return <WindowedList {...props} />;
  return <NativeList {...props} />;
}

function WindowedList<T>({ data, renderItem, rowHeight, window: controlled, keyOf, onEndReached }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [version, setVersion] = useState(0);
  const measured = useRef(new Map<number, number>());
  const ended = useRef(false);
  const offsets = useMemo(
    () => rowOffsets(data.length, rowHeight, measured.current),
    // version bumps when a measured height changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.length, rowHeight, version],
  );
  const win = controlled ?? windowFor(offsets, scrollTop, viewport);
  const total = offsets[data.length];

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setScrollTop(y);
    const nearEnd = y + e.nativeEvent.layoutMeasurement.height >= total - 1;
    if (nearEnd && !ended.current) { ended.current = true; onEndReached?.(); }
    if (!nearEnd) ended.current = false;
  }, [onEndReached, total]);

  const items: ReactNode[] = [];
  for (let i = win.start; i < win.end && i < data.length; i++) {
    const item = data[i];
    const key = keyOf ? keyOf(item, i) : String(i);
    const top = offsets[i];
    const height = offsets[i + 1] - top;
    const measure = rowHeight === "measure"
      ? (e: LayoutChangeEvent) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0 && measured.current.get(i) !== h) { measured.current.set(i, h); setVersion((v) => v + 1); }
        }
      : undefined;
    items.push(
      <View key={key} onLayout={measure} style={{ position: "absolute", top, left: 0, right: 0, height: rowHeight === "measure" ? undefined : height }}>
        {renderItem(item, i) as ReactNode}
      </View>,
    );
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

function NativeList<T>({ data, renderItem, rowHeight, keyOf, onEndReached }: VirtualListProps<T>) {
  // Loaded only on native: the flash-list module needs the native view manager.
  const { FlashList } = require("@shopify/flash-list") as typeof import("@shopify/flash-list");
  return (
    <FlashList
      data={data as T[]}
      renderItem={({ item, index }: { item: T; index: number }) => renderItem(item, index) as ReactNode}
      keyExtractor={(item: T, index: number) => (keyOf ? keyOf(item, index) : String(index))}
      overrideItemLayout={typeof rowHeight === "number" ? (layout: { size?: number }) => { layout.size = rowHeight; } : undefined}
      onEndReached={onEndReached}
    />
  );
}
