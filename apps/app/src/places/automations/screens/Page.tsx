// The page head the Automations screens use until the shared Page lands (contract P3): a title and one quiet line, tabs, one action slot, a "..." menu, then the children. Its props are the contract's
// (title, subtitle, tabs, tab, onTab, action, menu, children), so swapping in ui/Page is a change of import.
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { look } from "./look.ts";

export interface PageProps {
  title: string;
  subtitle?: string;
  tabs?: readonly { id: string; label: string }[];
  tab?: string;
  onTab?(id: string): void;
  action?: ReactNode;
  /** The "..." button; it opens the caller's menu. */
  onMenu?(e: unknown): void;
  children: ReactNode;
}

export function Page(p: PageProps): ReactElement {
  return (
    <View style={s.page} testID="page">
      <View style={s.head}>
        <View style={s.grow}>
          <Text accessibilityRole="header" style={s.title} numberOfLines={1}>
            {p.title}
          </Text>
          {p.subtitle ? (
            <Text style={look.quiet} numberOfLines={1}>
              {p.subtitle}
            </Text>
          ) : null}
        </View>
        {p.action}
        {p.onMenu ? (
          <Pressable
            testID="page-menu"
            accessibilityRole="button"
            accessibilityLabel="More"
            onPress={p.onMenu}
            style={s.more}
          >
            <Text style={s.moreText}>{"…"}</Text>
          </Pressable>
        ) : null}
      </View>
      {p.tabs && p.tabs.length > 0 ? (
        <View style={s.tabs} accessibilityRole="tablist">
          {/* ui-rows-lint: not a list (the page's tab strip) */}
          {p.tabs.map((t) => (
            <Pressable
              key={t.id}
              testID={`page-tab-${t.id}`}
              accessibilityRole="tab"
              aria-selected={p.tab === t.id}
              onPress={() => p.onTab?.(t.id)}
              style={[s.tab, p.tab === t.id ? s.tabOn : null]}
            >
              <Text style={[s.tabText, p.tab === t.id ? s.tabTextOn : null]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={s.body}>{p.children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0, width: "100%" },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  more: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  moreText: { fontSize: 18, color: "var(--ink-2)" as string },
  tabs: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: "var(--accent)" as string },
  tabText: { fontSize: 13.5, color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  body: { flex: 1, minHeight: 0 },
});
