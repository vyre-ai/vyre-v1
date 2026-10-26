// You (spec 3.11): who you are in this Space, then My work, Starred and Settings. Rows are the shared ui/Row with a chevron; each one opens its screen through the shell's history,
// so Back returns here.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Icon } from "./icons.tsx";
import type { MobileIcon } from "./icons.tsx";
import type { MobileNav } from "./MobileShell.tsx";

export interface YouData {
  name: string;
  space: string;
  workOpen: number;
  starred: number;
}

export function YouScreen({ data, nav }: { data: YouData; nav: MobileNav }): ReactElement {
  const rows: { key: string; title: string; note: string; icon: MobileIcon }[] = [
    { key: "my-work", title: "My work", note: data.workOpen === 0 ? "All caught up" : `${data.workOpen} open`, icon: "work" },
    { key: "starred", title: "Starred", note: data.starred === 0 ? "Nothing starred" : `${data.starred} starred`, icon: "star" },
    { key: "settings", title: "Settings", note: "Profile, appearance, notifications", icon: "settings" },
  ];
  const list: ReactElement[] = [];
  for (const r of rows) {
    list.push(
      <Row
        key={r.key} id={`you-${r.key}`} title={r.title} note={r.note}
        leading={<View style={st.lead}><Icon name={r.icon} size={18} /></View>}
        trailing={<Icon name="chev" size={14} color="var(--ink-4)" />}
        onPress={() => nav.open({ tab: "you", screen: `you:${r.key}`, title: r.title })}
      />,
    );
  }
  return (
    <View testID="you-screen" style={st.root}>
      <View style={st.head}>
        <Avatar name={data.name} kind="person" size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" aria-level={1} style={st.name}>{data.name}</Text>
          <Text style={st.sub}>{data.space}</Text>
        </View>
      </View>
      <View style={st.list}>{list}</View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 20, paddingHorizontal: 4 },
  name: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 13, color: "var(--ink-3)" as string, marginTop: 2 },
  list: { borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden", padding: 4 },
  lead: { width: 24, alignItems: "center" },
});
