// The Settings place (spec 3.9; ARCH 7.9): ten pages in two groups, named after the open Space and "Everywhere", with a search box (Cmd-F) that finds every row. Changes save as they are
// made. On a phone the page list and a page are two screens with a back arrow.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { PAGE, useScreenQuery, useSettingsData } from "./data.tsx";
import { PAGES, pageByKey, searchRows } from "./model.ts";
import type { Hit, PageKey, SettingRow } from "./model.ts";
import { AppearancePage, ComputerPage, KeyboardPage, SignInPage, SpacesPage } from "./pages-b.tsx";
import { ConnectionsPage, ModelsPage, NotificationsPage, PrivacyPage, ProfilePage } from "./pages-a.tsx";
import { SavedBar, SavedProvider } from "./saved.tsx";
import { Glyph, IconBox, Mark, pointer, webOnly } from "./ui.tsx";
import type { KeyEventLike } from "./ui.tsx";

type ListOut = CapMap["settings.list"]["out"];

export interface SettingsProps {
  initialPage?: PageKey;
  initialQuery?: string;
  /** Phone: start on the page list. */
  initialView?: "nav" | "page";
  /** A row to point at, as if the search had just opened it. */
  initialFound?: string | null;
  /** The window width, when the shell knows it before the first layout (and for the tests, which render without a window). */
  width?: number;
}

export function SettingsPlace(props: SettingsProps): ReactElement {
  return <SavedProvider><SettingsBody {...props} /></SavedProvider>;
}

function SettingsBody({ initialPage = "profile", initialQuery = "", initialView = "page", initialFound = null, width: given }: SettingsProps): ReactElement {
  const data = useSettingsData();
  const measured = useWindowDimensions().width;
  const phone = (given ?? measured) < 760;
  const [page, setPage] = useState<PageKey>(initialPage);
  const [view, setView] = useState<"nav" | "page">(initialView);
  const [q, setQ] = useState(initialQuery);
  const [found, setFound] = useState<string | null>(initialFound);
  const [cursor, setCursor] = useState(0);
  const search = useRef<{ focus?: () => void } | null>(null);
  const list = useScreenQuery<ListOut>(PAGE, "rows", {});
  const rows: readonly SettingRow[] = list.status === "ready" ? list.data.rows : [];
  const hits = useMemo(() => searchRows(rows, q), [rows, q]);
  const def = pageByKey(page);

  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setView("nav"); search.current?.focus?.(); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, []);
  // the row the search found is brought into view
  useEffect(() => {
    if (!found) return undefined;
    const doc = (globalThis as { document?: { querySelector(s: string): { scrollIntoView?: (o: unknown) => void } | null } }).document;
    const t = setTimeout(() => (doc?.querySelector(`[data-sid="${found}"]`) ?? doc?.querySelector(`[data-sid^="${found}."]`))?.scrollIntoView?.({ block: "center" }), 60);
    return () => clearTimeout(t);
  }, [found, page]);

  const open = (key: PageKey, row: string | null = null): void => { setPage(key); setFound(row); setView("page"); if (row) setQ(""); };
  const onSearchKey = (e: KeyEventLike): void => {
    if (e.key === "Escape") { setQ(""); return; }
    if (e.key === "ArrowDown") { e.preventDefault?.(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault?.(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === "Enter") { const h = hits[cursor]; if (h) { e.preventDefault?.(); open(h.page, h.key); } }
  };

  const pageRows: ReactElement[] = [];
  const spaceTitle = data.space.name;
  let last = "";
  for (const p of PAGES) {
    if (p.group !== last) {
      last = p.group;
      pageRows.push(
        <View key={`g-${p.group}`} style={n.groupHead}>
          {p.group === "space" ? <Mark name={spaceTitle} size={16} /> : null}
          <Text accessibilityRole="header" style={n.groupTitle}>{p.group === "space" ? spaceTitle : "Everywhere"}</Text>
        </View>,
      );
    }
    pageRows.push(<Row key={p.key} id={`page-${p.key}`} title={p.title} selected={!q.trim() && page === p.key} leading={<IconBox name={p.icon} />} onPress={() => open(p.key)} />);
  }
  const searching = q.trim().length > 0;
  const hitRows: ReactElement[] = [];
  hits.forEach((h: Hit, i) => hitRows.push(
    <Row
      key={h.key} id={`hit-${h.key}`} title={h.title} {...(h.sub ? { note: h.sub } : {})} selected={i === cursor} leading={<IconBox name={pageByKey(h.page).icon} />}
      trailing={<View style={n.hitPage}><Text style={n.hitPageText}>{pageByKey(h.page).title}</Text><Glyph name="chevR" size={12} color="var(--ink-3)" /></View>}
      onPress={() => open(h.page, h.key)}
    />,
  ));
  const searchPage = (
    <View testID="search-results" accessibilityLabel="Search results">
      {hits.length > 0 ? (
        <>
          <Text accessibilityRole="header" style={n.count} testID="search-count">{`${hits.length} ${hits.length === 1 ? "setting" : "settings"}`}</Text>
          <View style={n.hitCard}>{hitRows}</View>
        </>
      ) : <Text style={n.none} testID="search-none">{`Nothing matches "${q.trim()}"`}</Text>}
    </View>
  );

  const nav = (
    <View style={[n.nav, phone && { width: "100%" as unknown as number, borderRightWidth: 0 }]} testID="settings-nav">
      <View style={n.top}>
        <Mark name={spaceTitle} size={22} />
        <Text numberOfLines={1} style={n.space}>{spaceTitle}</Text>
        {data.spaces.some((sp) => !sp.current && sp.needsYou > 0) ? <View style={n.dot} accessibilityLabel="Another Space needs you" /> : null}
      </View>
      <View style={n.searchWrap}>
        <View style={n.search}>
          <Glyph name="search" size={14} color="var(--ink-3)" />
          <TextInput
            ref={(r) => { search.current = r as unknown as { focus?: () => void } | null; }}
            accessibilityLabel="Search settings" testID="settings-search" value={q} onChangeText={(t) => { setQ(t); setCursor(0); }} placeholder="Search settings" placeholderTextColor="var(--ink-3)"
            {...webOnly({ onKeyDown: onSearchKey })} style={n.searchInput}
          />
          {q ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => setQ("")} style={pointer}><Glyph name="x" size={12} color="var(--ink-3)" /></Pressable>
          ) : <Text style={n.hint}>Cmd F</Text>}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={n.scroll} keyboardShouldPersistTaps="handled">
        {phone && searching ? searchPage : pageRows}
      </ScrollView>
    </View>
  );

  const body = ((): ReactElement => {
    switch (page) {
      case "profile": return <ProfilePage rows={rows} found={found} />;
      case "notifications": return <NotificationsPage rows={rows} found={found} />;
      case "models": return <ModelsPage rows={rows} found={found} />;
      case "connections": return <ConnectionsPage rows={rows} found={found} />;
      case "privacy": return <PrivacyPage rows={rows} found={found} />;
      case "signin": return <SignInPage />;
      case "appearance": return <AppearancePage rows={rows} found={found} />;
      case "keyboard": return <KeyboardPage rows={rows} found={found} />;
      case "computer": return <ComputerPage rows={rows} found={found} />;
      default: return <SpacesPage />;
    }
  })();

  const main = (
    <View style={n.main} testID={searching ? "page-search" : `page-${page}`} accessibilityLabel={searching ? "Search" : def.title}>
      <View style={n.head}>
        {phone ? <Pressable accessibilityRole="button" accessibilityLabel="Settings" testID="back" onPress={() => setView("nav")} style={[n.back, pointer]}><View style={{ transform: [{ rotate: "90deg" }] }}><Glyph name="chevD" size={14} color="var(--ink-2)" /></View></Pressable> : null}
        <Text accessibilityRole="header" aria-level={1} style={n.title}>{searching ? "Search" : def.title}</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={n.content}>
        <View style={n.column}>
          <SavedBar />
          {searching ? searchPage : list.status === "ready" ? body : <Text style={n.none} accessibilityRole="progressbar">Loading</Text>}
        </View>
      </ScrollView>
    </View>
  );
  return (
    <View style={n.frame} testID="settings-place">
      {phone ? (view === "nav" || searching ? nav : main) : (<>{nav}{main}</>)}
    </View>
  );
}

const n = StyleSheet.create({
  frame: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  nav: { width: 248, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  top: { height: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  space: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  searchWrap: { paddingHorizontal: 10, paddingBottom: 10 },
  search: { height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "var(--hover)" as string },
  searchInput: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  hint: { fontSize: 11.5, color: "var(--ink-4)" as string },
  scroll: { paddingHorizontal: 8, paddingBottom: 24 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 8, marginTop: 8 },
  groupTitle: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  count: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 14, marginBottom: 8, paddingHorizontal: 2 },
  hitCard: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  hitPage: { flexDirection: "row", alignItems: "center", gap: 4 },
  hitPageText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  none: { fontSize: 13, color: "var(--ink-3)" as string, padding: 14 },
  main: { flex: 1, minWidth: 0 },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  back: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  title: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  content: { paddingVertical: 20, paddingHorizontal: 20, alignItems: "center" },
  column: { width: "100%", maxWidth: 684 },
});
