// Home > Quick start and the Ask box (spec 3.1): three quick-start buttons and one box that starts a chat with your assistant. It sits at the foot of the page. Without an AI account the box is locked and says how to unlock it. ui/Composer is the box, so @ # / and Enter work as they do in Chats.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { AskButton } from "../../../../../../ui/src/AskButton/index.tsx";
import type { AskAgent } from "../../../../../../ui/src/AskButton/index.tsx";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { useHomeData, useHomeLine, usePrincipals } from "../sections-a/data.tsx";
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

  // the agent that answers is picked in the pill beside the box (the shared AskButton), the Space assistant until another is picked
  const agents = useMemo<AskAgent[]>(() => {
    const list: AskAgent[] = [];
    for (const x of people.list) if (x.kind === "agent") list.push({ id: x.id, name: x.name, ...(x.id === assistant.id ? { assistant: true } : {}) });
    return list.some((x) => x.id === assistant.id) ? list : [{ id: assistant.id, name: assistant.name, assistant: true }, ...list];
  }, [people.list, assistant.id, assistant.name]);
  const [pickedId, setPickedId] = useState(assistant.id);
  const picked = agents.find((x) => x.id === pickedId) ?? agents[0] ?? { id: assistant.id, name: assistant.name, assistant: true };

  const send = (p: ComposerSend): void => {
    const text = askText(p.text);
    if (text === null) return;
    void startAsk({ call: data.call, note: line.note }, picked.id, text, data.clock().now).then((thread) => {
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
        <View style={local.pill}>
          {(
            <AskButton
              place="home"
              testID="ask-agent"
              context={{ kind: "home", id: "home", title: "Home", access: "use" }}
              agents={agents}
              suggested={assistant.id}
              onPick={(a) => setPickedId(a.id)}
              onAsk={(a) => data.nav.openSubject({ type: "agent", id: a.id })}
            />
          )}
        </View>
        <View style={local.box}>
          {locked ? (
            <Pressable accessibilityRole="button" accessibilityLabel={ASK_LOCKED} onPress={() => extras.go("ai")} testID="ask-locked" style={({ hovered }: { hovered?: boolean }) => [local.lock, hovered === true && local.lockOver]}>
              <Icon name="lock" size={14} />
              <Text style={local.lockText}>{ASK_LOCKED}</Text>
            </Pressable>
          ) : (
            <Composer
              testID="ask-box"
              whoWillAnswer={`${picked.name} will reply`}
              hideWho
              symbols={["at", "hash"]}
              placeholder={ASK_PLACEHOLDER}
              label="Ask your assistant"
              lead={picked.name}
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
  // docked: it stays at the foot of the place while the page scrolls under it, as the prototype draws it
  dock: { marginTop: 26, paddingTop: 6, paddingBottom: 6, ...(Platform.OS === "web" ? ({ position: "sticky", bottom: 0, zIndex: 4, backgroundColor: "var(--win)" } as unknown as ViewStyle) : {}) },
  quick: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 },
  quickTitle: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginRight: 8 },
  askRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  pill: { minHeight: 30, justifyContent: "center", paddingLeft: 4, paddingTop: 6 },
  box: { flex: 1, minWidth: 0 },
  lock: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  lockOver: { backgroundColor: "var(--hover)" as string },
  lockText: { fontSize: 13.5, color: "var(--ink-3)" as string },
});

/** The dock the page keeps at its foot (sticky on web); exported for the test. */
export const ASK_DOCK = local.dock;
