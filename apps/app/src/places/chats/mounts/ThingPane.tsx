// A thing named inside a chat (a file, a record) opens in the right pane beside the chat, so the person looks at it without leaving the conversation (owner, 15 Nov 2026; TABS-2026-11-15.md D3 and D4).
// The pane has one facet, Details (the thing's own page); "Open as a tab" in its head takes the thing to a tab; pressing a second thing replaces this one, and Back in the pane returns to the first.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { FileDetail } from "../../../shell/providers/file-detail.tsx";
import { RecordDetail } from "../../../shell/providers/record-detail.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { TextButton } from "../conversation/parts.tsx";
import type { Thing } from "./thing-model.ts";

export function ThingPane({
  rt,
  trail,
  onBack,
  onClose,
  onOpenTab,
  narrow,
}: {
  rt: ShellRuntime;
  trail: readonly Thing[];
  onBack: () => void;
  onClose: () => void;
  onOpenTab: (t: Thing) => void;
  narrow: boolean;
}): ReactElement | null {
  const now = trail[trail.length - 1];
  if (now === undefined) return null;
  const title = now.type === "file" ? "File" : "Record";
  return (
    <View testID="chats-thing-pane" style={narrow ? st.full : st.pane}>
      <SidePane
        paneKey="chats-thing-pane"
        toggle={{ open: true, onPress: onClose }}
        title={title}
        tabs={[{ key: "details", title: "Details" }]}
        activeTab="details"
        onCloseTab={onClose}
        defaultWidth={460}
        actions={
          <>
            {trail.length > 1 ? <TextButton link label="Back" testID="thing-pane-back" onPress={onBack} /> : null}
            <TextButton link label="Open as a tab" testID="thing-pane-open-tab" onPress={() => onOpenTab(now)} />
          </>
        }
      >
        {now.type === "file" ? (
          <FileDetail key={now.id} rt={rt} fileId={now.id} />
        ) : (
          <RecordDetail key={now.id} rt={rt} recordId={now.id} />
        )}
      </SidePane>
    </View>
  );
}

const st = StyleSheet.create({
  pane: { minHeight: 0 },
  full: { flex: 1, minHeight: 0 },
});
