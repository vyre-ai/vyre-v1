// Home > Quick start and the Ask box (spec 3.1): three quick-start buttons and one box that starts a chat with your assistant. It sits at the foot of the page and stays
// in view while the sections scroll. Without an AI account the box is locked and says how to unlock it. ui/Composer is the box, so @ # / and Enter work as they do in Chats.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import { useHomeData, useHomeLine, usePrincipals } from "../sections-a/data.tsx";
import { Face } from "../sections-a/parts.tsx";
import { startAsk } from "./actions.ts";
import { useExtras } from "./data.tsx";
import { ASK_LOCKED, ASK_PLACEHOLDER, askText } from "./model.ts";
import { Icon, QuickButton } from "./parts.tsx";

export function AskBox(): ReactElement {
  const data = useHomeData();
  const extras = useExtras();
  const line = useHomeLine();
  const people = usePrincipals();
  const locked = !extras.aiConnected;
  const assistant = extras.assistant;

  const send = (p: ComposerSend): void => {
    const text = askText(p.text);
    if (text === null) return;
    void startAsk({ call: data.call, note: line.note }, assistant.id, text, data.clock().now).then((thread) => {
      if (thread !== null) data.nav.openSubject({ type: "thread", id: thread });
    });
  };

  return (
    <View testID="s-ask" accessibilityLabel="Quick start and Ask" style={local.dock}>
      <View style={local.quick} accessibilityRole="toolbar" accessibilityLabel="Quick start">
        <Text style={local.quickTitle}>Quick start</Text>
        <QuickButton label="New project" icon="record" testID="quick-project" onPress={() => extras.go("new_project")} />
        <QuickButton label="New record" icon="record" testID="quick-record" onPress={() => extras.go("new_record")} />
        <QuickButton label="Upload a file" icon="up" testID="quick-upload" onPress={() => extras.go("upload")} />
      </View>
      <View style={local.askRow}>
        <View style={local.face}><Face name={people.byId(assistant.id)?.name ?? assistant.name} kind="agent" size={22} /></View>
        <View style={local.box}>
          {locked ? (
            <Pressable accessibilityRole="button" accessibilityLabel={ASK_LOCKED} onPress={() => extras.go("ai")} testID="ask-locked" style={({ hovered }: { hovered?: boolean }) => [local.lock, hovered === true && local.lockOver]}>
              <Icon name="lock" size={14} />
              <Text style={local.lockText}>{ASK_LOCKED}</Text>
            </Pressable>
          ) : (
            <Composer
              testID="ask-box"
              whoWillAnswer={`${assistant.name} will reply`}
              placeholder={ASK_PLACEHOLDER}
              label="Ask your assistant"
              lead={assistant.name}
              density="compact"
              onSubmit={send}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  dock: { position: "sticky" as "relative", bottom: 0, marginTop: 26, paddingTop: 6, paddingBottom: 6, backgroundColor: "var(--win)" as string },
  quick: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 },
  quickTitle: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginRight: 8 },
  askRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  face: { height: 30, justifyContent: "center", paddingLeft: 4 },
  box: { flex: 1, minWidth: 0 },
  lock: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  lockOver: { backgroundColor: "var(--hover)" as string },
  lockText: { fontSize: 13.5, color: "var(--ink-3)" as string },
});
