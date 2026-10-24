// Frozen props for ui/VirtualList (ARCH 7, F9, perf scroll).
// One list subscription. Rows read a window. Heights are fixed or measured.
// Every rendered row is a ui/Row, full width (ui rows).

export type RowHeight = number | "measure";

export interface VirtualWindow {
  start: number;
  end: number;
}

export interface VirtualListProps<T> {
  data: readonly T[];
  /** First JSX child of a real row is ui/Row. The placeholder does not call this. */
  renderItem: (item: T, index: number) => unknown;
  rowHeight: RowHeight;
  /** The list subscribes once. Rows read this window and do not subscribe. */
  window?: VirtualWindow;
  keyOf?: (item: T, index: number) => string;
  onEndReached?: () => void;
}

/** Text a placeholder can show for one row without calling renderItem. */
export function virtualItemLabel(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  for (const key of ["title", "label", "name"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}
