// The board's small chrome: the bar that appears when cards are selected (Move to, Assign), the toast that says what moved and offers Undo, and the keyboard hints behind the ? button.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph, pointOf } from "../sidebar/parts.tsx";
import { each } from "../views-a/model.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { Board } from "./ctx.ts";
import { selectedRows } from "./KCard.tsx";

export interface ToastLine {
  id: number;
  text: string;
  /** Offered while it can still be put back. */
  undo: boolean;
}

export function SelectBar({
  board,
  onAssign,
}: {
  board: Board;
  /** The people a card can be given to: those who own cards on the board, and no one. */
  onAssign: ((who: string | null) => void) | null;
}): ReactElement | null {
  const n = board.selected.size;
  if (n === 0) return null;
  const moveMenu = (e: unknown): void => {
    const p = pointOf(e);
    board.show(
      [
        { head: `Move ${n} to` },
        ...each(
          board.lanes.filter((l) => !l.none),
          (l): MenuEntry => ({ label: l.title, onSelect: () => board.moveTo(selectedRows(board), l, "bar") }),
        ),
      ],
      p.x,
      p.y,
    );
  };
  const assignMenu = (e: unknown): void => {
    if (!onAssign) return;
    const p = pointOf(e);
    const owners = new Set<string>();
    const own = board.owner;
    if (own)
      for (const r of Object.values(board.rows.current)) {
        const v = r.fields[own.key];
        if (typeof v === "string" && v) owners.add(v);
      }
    board.show(
      [
        { head: `Assign ${n} to` },
        ...each([...owners], (id): MenuEntry => ({ label: board.names(id), onSelect: () => onAssign(id) })),
        { separator: true },
        { label: "No one", onSelect: () => onAssign(null) },
      ],
      p.x,
      p.y,
    );
  };
  return (
    <View style={b.bar} testID="board-select-bar" accessibilityRole="toolbar">
      <Text style={b.count}>{`${n} selected`}</Text>
      <Pressable accessibilityRole="button" testID="bar-move" onPress={moveMenu} style={b.btn}>
        <Text style={b.btnText}>Move to</Text>
        <Glyph name="chevd" size={9} color="var(--ink-2)" />
      </Pressable>
      {onAssign && board.owner ? (
        <Pressable accessibilityRole="button" testID="bar-assign" onPress={assignMenu} style={b.btn}>
          <Text style={b.btnText}>Assign</Text>
          <Glyph name="chevd" size={9} color="var(--ink-2)" />
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" testID="bar-clear" onPress={board.clearSelection} style={b.btn}>
        <Text style={b.btnText}>Clear</Text>
      </Pressable>
      <View style={b.sp} />
      <Text style={b.hint}>Shift-click adds a range</Text>
    </View>
  );
}

export function Toast({
  line,
  onUndo,
  onClose,
}: {
  line: ToastLine | null;
  onUndo: () => void;
  onClose: () => void;
}): ReactElement | null {
  if (!line) return null;
  return (
    <View style={b.toast} accessibilityRole="alert" testID="board-toast" pointerEvents="box-none">
      <Text style={b.toastText} testID="board-toast-text">
        {line.text}
      </Text>
      {line.undo ? (
        <Pressable accessibilityRole="button" testID="board-undo" onPress={onUndo}>
          <Text style={b.undo}>Undo</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID="board-toast-close" onPress={onClose}>
        <Glyph name="cross" size={11} color="var(--ink-3)" />
      </Pressable>
    </View>
  );
}

const KEYS: { what: string; keys: string[] }[] = [
  { what: "Move between cards", keys: ["↑", "↓", "←", "→"] },
  { what: "Change stage", keys: ["Alt", "←", "→"] },
  { what: "Select", keys: ["Space"] },
  { what: "Open", keys: ["Enter"] },
  { what: "Undo", keys: ["Z"] },
];

export function Hints({ open, onToggle }: { open: boolean; onToggle: () => void }): ReactElement {
  return (
    <View style={b.foot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Keyboard shortcuts"
        accessibilityState={{ expanded: open }}
        testID="board-keys"
        onPress={onToggle}
        style={({ hovered }: { hovered?: boolean }) => [b.q, hovered === true && b.qOver]}
      >
        <Text style={b.qText}>?</Text>
      </Pressable>
      {open ? (
        <View style={b.keys} testID="board-keys-list" accessibilityRole="list">
          {each(KEYS, (k) => (
            <View key={k.what} style={b.keyRow} accessibilityRole="listitem">
              <Text style={b.hint}>{k.what}</Text>
              {each(k.keys, (x, i) => (
                <Text key={`${x}${i}`} style={b.kbd}>
                  {x}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const b = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "var(--accent-wash)" as string,
    boxShadow: "inset 0 0 0 1px var(--accent-line)",
  } as object,
  count: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string, marginRight: 4 },
  btn: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "inset 0 0 0 1px var(--line-2)",
  } as object,
  btnText: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  sp: { flex: 1 },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
  toast: {
    position: "absolute",
    alignSelf: "center",
    bottom: 36,
    zIndex: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-pop), inset 0 0 0 1px var(--line)",
  } as object,
  toastText: { fontSize: 13, color: "var(--ink)" as string, maxWidth: 520 },
  undo: { fontSize: 13, fontWeight: "600", color: "var(--accent)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 2 },
  q: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  qOver: { backgroundColor: "var(--hover)" as string },
  qText: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  keys: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  keyRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  kbd: {
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    color: "var(--ink-2)" as string,
    backgroundColor: "var(--sunk)" as string,
  },
});
