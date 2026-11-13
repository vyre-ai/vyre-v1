// A chat the person has just started, drawn before the server has answered (budget: his own words on screen within 100 ms of the key press, on any network). Nothing about showing what he wrote needs the
// server: his message, the title the tab takes, the agent's working mark. If the start fails he sees it here, with Retry, and his words stay. The real conversation takes the place of this one when it has loaded.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { pendingFor } from "./pending.ts";

export interface PendingChatProps {
  title: string;
  text: string;
  /** Names of files that go with the message. */
  files: readonly string[];
  /** Who will answer. */
  lead: string;
  phase: "sending" | "failed";
  /** What went wrong, in plain words (failed only). */
  note?: string;
  onRetry?: () => void;
  onDiscard?: () => void;
}

export function PendingChat({ title, text, files, lead, phase, note, onRetry, onDiscard }: PendingChatProps): ReactElement {
  return (
    <View testID="landing-pending" accessibilityLabel={`Starting ${title}`} style={st.root}>
      <View style={st.head}><Text numberOfLines={1} testID="landing-pending-title" style={st.title}>{title}</Text></View>
      <View style={st.feed}>
        <View style={st.me}>
          <View testID="msg-pending" accessibilityLabel="You" style={[st.bubble, phase === "failed" && st.bubbleFailed]}>
            {text.trim() !== "" ? <Text style={st.bubbleText}>{text}</Text> : null}
            {files.length > 0 ? <Text style={st.files}>{files.join(", ")}</Text> : null}
          </View>
        </View>
        {phase === "failed" ? (
          <View testID="landing-failed" accessibilityRole="alert" style={st.failed}>
            <Text style={st.failedText}>{note ?? "Could not start the chat."}</Text>
            <Pressable role="button" aria-label="Retry" testID="landing-retry" onPress={onRetry} style={st.link}><Text style={st.linkText}>Retry</Text></Pressable>
            <Pressable role="button" aria-label="Discard" testID="landing-discard" onPress={onDiscard} style={st.link}><Text style={st.linkText}>Discard</Text></Pressable>
          </View>
        ) : (
          <View testID="landing-working" style={st.working}>
            <WorkingMark state="thinking" size={20} testID="working-mark" />
            <Text style={st.workingText}>{lead === "" ? "Thinking" : `${lead} is thinking`}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** The chat that is opening, before its own messages have loaded: his first message, when this window sent it. Null for any chat this window did not just start. */
export function PendingOpening({ threadId, lead }: { threadId: string; lead?: string }): ReactElement | null {
  const p = pendingFor(threadId);
  return p ? <PendingChat title={p.title} text={p.text} files={p.files} lead={lead ?? p.lead} phase="sending" /> : null;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 10 },
  title: { flexShrink: 1, minWidth: 40, maxWidth: 320, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  feed: { flex: 1, minHeight: 0, width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 20, paddingTop: 16, gap: 14 },
  me: { alignItems: "flex-end" },
  bubble: { maxWidth: "85%", backgroundColor: "var(--me)" as string, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, gap: 4 },
  bubbleFailed: { opacity: 0.7 },
  bubbleText: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 22 },
  files: { fontSize: 12.5, color: "var(--ink-3)" as string },
  working: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  workingText: { fontSize: 13, color: "var(--ink-2)" as string },
  failed: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 10, flexWrap: "wrap" },
  failedText: { fontSize: 12.5, color: "var(--danger)" as string },
  link: { paddingVertical: 2 },
  linkText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
