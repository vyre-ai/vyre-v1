// Pieces the Studio views share: the page frame, a call that loads once, a quiet header menu button, number tiles, bars and an empty state that says what to do next.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { AskVyre } from "../ask/AskVyre.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { Glyph } from "../canvas/icons.tsx";
import { pointer, webOnly } from "../canvas/parts.tsx";

export { Row };

export type Phase<T> = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; value: T };

/** One capability call, made again when the input changes or `again` goes up. A reply the parser rejects is an error, not an empty list. */
export function useCall<T>(cap: string, input: unknown, parse: (out: unknown) => T | null, again = 0): Phase<T> {
  const data = useAutomationsData();
  const [state, setState] = useState<Phase<T>>({ phase: "loading" });
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    void data.call(cap, JSON.parse(key) as unknown).then((out) => {
      if (!live) return;
      const value = parse(out);
      setState(value === null ? { phase: "error", message: "That list did not return rows." } : { phase: "ready", value });
    }).catch((e: unknown) => {
      if (!live) return;
      setState({ phase: "error", message: e instanceof Error ? e.message : "That did not load." });
    });
    return () => { live = false; };
  }, [data, cap, key, again]);
  return state;
}

export function Frame({ testID, title, line, actions, children }: { testID: string; title: string; line?: string; actions?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <View testID={testID} style={v.page}>
      <View style={v.head}>
        <View style={v.headText}>
          <Text accessibilityRole="header" style={v.title}>{title}</Text>
          {line ? <Text style={v.dim}>{line}</Text> : null}
        </View>
        {actions ? <View style={v.actions}>{actions}</View> : null}
      </View>
      {children}
    </View>
  );
}

export function Status({ state }: { state: Phase<unknown> }): ReactElement | null {
  if (state.phase === "loading") return <Text style={v.dim} accessibilityLiveRegion="polite">Loading</Text>;
  if (state.phase === "error") {
    return (
      <View style={v.stack}>
        <Text style={v.err} accessibilityRole="alert">{state.message}</Text>
        <AskVyre bundle={{ resource: "automation", message: state.message }} />
      </View>
    );
  }
  return null;
}

/** A header button that opens a menu under itself. Enter or Space opens it, arrows move, Escape closes. */
export function MenuButton({ label, entries, testID, icon = "chevD" }: { label: string; entries: readonly MenuEntry[]; testID: string; icon?: "chevD" | "plus" }): ReactElement {
  const { element, show } = useMenu();
  const [over, setOver] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens a menu"
        testID={testID}
        onHoverIn={() => setOver(true)}
        onHoverOut={() => setOver(false)}
        onPress={(e) => {
          const box = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
          show(entries, box?.left ?? 0, (box?.bottom ?? 0) + 4, "other");
        }}
        {...webOnly({ title: label })}
        style={[v.menuBtn, over && v.menuBtnOver, pointer]}
      >
        <Text style={v.menuText} numberOfLines={1}>{label}</Text>
        <Glyph name={icon} size={11} color="var(--ink-3)" />
      </Pressable>
      {element}
    </View>
  );
}

/**
 * Right-click, Shift-F10 and the menu key open a row's menu. One menu serves the whole list; `rowDom` builds the handlers for one row,
 * and the entries are built when the menu opens, so every item acts on the row that was clicked. A row is always the ui/Row: press or Enter opens it, hover lights it.
 */
export function useRowMenu(): { element: ReactElement | null; rowDom(label: string, build: () => readonly MenuEntry[]): Record<string, unknown> } {
  const { element, show } = useMenu();
  return { element, rowDom: (label, build) => menuTrigger((x, y) => show(build(), x, y, "context", { label })) };
}

export function Tile({ label, value, note, testID, tone }: { label: string; value: string; note?: string; testID: string; tone?: "danger" }): ReactElement {
  return (
    <View testID={testID} accessible accessibilityLabel={`${label}: ${value}`} style={v.tile}>
      <Text style={v.tileLabel}>{label}</Text>
      <Text style={[v.tileValue, tone === "danger" && { color: "var(--danger)" as string }]}>{value}</Text>
      {note ? <Text style={v.tileNote}>{note}</Text> : null}
    </View>
  );
}

/** What is missing and the next thing to do about it. The button is optional. */
export function Empty({ testID, title, next, action, onAction }: { testID: string; title: string; next: string; action?: string; onAction?: () => void }): ReactElement {
  return (
    <View testID={testID} style={v.empty}>
      <Text style={v.emptyTitle}>{title}</Text>
      <Text style={v.dim}>{next}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" testID={`${testID}-action`} onPress={onAction} style={[v.emptyBtn, pointer]}>
          <Text style={v.menuText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const v = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 14, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headText: { flex: 1, gap: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  dim: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 13, lineHeight: 18, color: "var(--danger)" as string },
  row: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  strong: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: "var(--ink)" as string },
  stack: { gap: 8 },
  section: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 6 },
  list: { gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  lineOver: { backgroundColor: "var(--hover)" as string },
  lineOn: { backgroundColor: "var(--accent-wash)" as string },
  lineMain: { flex: 1, minWidth: 0, gap: 1 },
  right: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  tag: { fontSize: 11.5, fontWeight: "600", color: "var(--danger)" as string },
  tagWarn: { fontSize: 11.5, fontWeight: "600", color: "var(--warn)" as string },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { minWidth: 120, flexGrow: 1, flexBasis: 120, gap: 2, padding: 12, borderRadius: 10, backgroundColor: "var(--surface-2)" as string },
  tileLabel: { fontSize: 12, color: "var(--ink-3)" as string },
  tileValue: { fontSize: 20, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  tileNote: { fontSize: 11.5, color: "var(--ink-3)" as string },
  menuBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 7 },
  menuBtnOver: { backgroundColor: "var(--hover)" as string },
  menuText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  empty: { gap: 6, paddingVertical: 24, maxWidth: 480 },
  emptyTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  emptyBtn: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 84 },
  barCol: { flex: 1, minWidth: 3, justifyContent: "flex-end" },
  input: { fontSize: 13, color: "var(--ink)" as string, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, padding: 8, maxWidth: 220 },
  detail: { gap: 6, padding: 12, borderRadius: 10, backgroundColor: "var(--surface-2)" as string },
  mono: { fontSize: 12, lineHeight: 17, color: "var(--ink-2)" as string, ...({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as object) },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--surface-2)" as string },
  btn: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  btnPrimary: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 7, backgroundColor: "var(--accent)" as string },
  btnPrimaryText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent-ink)" as string },
});
