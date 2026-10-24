// Mount for P-L9_03: the shared Menu (open, ending in Report a problem), a main pane with its tab strip and far-left
// toggle, and a side pane with the same strip and its own toggle. Every control works: click, right-click, keyboard, drag.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, Dimensions } from "react-native";
import type { ReactNode } from "react";
import { menuTrigger, useMenu } from "../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../ui/src/Menu/index.tsx";
import { Pane, SidePane } from "../../../ui/src/SidePane/index.tsx";
import type { PaneTab } from "../../../ui/src/SidePane/index.tsx";

export const title = "Menu, tabs and panes";

const FIRST_TABS: PaneTab[] = [
  { key: "sync", title: "Weekly sync", icon: "star" },
  { key: "launch", title: "Launch checklist" },
  { key: "inbox", title: "Inbox review" },
];

const SIDE_TABS: PaneTab[] = [
  { key: "details", title: "Details", icon: "eye", pinned: true },
  { key: "history", title: "History", icon: "clock" },
  { key: "ask", title: "Ask Elena", icon: "search" },
];

const NOTES = ["Northwind, 3 people", "Updated yesterday", "12 unread", "Draft, not sent"];

function contextItems(title: string): MenuEntry[] {
  return [
    { label: "Open", icon: "open" },
    { label: "Open in New Tab", icon: "plus" },
    { label: "Copy Link", icon: "link" },
    { separator: true },
    { label: `Star ${title}`, icon: "star", checked: true },
    { label: "Delete", icon: "trash", danger: true },
  ];
}

export default function Mount(): ReactNode {
  const [tabs, setTabs] = useState(FIRST_TABS);
  const [active, setActive] = useState("launch");
  const [sideTabs, setSideTabs] = useState(SIDE_TABS);
  const [sideActive, setSideActive] = useState("history");
  const [side, setSide] = useState(true);
  const { element, show } = useMenu();
  const [narrow, setNarrow] = useState(false);
  useEffect(() => setNarrow(Dimensions.get("window").width < 700), []);

  useEffect(() => {
    show(contextItems("Launch checklist"), 150, 196, "context", { label: "Launch checklist" });
  }, [show]);

  const rows: ReactNode[] = [];
  for (let i = 0; i < NOTES.length; i++) {
    const name = tabs[i]?.title ?? "Untitled";
    rows.push(
      <Pressable key={name + i} style={styles.row} {...menuTrigger((x, y) => show(contextItems(name), x, y, "context", { label: name }))}>
        <Text style={styles.rowTitle}>{name}</Text>
        <Text style={styles.rowNote}>{NOTES[i]}</Text>
      </Pressable>,
    );
  }

  return (
    <View style={styles.page}>
      <View style={narrow ? styles.gone : styles.main}>
        <Pane
          toggle={{ open: side, onPress: () => setSide(!side) }}
          title="Documents"
          tabs={tabs}
          activeTab={active}
          onSelectTab={setActive}
          onCloseTab={(key) => setTabs((list) => list.filter((t) => t.key !== key))}
          onReorderTabs={(keys) => setTabs((list) => keys.flatMap((k) => list.filter((t) => t.key === k)))}
          onPlus={() => setTabs((list) => [...list, { key: `new${list.length}`, title: "New tab" }])}
          plusTitle="Open anything"
          tabMenu={() => [{ label: "Pin Tab", icon: "star" }]}
        >
          <View style={styles.rows}>{rows}</View>
        </Pane>
      </View>
      <SidePane
        paneKey="mount-P-L9_03"
        toggle={{ open: side, onPress: () => setSide(!side) }}
        title="Details"
        tabs={sideTabs}
        activeTab={sideActive}
        onSelectTab={setSideActive}
        onCloseTab={(key) => setSideTabs((list) => list.filter((t) => t.key !== key))}
      >
        <Text style={styles.body}>History of Launch checklist</Text>
      </SidePane>
      {element}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0 },
  gone: { width: 0, overflow: "hidden" },
  rows: { paddingTop: 8 },
  row: { height: 44, justifyContent: "center", paddingHorizontal: 16 },
  rowTitle: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 18 },
  rowNote: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16 },
  body: { color: "var(--ink-3)" as string, fontSize: 12.5, padding: 16 },
});
