// Registers the Automations list in the shell sidebar slot. The slot supplies search, collapse, and the phone list.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SidebarContent } from "../../../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { AutomationsSidebar } from "./AutomationsSidebar.tsx";

export type StudioView = "automations" | "needs" | "runs" | "events" | "dependencies" | "packages";

const VIEWS: readonly { id: Exclude<StudioView, "automations">; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "runs", label: "All runs" },
  { id: "events", label: "Live Event Explorer" },
  { id: "dependencies", label: "Dependencies" },
  { id: "packages", label: "Packages" },
];

function Nav({ view, onView, slot }: { view: StudioView; onView(next: StudioView): void; slot: SidebarSlotApi }): ReactElement {
  const choose = (next: StudioView): void => { onView(next); slot.openBody(); };
  return (
    <View testID="studio-nav" style={n.nav}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: view === "automations" }} testID="nav-automations" onPress={() => choose("automations")} style={n.row}>
        <Text style={[n.text, view === "automations" && n.on]}>Automations</Text>
      </Pressable>
      {VIEWS.map((item) => (
        <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: view === item.id }} testID={`nav-${item.id}`} onPress={() => choose(item.id)} style={n.row}>
          <Text style={[n.text, view === item.id && n.on]}>{item.label}</Text>
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
  row: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7 },
  text: { fontSize: 13, color: "var(--ink-2)" as string },
  on: { color: "var(--ink)" as string, fontWeight: "600" },
});
