// The frame every Knowledge screen shares (spec 3.5): the header (a breadcrumb that starts at Knowledge, the screen's own quiet buttons, the Search knowledge field), the centred column with its
// title and one line under it, and the line that says what just happened with Undo. The screens fill the column; they never draw their own header.
import { Fragment, createElement, useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMemoryData } from "./data.tsx";
import type { KnowRoute } from "./know.ts";
import { Icon } from "./parts.tsx";

export interface Crumb { t: string; route?: KnowRoute; icon?: "graph" }

/** Breadcrumb, right-hand slot, search. `q` is the search field's text (empty outside Search); `focusSearch` puts the caret in it, as Search does when a person types in any header. */
export function KnowHeader({ crumbs, right, q = "", focusSearch = false }: { crumbs: readonly Crumb[]; right?: ReactNode; q?: string; focusSearch?: boolean }): ReactElement {
  const { nav } = useMemoryData();
  const box = useRef<{ focus(): void; setSelectionRange(a: number, b: number): void; value: string } | null>(null);
  useEffect(() => { if (focusSearch && box.current) { box.current.focus(); box.current.setSelectionRange(box.current.value.length, box.current.value.length); } }, [focusSearch]);
  const parts: ReactElement[] = [];
  for (let i = 0; i < crumbs.length; i++) {
    const c = crumbs[i]!, last = i === crumbs.length - 1;
    if (i > 0) parts.push(<Icon key={`s${i}`} name="chev" size={10} color="var(--ink-4)" />);
    parts.push(last || !c.route ? (
      <View key={`c${i}`} style={h.cur}>{c.icon ? <Icon name={c.icon} size={15} color="var(--ink-3)" /> : null}<Text accessibilityRole="header" aria-level={1} style={h.curText} numberOfLines={1}>{c.t}</Text></View>
    ) : (
      <Pressable key={`c${i}`} accessibilityRole="link" accessibilityLabel={c.t} testID={`know-crumb-${i}`} onPress={() => nav.go(c.route!)} style={({ hovered }: { hovered?: boolean }) => [h.crumb, hovered === true && h.over]}><Text style={h.crumbText}>{c.t}</Text></Pressable>
    ));
  }
  return (
    <View style={h.head} testID="know-head">
      <View style={h.crumbs}>{parts}</View>
      <View style={h.grow} />
      {right}
      <View style={h.find}>
        <Icon name="find" size={13} color="var(--ink-3)" />
        {Platform.OS === "web"
          ? createElement("input", {
            ref: (el: unknown) => { box.current = el as typeof box.current; }, value: q, placeholder: "Search knowledge", "aria-label": "Search knowledge", "data-testid": "know-search",
            onChange: (e: { target: { value: string } }) => nav.go({ v: "search", q: e.target.value }),
            onKeyDown: (e: { key: string }) => { if (e.key === "Escape") nav.go({ v: "learned" }); },
            style: { border: 0, outline: 0, background: "transparent", color: "var(--ink)", fontSize: 12.5, width: 116, fontFamily: "inherit" },
          })
          : null}
      </View>
    </View>
  );
}

/** The scrolling body of a screen: a column of at most 760 px with the title and the line under it. */
export function KnowColumn({ testID, label, title, lede, children }: { testID: string; label: string; title?: string; lede?: string; children: ReactNode }): ReactElement {
  return (
    <ScrollView style={h.scroll} contentContainerStyle={h.content} testID={testID} accessibilityLabel={label}>
      <View style={h.col}>
        {title ? <Text accessibilityRole="header" aria-level={2} style={h.title}>{title}</Text> : null}
        {lede ? <Text style={h.lede}>{lede}</Text> : null}
        {children}
      </View>
    </ScrollView>
  );
}

export interface FlashState { text: string; undo?: () => void }

/** "Moved to Trash. Undo": what the last action did, with a way back where there is one. */
export function Flash({ flash, onClose }: { flash: FlashState | null; onClose: () => void }): ReactElement | null {
  if (!flash) return null;
  return (
    <View style={h.flash} accessibilityRole="alert" testID="know-flash">
      <View style={h.dot} />
      <Text style={h.flashText}>{flash.text}</Text>
      {flash.undo ? <Pressable accessibilityRole="button" testID="know-flash-undo" onPress={() => { flash.undo!(); onClose(); }} style={({ hovered }: { hovered?: boolean }) => [h.fBtn, hovered === true && h.over]}><Text style={h.fBtnText}>Undo</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID="know-flash-x" onPress={onClose} style={({ hovered }: { hovered?: boolean }) => [h.fBtn, hovered === true && h.over]}><Icon name="x" size={12} color="var(--ink-3)" /></Pressable>
    </View>
  );
}

/** A section heading inside a column: "Facts  6 current" with something at its right. */
export function SectionHead({ title, sub, right, testID }: { title: string; sub?: string; right?: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={h.sec} {...(testID ? { testID } : {})}>
      <Text accessibilityRole="header" aria-level={3} style={h.secTitle}>{title}</Text>
      {sub ? <Text style={h.secSub}>{sub}</Text> : null}
      <View style={h.grow} />
      <Fragment>{right}</Fragment>
    </View>
  );
}

export function Empty({ title, text }: { title: string; text: string }): ReactElement {
  return <View style={h.empty} testID="know-empty"><Text style={h.emptyTitle}>{title}</Text><Text style={h.emptyText}>{text}</Text></View>;
}

export const frame = { main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string } };

const h = StyleSheet.create({
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 18, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 },
  crumb: { height: 26, paddingHorizontal: 6, borderRadius: 6, justifyContent: "center" },
  crumbText: { fontSize: 13, color: "var(--ink-2)" as string },
  cur: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, minWidth: 0 },
  curText: { margin: 0, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  grow: { flex: 1 },
  find: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  scroll: { flex: 1 },
  content: { alignItems: "center", paddingHorizontal: 24, paddingTop: 22, paddingBottom: 56 },
  col: { width: "100%", maxWidth: 760 },
  title: { margin: 0, fontSize: 20, fontWeight: "600", color: "var(--ink)" as string },
  lede: { marginTop: 6, fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string, maxWidth: 620 },
  flash: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, paddingLeft: 12, paddingRight: 6, height: 36, borderRadius: 9, backgroundColor: "var(--accent-wash)" as string },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  flashText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  fBtn: { height: 26, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center", alignItems: "center" },
  fBtnText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  sec: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 28, marginBottom: 8, minHeight: 24 },
  secTitle: { margin: 0, fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  secSub: { fontSize: 12, color: "var(--ink-3)" as string },
  empty: { paddingVertical: 48, alignItems: "center", gap: 4 },
  emptyTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  emptyText: { fontSize: 13, color: "var(--ink-3)" as string },
});
