// The Ask Vyre pane of Records: the shared SidePane on the right of the page, with a line about where the person is and the conversation (the shell hands it in as `children`). Closing it
// leaves the page as it was. Nothing here opens another place.
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { askHint } from "./model.ts";
import type { AskAbout } from "./model.ts";

export function AskPane({ about, onClose, children }: { about: AskAbout; onClose(): void; children?: ReactNode }): ReactElement {
  return (
    <SidePane paneKey="records-ask" toggle={{ open: true, onPress: onClose }} title="Ask Vyre" defaultWidth={380}>
      <View style={s.body} testID="records-ask-pane">
        <Text style={s.hint} testID="records-ask-hint">{askHint(about)}</Text>
        <View style={s.chat}>{children}</View>
      </View>
    </SidePane>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, minHeight: 0, gap: 8 },
  hint: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, paddingHorizontal: 12, paddingTop: 10 },
  chat: { flex: 1, minHeight: 0 },
});
