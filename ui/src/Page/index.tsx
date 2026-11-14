// ui/Page: the head and the one scroll column under it. One h1, one line under it that truncates, at most seven tabs, one primary action, an optional "..." menu and one status line under the head.
// A Page never draws "Loading": its children are Loadables, so a failed read cannot hide inside the frame (the Settings fault). `bare` draws no head, for a pane that already has a tab strip.
// Tabs use TabStrip's keys: Left and Right, Home and End. On a phone three show (the active one always among them) and the rest go under More. A side pane (`kind="side"`) opens on Details: its first tab is details.
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Status } from "../Status/index.tsx";
import type { StatusAction, Tone } from "../Status/index.tsx";
import { stepKey } from "../TabStrip/index.tsx";
import { belowPhone } from "../SidePane/layout.ts";

export const MAX_TABS = 7;
const PHONE_TABS = 3;

export interface PageTab {
  id: string;
  label: string;
  count?: number;
}
export interface PageProps {
  title: string;
  subtitle?: string;
  back?: { label: string; onPress(): void };
  tabs?: readonly PageTab[];
  tab?: string;
  onTab?(id: string): void;
  action?: ReactNode;
  menu?: readonly MenuEntry[];
  status?: { tone: Tone; text: string; action?: StatusAction };
  bare?: boolean;
  kind?: "page" | "side";
  testID?: string;
  children: ReactNode;
}

/** The tabs to draw: all of them, or on a phone three (the active one among them) and the rest under More. */
export function shownTabs(
  tabs: readonly PageTab[],
  active: string,
  phone: boolean,
): { shown: readonly PageTab[]; more: readonly PageTab[] } {
  if (!phone || tabs.length <= PHONE_TABS) return { shown: tabs, more: [] };
  const first = tabs.slice(0, PHONE_TABS);
  if (first.some((t) => t.id === active)) return { shown: first, more: tabs.slice(PHONE_TABS) };
  const keep = tabs.find((t) => t.id === active);
  const shown = keep ? [...first.slice(0, PHONE_TABS - 1), keep] : first;
  return { shown, more: tabs.filter((t) => !shown.includes(t)) };
}

const web = Platform.OS === "web";

export function Page({
  title,
  subtitle,
  back,
  tabs,
  tab,
  onTab,
  action,
  menu,
  status,
  bare = false,
  kind = "page",
  testID = "page",
  children,
}: PageProps): ReactElement {
  const { element, show } = useMenu();
  const width = useWindowDimensions().width;
  if (tabs && tabs.length > MAX_TABS) throw new Error(`A Page has at most seven tabs (${title} has ${tabs.length}).`);
  if (kind === "side" && tabs && tabs[0]?.id !== "details")
    throw new Error(`A side pane opens on Details: its first tab must be details (${title}).`);
  if (bare) return <>{children}</>;
  const active = tab ?? tabs?.[0]?.id ?? "";
  const { shown, more } = shownTabs(tabs ?? [], active, belowPhone(width));
  const keys = (tabs ?? []).map((t) => ({ key: t.id, title: t.label }));
  const move = (from: string, k: string): boolean => {
    const step =
      k === "ArrowLeft" ? "left" : k === "ArrowRight" ? "right" : k === "Home" ? "first" : k === "End" ? "last" : null;
    if (!step) return false;
    const to = stepKey(keys as never, from, step);
    if (to !== undefined) onTab?.(to);
    return true;
  };
  return (
    <View testID={testID} style={st.page}>
      <View style={st.head}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={back.label}
            testID={`${testID}-back`}
            onPress={back.onPress}
            style={st.back}
          >
            <Text style={st.backText}>{`< ${back.label}`}</Text>
          </Pressable>
        ) : null}
        <View style={st.titles}>
          <Text accessibilityRole="header" aria-level={1} numberOfLines={1} style={st.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={st.sub}
              {...(web ? ({ dataSet: { tt: subtitle, ttCut: "1" } } as object) : {})}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
        {menu ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More"
            testID={`${testID}-menu`}
            onPress={(e) => {
              const p = e as { clientX?: number; clientY?: number };
              show(menu, p.clientX ?? 0, p.clientY ?? 0, "other");
            }}
            {...menuTrigger((x, y) => show(menu, x, y, "context"))}
            style={st.more}
          >
            <Text style={st.backText}>...</Text>
          </Pressable>
        ) : null}
      </View>
      {tabs && tabs.length > 0 ? (
        <View accessibilityRole="tablist" role="tablist" style={st.tabs}>
          {/* ui-rows-lint: not a list (the tabs of a Page) */}
          {shown.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              role="tab"
              aria-selected={t.id === active}
              accessibilityState={{ selected: t.id === active }}
              testID={`${testID}-tab-${t.id}`}
              onPress={() => onTab?.(t.id)}
              {...(web
                ? ({
                    onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
                      if (move(t.id, e.key ?? "")) e.preventDefault?.();
                    },
                  } as object)
                : {})}
              style={[st.tab, t.id === active && st.tabOn]}
            >
              <Text style={[st.tabText, t.id === active && st.tabTextOn]}>{t.label}</Text>
              {t.count !== undefined ? <Text style={st.count}>{t.count}</Text> : null}
            </Pressable>
          ))}
          {more.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              testID={`${testID}-tab-more`}
              onPress={(e) => {
                const p = e as { clientX?: number; clientY?: number };
                show(
                  more.map((t) => ({ label: t.label, onSelect: () => onTab?.(t.id) })),
                  p.clientX ?? 0,
                  p.clientY ?? 0,
                  "other",
                );
              }}
              style={st.tab}
            >
              <Text style={st.tabText}>More</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {status ? (
        <Status
          bar
          tone={status.tone}
          label={status.text}
          {...(status.action ? { action: status.action } : {})}
          testID={`${testID}-status`}
        />
      ) : null}
      <ScrollView style={st.scroll} contentContainerStyle={st.column}>
        {children}
      </ScrollView>
      {element}
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  titles: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  back: { height: 28, justifyContent: "center", paddingHorizontal: 6, borderRadius: 7 },
  backText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  more: { height: 28, width: 28, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  tabs: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabOn: { borderBottomColor: "var(--ink)" as string },
  tabText: { fontSize: 13, color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  count: { fontSize: 11.5, color: "var(--ink-4)" as string },
  scroll: { flex: 1, minHeight: 0 },
  column: { paddingHorizontal: 18, paddingVertical: 16, gap: 16 },
});
