// Home > Quick start and the Ask box (spec 3.1): three quick-start buttons and one box that starts a chat with your assistant. It sits at the foot of the page. Without an AI account the box is locked and says how to unlock it. ui/Composer is the box, so @ # / and Enter work as they do in Chats.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { AskButton } from "../../../../../../ui/src/AskButton/index.tsx";
import type { AskAgent } from "../../../../../../ui/src/AskButton/index.tsx";
import { mentionsIn } from "../../chats/conversation/model.ts";
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
  const narrow = useWindowDimensions().width < 520;
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
    // what the composer holds beyond the words travels with them: @names become mentions and # links become refs, as in Chats. Files cannot be sent from here, so the person is told, never left to think they went.
    const mentions = mentionsIn(p.text, people.list.filter((x) => (x.kind === "person" || x.kind === "agent") && x.id !== data.me.id).map((x) => ({ id: x.id, name: x.name, kind: x.kind as "person" | "agent" })));
    const refs = [...p.refs, ...p.chips.flatMap((c) => (c.id !== undefined ? [{ kind: c.kind.toLowerCase(), id: c.id, title: c.name }] : []))];
    void startAsk({ call: data.call, note: line.note }, picked.id, text, data.clock().now, { mentions, refs }).then((thread) => {
      if (thread === null) return;
      if (p.files.length > 0) line.note("Your files were not sent from Home. Add them in the chat.", () => undefined);
      data.nav.openSubject({ type: "thread", id: thread });
    });
  };

  return (
    <View testID="s-ask" accessibilityLabel="Quick start and Ask" style={local.dock}>
      <View style={local.quick} accessibilityRole="toolbar" accessibilityLabel="Quick start">
        {narrow ? null : <Text style={local.quickTitle}>Quick start</Text>}
        <QuickButton label="New project" icon="record" testID="quick-project" onPress={() => extras.go("new_project")} />
        <QuickButton label="New record" icon="record" testID="quick-record" onPress={() => extras.go("new_record")} />
        <QuickButton label={narrow ? "Upload" : "Upload a file"} icon="up" testID="quick-upload" onPress={() => extras.go("upload")} />
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
          {locked ? (
            <Pressable accessibilityRole="button" accessibilityLabel={ASK_LOCKED} onPress={() => extras.go("ai")} testID="ask-locked" style={({ hovered }: { hovered?: boolean }) => [local.connect, hovered === true && local.lockOver]}>
              <Icon name="lock" size={12} />
              <Text style={local.lockText}>{ASK_LOCKED}</Text>
            </Pressable>
          ) : null}
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
  lockText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  connect: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
});

/** The dock the page keeps at its foot (sticky on web); exported for the test. */
export const ASK_DOCK = local.dock;
