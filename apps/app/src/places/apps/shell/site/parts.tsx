// Small pieces of the site page: the mark of a step or a deploy, a block of log lines that stays at its end, and a button that opens a menu where it was pressed.
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MenuIcon, useMenu } from "../../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../../ui/src/Menu/index.tsx";

const svg = (d: string, width = 2): string =>
  `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const CHECK = svg('<path d="M3.5 8.5l3 3 6-7"/>');
const CROSS = svg('<path d="M4.5 4.5l7 7M11.500 4.500l-7 7"/>');
const CHEVRON = `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.500 2l3 3-3 3"/></svg>`;
const CHEVRON_DOWN = `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.500l3 3 3-3"/></svg>`;

export type MarkState = "ok" | "failed" | "running" | "waiting" | "skipped";
/** A deploy's state as a step's: ready is done, a canceled one never finished. */
export const markOf = (state: string): MarkState =>
  state === "ready"
    ? "ok"
    : state === "failed"
      ? "failed"
      : state === "building" || state === "queued"
        ? "running"
        : "skipped";

/** The round mark before a step or a deploy: done, failed, running, or not run. */
export function StepMark({ state }: { state: MarkState }): ReactElement {
  if (state === "ok")
    return (
      <View style={[s.mark, { backgroundColor: "var(--ok)" as string }]}>
        <MenuIcon icon={CHECK} color="#fff" size={10} />
      </View>
    );
  if (state === "failed")
    return (
      <View style={[s.mark, { backgroundColor: "var(--danger)" as string }]}>
        <MenuIcon icon={CROSS} color="#fff" size={10} />
      </View>
    );
  if (state === "running")
    return (
      <View style={[s.mark, s.ring, { borderColor: "var(--accent)" as string }]}>
        <View style={s.dot} />
      </View>
    );
  return <View style={[s.mark, s.ring]} />;
}

export function Chevron({ open }: { open?: boolean }): ReactElement {
  return <MenuIcon icon={open ? CHEVRON_DOWN : CHEVRON} color="var(--ink-4)" size={10} />;
}

/** Log lines in the fixed-width face. It stays at its last line as lines arrive, unless the person scrolled up to read. A line Vyre wrote ("==> Building") is in the first ink. */
export function LogLines({
  lines,
  testID,
  empty,
  height,
}: {
  lines: readonly string[];
  testID?: string;
  empty: string;
  height?: number;
}): ReactElement {
  const ref = useRef<ScrollView | null>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    if (atEnd.current) ref.current?.scrollToEnd({ animated: false });
  }, [lines.length]);
  return (
    <ScrollView
      ref={ref}
      style={[s.log, height !== undefined ? { height } : { maxHeight: 300 }]}
      testID={testID}
      scrollEventThrottle={64}
      onScroll={(e) => {
        const n = e.nativeEvent;
        atEnd.current = n.contentOffset.y + n.layoutMeasurement.height >= n.contentSize.height - 24;
      }}
    >
      {lines.length === 0 ? (
        <Text style={s.logText}>{empty}</Text>
      ) : (
        <Text selectable style={s.logText}>
          {/* ui-rows-lint: not a list (the lines of a log, one text) */}
          {lines.map((l, i) => (
            <Text key={i} style={l.startsWith("==> ") ? s.logOwn : undefined}>
              {`${l.startsWith("==> ") ? l.slice(4) : l}\n`}
            </Text>
          ))}
        </Text>
      )}
    </ScrollView>
  );
}

/** A quiet button that opens a menu under itself. */
export function MenuButton({
  title,
  entries,
  testID,
  disabled,
  search,
  plain = false,
}: {
  title: string;
  entries: readonly MenuEntry[];
  testID?: string;
  disabled?: boolean;
  /** A search field at the top of the menu, with this placeholder (a long list of Vault keys). */
  search?: string;
  /** An action that asks first ("Roll back"): accent words, no chevron; the menu holds the question and the yes. */
  plain?: boolean;
}): ReactElement {
  const { element, show } = useMenu();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        testID={testID}
        onPress={(event) => {
          // it may sit in a row that opens on a press: this press is the button's alone
          event.stopPropagation();
          const e = event as unknown as {
            currentTarget?: { getBoundingClientRect?(): { left: number; bottom: number } };
            nativeEvent?: { pageX?: number; pageY?: number };
          };
          const rect = e.currentTarget?.getBoundingClientRect?.();
          show(
            entries,
            rect?.left ?? e.nativeEvent?.pageX ?? 20,
            (rect?.bottom ?? e.nativeEvent?.pageY ?? 100) + 4,
            "other",
            undefined,
            search ? { search } : undefined,
          );
        }}
        style={({ hovered }: { hovered?: boolean }) => [s.menuBtn, hovered === true && s.over, disabled && s.dim]}
      >
        <Text style={[s.menuBtnText, plain && s.accent]} numberOfLines={1}>
          {title}
        </Text>
        {plain ? null : <Chevron open />}
      </Pressable>
      {element}
    </>
  );
}

const s = StyleSheet.create({
  mark: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  ring: { borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--accent)" as string },
  log: { borderRadius: 10, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 12, paddingVertical: 10 },
  logText: { fontFamily: "var(--mono)" as string, fontSize: 11.5, lineHeight: 18, color: "var(--ink-2)" as string },
  logOwn: { color: "var(--ink)" as string, fontWeight: "500" },
  menuBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 8,
    maxWidth: 260,
  },
  menuBtnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  accent: { color: "var(--accent)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  dim: { opacity: 0.45 },
});
