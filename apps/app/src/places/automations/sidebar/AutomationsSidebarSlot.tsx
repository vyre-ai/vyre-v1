// Registers the Automations list in the shell sidebar slot. The slot supplies search, collapse, and the phone list.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { SidebarContent } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { SIDEBAR, useScreenQuery } from "../canvas/data.tsx";
import { needsBadge } from "../chrome.ts";
import { STUDIO_NAV } from "../chrome.ts";
import type { StudioView } from "../chrome.ts";
import { needsYou } from "./model.ts";
import { AutomationsSidebar } from "./AutomationsSidebar.tsx";

export type { StudioView };

type ListOut = CapMap["automations.list"]["out"];

function Nav({ view, onView, slot }: { view: StudioView; onView(next: StudioView): void; slot: SidebarSlotApi }): ReactElement {
  const list = useScreenQuery<ListOut>(SIDEBAR, "automations", {});
  const badge = needsBadge(list.status === "ready" ? list.data.automations.filter(needsYou).length : null);
  const choose = (next: StudioView): void => { onView(next); slot.openBody(); };
  return (
    <View testID="studio-nav" style={n.nav}>
      {STUDIO_NAV.map((item) => (
        <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: view === item.id }} testID={`nav-${item.id}`} onPress={() => choose(item.id)} style={n.row}>
          <Text style={[n.text, view === item.id && n.on]}>{item.label}</Text>
          {item.id === "needs" && badge ? <Text testID="nav-needs-count" style={n.count}>{badge}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function AutomationsSidebarSlot({ selectedId, view, onView }: { selectedId: string | null; view: StudioView; onView(next: StudioView): void }): ReactElement {
  return (
    <SidebarContent title="Automations" searchPlaceholder="Search automations">
      {(query, slot) => (
        <View style={n.fill}>
          <Nav view={view} onView={onView} slot={slot} />
          <AutomationsSidebar selectedId={selectedId} hosted query={query} onChoose={() => { onView("automations"); slot.openBody(); }} />
        </View>
      )}
    </SidebarContent>
  );
}

const n = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  nav: { paddingHorizontal: 8, paddingTop: 6, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7 },
  text: { fontSize: 13, color: "var(--ink-2)" as string },
  on: { color: "var(--ink)" as string, fontWeight: "600" },
  count: { fontSize: 11, fontWeight: "600", color: "var(--ink-2)" as string, backgroundColor: "var(--hover)" as string, borderRadius: 8, paddingHorizontal: 6, overflow: "hidden" },
});
