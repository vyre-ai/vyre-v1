// Registers the Automations list in the shell sidebar slot. The slot supplies search, collapse, and the phone list. One list: its head returns to the first page and carries the count of what needs him.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { SidebarContent } from "../../../shell/sidebar/index.ts";
import { SIDEBAR, useScreenQuery } from "../canvas/data.tsx";
import { needsBadge } from "../chrome.ts";
import type { StudioView } from "../chrome.ts";
import { needsYou } from "./model.ts";
import { AutomationsSidebar } from "./AutomationsSidebar.tsx";

export type { StudioView };

type ListOut = CapMap["automations.list"]["out"];

/** The list's head: "Automations" returns to the first page; the count is what needs him, from the same list. */
export function ListHead({ onHome }: { onHome?: () => void }): ReactElement {
  const list = useScreenQuery<ListOut>(SIDEBAR, "automations", {});
  const badge = needsBadge(list.status === "ready" ? list.data.automations.filter(needsYou).length : null);
  return (
    <Pressable testID="automations-home" accessibilityRole="button" onPress={onHome} style={n.head}>
      <Text style={n.title}>Automations</Text>
      {badge ? (
        <Text testID="nav-needs-count" style={n.count}>
          {badge}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function AutomationsSidebarSlot({
  selectedId,
  onView,
  onHome,
}: {
  selectedId: string | null;
  onView(next: StudioView): void;
  onHome?: () => void;
}): ReactElement {
  return (
    <SidebarContent title="Automations" searchPlaceholder="Search automations">
      {(query, slot) => (
        <View style={n.fill}>
          <ListHead
            onHome={() => {
              onHome?.();
              onView("automations");
              slot.openBody();
            }}
          />
          <AutomationsSidebar
            selectedId={selectedId}
            hosted
            query={query}
            onChoose={() => {
              onView("automations");
              slot.openBody();
            }}
          />
        </View>
      )}
    </SidebarContent>
  );
}

const n = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 36 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  count: {
    fontSize: 11,
    fontWeight: "600",
    color: "var(--accent)" as string,
    backgroundColor: "var(--accent-wash)" as string,
    borderRadius: 8,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
});
