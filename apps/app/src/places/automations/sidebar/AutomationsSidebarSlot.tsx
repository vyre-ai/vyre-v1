// Registers the Automations list in the shell sidebar slot. The slot supplies search, collapse, and the phone list. One list: its head returns to the first page and carries the count of what needs him.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { SidebarContent } from "../../../shell/sidebar/index.ts";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { needsBadge } from "../chrome.ts";
import type { StudioView } from "../chrome.ts";
import { needsYou } from "./model.ts";
import { AutomationsList } from "./AutomationsList.tsx";

export type { StudioView };

type ListOut = CapMap["automations.list"]["out"];

/** The list's head: "Automations" returns to the first page; the count is what needs him, from the same list. */
export function ListHead({ onHome }: { onHome?: () => void }): ReactElement {
  const data = useAutomationsData();
  const list = useScreenQuery<ListOut>(SIDEBAR, "automations", {});
  const badge = needsBadge(list.status === "ready" ? list.data.automations.filter(needsYou).length : null);
  // the shell's own title already says Automations: this row says only what needs him (round four: the word is not said twice), and returns to the first page
  return (
    <Pressable testID="automations-home" accessibilityRole="button" onPress={onHome} style={n.head}>
      {badge ? (
        <>
          <Text style={n.title}>Needs you</Text>
          <Text testID="nav-needs-count" style={n.count}>
            {badge}
          </Text>
        </>
      ) : (
        <Text style={n.title}>Home</Text>
      )}
      <View style={{ flex: 1 }} />
      <Pressable
        testID="al-new"
        accessibilityRole="button"
        accessibilityLabel="New automation"
        onPress={() =>
          void data.call("automations.create", { name: "New automation" }).then(
            (out) => {
              const id = (out as { automation?: { id?: string } })?.automation?.id;
              if (id) data.nav.openAutomation(id);
            },
            () => undefined,
          )
        }
      >
        <Text style={n.plus}>+</Text>
      </Pressable>
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
          <AutomationsList
            selectedId={selectedId}
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
  plus: { fontSize: 20, color: "var(--ink-2)" as string, paddingHorizontal: 6 },
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
