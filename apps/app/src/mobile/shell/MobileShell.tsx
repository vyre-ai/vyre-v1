// The phone shell (spec 3.11, ARCH 7.11): the screen on show, a Back bar when you have gone deeper, and the five bottom tabs Chats (with its Needs you count), Inbox, Records, Files and
// You. Back returns to the screen you came from (the history in ./model.ts), not the parent. The shell draws no place itself: it asks `renderScreen` for the entry on show, so every place
// keeps its own screens and the compact variants of the shared components. Hit targets are 44 px, the tab bar sits above the home indicator.
import { useCallback, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./icons.tsx";
import { MOBILE_TABS, back, canBack, current, initialNav, open, origin, selectTab } from "./model.ts";
import type { Entry, NavState, TabId } from "./model.ts";

export interface MobileNav {
  open(entry: Entry): void;
  back(): void;
  selectTab(tab: TabId): void;
  /** What Back would return to, for the bar's label. */
  origin: Entry | undefined;
}

export interface MobileShellProps {
  renderScreen(entry: Entry, nav: MobileNav): ReactNode;
  /** The number on the Chats tab: what waits on you. */
  needsYou?: number;
  initialTab?: TabId;
  /** Called after every move (tests and the router bridge). */
  onNav?(state: NavState): void;
}

export function MobileShell({ renderScreen, needsYou = 0, initialTab = "chats", onNav }: MobileShellProps): ReactElement {
  const [nav, setNav] = useState<NavState>(() => initialNav(initialTab));
  const move = useCallback((f: (s: NavState) => NavState) => setNav((s) => { const n = f(s); if (n !== s) onNav?.(n); return n; }), [onNav]);
  const top = current(nav);
  const from = origin(nav);
  const api: MobileNav = {
    open: (e) => move((s) => open(s, e)),
    back: () => move(back),
    selectTab: (t) => move((s) => selectTab(s, t)),
    origin: from,
  };
  const tabs: ReactElement[] = [];
  for (const t of MOBILE_TABS) {
    const on = top.tab === t.id;
    tabs.push(
      <Pressable key={t.id} role="tab" aria-selected={on} aria-label={t.id === "chats" && needsYou > 0 ? `${t.label}, ${needsYou} need you` : t.label} testID={`tab-${t.id}`} onPress={() => api.selectTab(t.id)} style={st.tab}>
        <View>
          <Icon name={t.id} color={on ? "var(--accent)" : "var(--ink-3)"} />
          {t.id === "chats" && needsYou > 0 ? <View testID="tab-badge" style={st.badge}><Text style={st.badgeText}>{needsYou > 99 ? "99+" : needsYou}</Text></View> : null}
        </View>
        <Text style={[st.tabText, on && st.tabTextOn]}>{t.label}</Text>
      </Pressable>,
    );
  }
  return (
    <View testID="mobile-shell" style={st.root}>
      {canBack(nav) ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${from?.title ?? from?.screen ?? ""}`} onPress={api.back} testID="mobile-back" style={st.backBar}>
          <Icon name="back" size={18} color="var(--accent)" />
          <Text numberOfLines={1} style={st.backText}>{from?.title ?? "Back"}</Text>
        </Pressable>
      ) : null}
      <View testID={`screen-${top.screen}`} style={st.screen}>{renderScreen(top, api)}</View>
      <View role="tablist" aria-label="Places" testID="mobile-tabs" style={st.tabs}>{tabs}</View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  backBar: { height: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  backText: { fontSize: 16, color: "var(--accent)" as string, flexShrink: 1 },
  screen: { flex: 1, minHeight: 0 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--side)" as string, paddingBottom: 8 },
  tab: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", gap: 2, paddingTop: 6 },
  tabText: { fontSize: 10.5, color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--accent)" as string, fontWeight: "600" },
  badge: { position: "absolute", right: -10, top: -4, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10.5, fontWeight: "600", color: "var(--accent-ink)" as string },
});
