import type { ReactNode } from "react";
import { FlashList } from "@shopify/flash-list";
import type { VirtualListProps } from "./props.ts";

export function NativeList<T>({ data, renderItem, rowHeight, keyOf, onEndReached }: VirtualListProps<T>) {
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
