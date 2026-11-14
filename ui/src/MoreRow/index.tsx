// ui/MoreRow: the one row that opens a capped list in place and closes it again ("4 more", then "Show less"). It is not paging (a list with more than its first answer pages through useLoadList): the rest is already here, a cap
// only keeps it out of the way. It shows its count, and what the hidden rows carry (a dot, a count, a failure) through `marks`, so nothing is hidden silently. Keyboard: Enter and Right open it, Left closes it.
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** What a key does on a More row: Enter or Right opens a closed one, Left closes an open one; anything else is not its. */
export function moreKey(key: string, open: boolean): "open" | "close" | null {
  if (!open && (key === "Enter" || key === "ArrowRight")) return "open";
  if (open && key === "ArrowLeft") return "close";
  if (open && key === "Enter") return "close";
  return null;
}

export const moreLabel = (count: number, open: boolean): string => (open ? "Show less" : `${count} more`);

export interface MoreRowProps {
  /** How many rows are behind it. */
  count: number;
  /** The list is open: the row reads "Show less". */
  open: boolean;
  onToggle(): void;
  /** What the hidden rows carry, drawn at the right (a dot, a mention count, a red circle). Absent when open. */
  marks?: ReactNode;
  /** The name of what it holds, for a screen reader: "channels". */
  what?: string;
  /** The keyboard cursor is on it (drawn as a hover). */
  cursor?: boolean;
  testID?: string;
  /** Left padding in px, so the words line up with the titles of the rows above. */
  inset?: number;
  /** Web only: more attributes and handlers for the row's element (a list's menu and keys). */
  domProps?: Record<string, unknown>;
}

export function MoreRow({
  count,
  open,
  onToggle,
  marks,
  what,
  cursor = false,
  testID,
  inset = 38,
  domProps,
}: MoreRowProps): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? `Show fewer${what ? ` ${what}` : ""}` : `${count} more${what ? ` ${what}` : ""}`}
      accessibilityState={{ expanded: open }}
      testID={testID ?? (open ? "more-row-open" : "more-row")}
      onPress={onToggle}
      style={[s.row, { paddingLeft: inset }, cursor ? s.cursor : null] as never}
      {...({
        onKeyDown: (e: { key: string; preventDefault?: () => void }) => {
          const k = moreKey(e.key, open);
          if (k === null) return;
          e.preventDefault?.();
          onToggle();
        },
        ...(domProps ?? {}),
      } as Record<string, unknown>)}
    >
      <Text style={s.text as never}>{moreLabel(count, open)}</Text>
      {open || !marks ? null : <View style={s.marks as never}>{marks}</View>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { height: 28, flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8, borderRadius: 8 },
  cursor: { backgroundColor: "var(--hover)" as string },
  text: { fontSize: 12, color: "var(--ink-3)" as string },
  marks: { flexDirection: "row", alignItems: "center", gap: 4 },
});
