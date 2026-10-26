// The Home sidebar (spec 3.1): Home, My work (Assigned by you, Runs), then Starred, Following and Recent as open-and-close folders. Every row is a ui/Row with its
// leading and trailing slots. The shared place slot draws the title, the collapse button and the search field; this is what goes inside it.
import { createContext, useContext, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { MenuIcon } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { iconMarkup } from "../../../shell/rail/icons.tsx";
import { SidebarContent, each } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { fixedRows, visibleFolders } from "./model.ts";
import type { FolderKey, HomeItemKind, HomeSidebarData, HomeSidebarItem } from "./model.ts";

/** What the host gives the Home sidebar: the lists, and where a chosen row goes. */
export interface HomeSidebarHost {
  data: HomeSidebarData;
  go(target: { place: string; hash?: string }): void;
  /** The row that is open now (a fixed row id or an item id). */
  selected?: string;
}

const Ctx = createContext<HomeSidebarHost | null>(null);

export function HomeSidebarProvider({ value, children }: { value: HomeSidebarHost; children?: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHomeSidebar(): HomeSidebarHost {
  const v = useContext(Ctx);
  if (v === null) throw new Error("The Home sidebar needs a HomeSidebarProvider above it");
  return v;
}

const KIND_ICON: Readonly<Record<HomeItemKind, string>> = {
  terminal: iconMarkup("terminal"), file: iconMarkup("files"), project: iconMarkup("records"), record: iconMarkup("records"), chat: iconMarkup("chats"), automation: iconMarkup("automations"),
  agent: "", assistant: "", person: "",
};

const DOTS = ["#2F9E6B", "#C77A2B", "#D64545", "#3B82C4", "#8B5CF6"];
function dotColor(title: string): string {
  let h = 7;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DOTS[h % DOTS.length] as string;
}

/** The gap between a leading icon and the title (the Row's slot has none of its own). */
function Gap({ children }: { children: ReactNode }): ReactElement {
  return <View style={s.lead}>{children}</View>;
}

function Lead({ item }: { item: HomeSidebarItem }): ReactElement {
  if (item.kind === "project" || item.kind === "record") return <Gap><View style={[s.dot, { backgroundColor: dotColor(item.title) }]} /></Gap>;
  if (item.kind === "agent" || item.kind === "assistant" || item.kind === "person") return <Gap><Avatar name={item.kind === "assistant" ? "Assistant" : item.title} kind={item.kind === "person" ? "person" : item.kind === "assistant" ? "assistant" : "agent"} size={16} /></Gap>;
  return <Gap><MenuIcon icon={KIND_ICON[item.kind]} color="var(--ink-3)" /></Gap>;
}

function Count({ n, hot = false }: { n: number; hot?: boolean }): ReactElement {
  return hot ? <View style={s.badge}><Text style={s.badgeText}>{String(n)}</Text></View> : <Text style={s.count}>{String(n)}</Text>;
}

export function HomeSidebarItems({ query, slot }: { query: string; slot?: SidebarSlotApi }): ReactElement {
  const host = useHomeSidebar();
  const [closed, setClosed] = useState<ReadonlySet<FolderKey>>(new Set());
  const open = (target: { place: string; hash?: string }): void => { host.go(target); slot?.openBody(); };
  const fixed = fixedRows(host.data, query);
  const folders = visibleFolders(host.data, query);
  const toggle = (k: FolderKey): void => setClosed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.body} testID="home-sidebar">
      {each(fixed, (r) => (
        <View key={r.id} style={r.child === true ? s.child : undefined}>
          <Row id={`hs-${r.id}`} title={r.title} selected={(host.selected ?? "home") === r.id} onPress={() => open(r.target)}
            leading={<Gap><MenuIcon icon={r.id === "home" ? iconMarkup("home") : r.id === "work" ? WORK : r.id === "assigned" ? ASSIGNED : RUNS} color="var(--ink-3)" /></Gap>}
            trailing={r.count !== undefined ? <Count n={r.count} hot={r.id === "work"} /> : undefined} />
        </View>
      ))}
      {each(folders, (f) => (
        <View key={f.key} testID={`hs-folder-${f.key}`}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${f.title}, ${closed.has(f.key) ? "closed" : "open"}`} aria-expanded={!closed.has(f.key)} testID={`hs-toggle-${f.key}`} onPress={() => toggle(f.key)}
            style={({ hovered }: { hovered?: boolean }) => [s.folder, hovered === true && s.hover]}>
            <Text style={s.folderTitle}>{f.title}</Text>
            <View style={closed.has(f.key) ? s.chevClosed : undefined}><MenuIcon icon={iconMarkup("chev")} color="var(--ink-4)" size={12} /></View>
          </Pressable>
          {closed.has(f.key) ? null : each(f.rows, (it) => (
            <Row key={it.id} id={`hs-${f.key}-${it.id}`} title={it.title} {...(it.note !== undefined ? { note: it.note } : {})} selected={host.selected === it.id}
              leading={<Lead item={it} />} onPress={() => open(it.target)} />
          ))}
        </View>
      ))}
      {fixed.length === 0 && folders.length === 0 ? <Text style={s.empty} testID="hs-empty">Nothing matches that.</Text> : null}
    </ScrollView>
  );
}

/** Put this inside the Home place: it registers the Home sidebar in the shell's slot. */
export function HomeSidebar(): ReactElement {
  return <SidebarContent title="Home" searchPlaceholder="Search">{(q, slot) => <HomeSidebarItems query={q} slot={slot} />}</SidebarContent>;
}

const WORK = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.500"/><path d="M5.500 8l2 2 3-3.500"/></svg>';
const ASSIGNED = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H3.500v10H6M10 5l3 3-3 3M13 8H6"/></svg>';
const RUNS = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.500 8a5.500 5.500 0 109.500-3.800M12.500 2v3H9.500"/></svg>';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  body: { paddingHorizontal: 8, paddingBottom: 16 },
  child: { paddingLeft: 14 },
  lead: { marginRight: 8, minWidth: 16, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
  count: { color: "var(--ink-4)" as string, fontSize: 11.5 },
  folder: { flexDirection: "row", alignItems: "center", gap: 4, height: 28, marginTop: 10, paddingHorizontal: 8, borderRadius: 6 },
  folderTitle: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "600" },
  chevClosed: { transform: [{ rotate: "-90deg" }] },
  hover: { backgroundColor: "var(--hover)" as string },
  empty: { color: "var(--ink-3)" as string, fontSize: 13, textAlign: "center", paddingVertical: 24 },
});
