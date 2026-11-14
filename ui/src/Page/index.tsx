// ui/Page: the head and the one scroll column under it. One h1, one line under it that truncates, at most seven tabs, one primary action, an optional "..." menu and one status line under the head.
// A Page never draws "Loading": its children are Loadables, so a failed read cannot hide inside the frame (the Settings fault). `bare` draws no head, for a pane that already has a tab strip.
// Tabs are the one TabStrip (arrow keys move focus, only the open tab is in the tab order). On a phone three show (the active one always among them) and the rest go under More; picking one from More puts
// it in the strip in place of the last, so a tab can move under the thumb. A side pane (`kind="side"`) opens on Details: its first tab is details.
// A mistake in the tabs (more than seven, a side pane not starting on Details) throws while developing and testing so a lane finds it; in the product a person never sees a broken page (see fitTabs).
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { menuTrigger } from "../Menu/index.tsx";
import { Status } from "../Status/index.tsx";
import type { StatusAction, Tone } from "../Status/index.tsx";
import { TabStrip } from "../TabStrip/index.tsx";
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

/** The tabs to draw: all of them, or on a phone three (the active one among them) and the rest under More. `overflow` are tabs past the seventh, which always go under More. */
export function shownTabs(
  tabs: readonly PageTab[],
  active: string,
  phone: boolean,
  overflow: readonly PageTab[] = [],
): { shown: readonly PageTab[]; more: readonly PageTab[] } {
  if (!phone || tabs.length <= PHONE_TABS) return { shown: tabs, more: overflow };
  const first = tabs.slice(0, PHONE_TABS);
  if (first.some((t) => t.id === active)) return { shown: first, more: [...tabs.slice(PHONE_TABS), ...overflow] };
  const keep = tabs.find((t) => t.id === active);
  const shown = keep ? [...first.slice(0, PHONE_TABS - 1), keep] : first;
  return { shown, more: [...tabs.filter((t) => !shown.includes(t)), ...overflow] };
}

const web = Platform.OS === "web";
const production = (): boolean =>
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === "production";
const told = new Set<string>();

/**
 * The tabs a Page can draw. A mistake in a Page's tabs (more than seven, a side pane that does not start on Details) throws while developing and testing, so a lane finds it; in the product a person never
 * sees a broken page: the first seven are shown, the rest go under More, Details goes first, and the mistake is logged once.
 */
export function fitTabs(
  tabs: readonly PageTab[] | undefined,
  kind: "page" | "side",
  title: string,
): { shown: readonly PageTab[]; overflow: readonly PageTab[] } {
  let list = tabs ?? [];
  const fail = (message: string): void => {
    if (!production()) throw new Error(message);
    if (!told.has(message)) {
      told.add(message);
      console.error(message);
    }
  };
  if (kind === "side" && list.length > 0 && list[0]?.id !== "details") {
    fail(`A side pane opens on Details: its first tab must be details (${title}).`);
    const d = list.find((t) => t.id === "details");
    if (d) list = [d, ...list.filter((t) => t !== d)];
  }
  if (list.length > MAX_TABS) {
    fail(`A Page has at most seven tabs (${title} has ${list.length}).`);
    return { shown: list.slice(0, MAX_TABS), overflow: list.slice(MAX_TABS) };
  }
  return { shown: list, overflow: [] };
}

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
  const fitted = fitTabs(tabs, kind, title);
  if (bare) return <>{children}</>;
  const active = tab ?? fitted.shown[0]?.id ?? "";
  const { shown, more } = shownTabs(fitted.shown, active, belowPhone(width), fitted.overflow);
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
      {shown.length > 0 ? (
        <View style={st.tabs}>
          <View style={st.strip}>
            {/* the one TabStrip: arrow keys move focus, and only the open tab is in the tab order */}
            <TabStrip
              tabs={shown.map((t) => ({ key: t.id, title: t.count !== undefined ? `${t.label} ${t.count}` : t.label }))}
              active={active}
              label={title}
              underline
              noOptions
              noClose
              bare
              onSelect={(key) => onTab?.(key)}
            />
          </View>
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
              style={st.moreTab}
            >
              <Text style={st.moreText}>More</Text>
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
    alignItems: "flex-end",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  strip: { flex: 1, minWidth: 0 },
  moreTab: { height: 34, paddingHorizontal: 8, justifyContent: "center" },
  moreText: { fontSize: 13, color: "var(--ink-3)" as string },
  scroll: { flex: 1, minHeight: 0 },
  column: { paddingHorizontal: 18, paddingVertical: 16, gap: 16 },
});
