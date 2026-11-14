// "Notes & artifacts": one page with a switch, Notes and Artifacts, each the list it is today (design 13 Nov, 2.2). The switch is the shared Segmented; the page under it is the real one, so nothing is migrated and each keeps its own
// viewer, sharing and data. The tab used is remembered, and the sidebar's foot row opens it.
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { Segmented } from "../../../../../../ui/src/Segmented/index.tsx";
import { rememberNotesTab } from "../notes/notes-tab.ts";
import type { NotesTab } from "../notes/notes-tab.ts";

export function NotesArtifactsFrame({
  tab,
  onTab,
  remember,
  children,
}: {
  tab: NotesTab;
  onTab(t: NotesTab): void;
  /** Keep the tab in the person's state (the page owns the call). */
  remember?: ((t: NotesTab) => void) | undefined;
  children: ReactNode;
}): ReactElement {
  useEffect(() => (remember ? remember(tab) : rememberNotesTab(tab)), [tab]);
  return (
    <View testID="notes-artifacts" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
        <Segmented
          label="Notes or artifacts"
          testID="notes-artifacts-tabs"
          value={tab}
          onChange={onTab}
          options={[
            { id: "notes", label: "Notes" },
            { id: "artifacts", label: "Artifacts" },
          ]}
        />
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
    </View>
  );
}
