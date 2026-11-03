// Ask about this note: Ask Vyre on the right of the grid (the grid stays). It opens the person's own Ask thread scoped to this note (chat.start kind ask, scope note:<id>, one per note,
// so asking again returns to it), never the chat open elsewhere in the shell. On top, the note it is about; then the conversation with its composer ("Ask about this note") and two
// follow-ups under the last answer; at the foot, whether Vyre may read this note here. The assistant reads the note itself with notes_get, which follows the note's audience.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { conversationData } from "../../../shell/providers/chats-data.ts";
import { findAssistant } from "../../../onboarding/AssistantThread.tsx";
import { addScreen, noteThreadKind } from "../../../shell/ask/screen.ts";
import { createComposerFill } from "../conversation/data.tsx";
import { Ico } from "./icons.tsx";
import { noteFill } from "./look.ts";
import { askWords, firstLine, noteName } from "./model.ts";
import type { Note } from "./model.ts";
import { Btn, IconBtn } from "./parts.tsx";

const ChatsConversation = lazy(() => import("../../../shell/providers/chats.tsx").then((m) => ({ default: m.ChatsConversation })));

/** The Ask thread of a note: one per person and note. */
export const askThreadKey = (meId: string, noteId: string): string => `note-ask-${meId}-${noteId}`;

export function NoteAsk({ rt, note, onClose, onOpen, onTask }: { rt: ShellRuntime; note: Note; onClose(): void; onOpen(): void; onTask(): void }): ReactElement {
  const [thread, setThread] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const name = noteName(note);
  useEffect(() => {
    let live = true;
    setThread(null);
    setError(false);
    void (async () => {
      const agentId = (await findAssistant(rt, rt.me.id)) ?? rt.assistant.id;
      const started = (await rt.call("chat.start", { kind: "ask", agentIds: [agentId], scopeType: "note", scopeId: note.noteId, title: name, idempotencyKey: askThreadKey(rt.me.id, note.noteId) })) as { thread: { threadId: string } };
      if (live) { noteThreadKind(started.thread.threadId, "ask"); setThread(started.thread.threadId); }
    })().catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [rt, note.noteId]);   // eslint-disable-line react-hooks/exhaustive-deps
  // what the assistant is told about where the person is: the note, by id and name, never its text
  useEffect(() => {
    addScreen({ title: `Notes, ${name}`, open: [{ type: "note", id: note.noteId, title: name }], actions: ["read the note with notes_get", "sum it up", "say what is still open", "draft a reply from it", "suggest a task"] });
  }, [note.noteId, name]);
  const fill = useMemo(() => createComposerFill(), [note.noteId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => {
    if (!thread) return null;
    const people = rt.principals.getSnapshot();
    const base = conversationData(rt, { openThread: (id) => rt.open({ subject: { type: "thread", id } }), togglePane: () => undefined, fillComposer: (t) => fill.set(t), openAgentChat: (id) => rt.open({ subject: { type: "agent", id } }) }, thread, people.status === "ready" ? people.data : [], fill);
    // the follow-ups under the last answer
    const tail = (
      <View style={s.follow} testID="notes-ask-follow">
        <Btn label="Turn into task" icon="task" sm onPress={() => onTask()} testID="notes-ask-task" />
        <Btn label="Draft a reply from this note" sm onPress={() => fill.set("Draft a reply from this note")} testID="notes-ask-draft" />
      </View>
    );
    return { ...base, placeholder: "Ask about this note", tail };
  }, [rt, thread, fill, onTask]);
  return (
    <SidePane paneKey="notes-ask" toggle={{ open: true, onPress: onClose }} title="Ask Vyre" tabs={[{ key: "ask", title: "Ask Vyre" }]} activeTab="ask" onCloseTab={() => onClose()} defaultWidth={380}>
      <View style={s.body} testID="notes-ask-body">
        <View style={s.about} testID="notes-ask-about">
          <View style={[s.aboutIcon, { backgroundColor: noteFill(note.color) }]}><Ico name="note" size={15} color="var(--ink-3)" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.aboutK}>About this note</Text>
            <Text numberOfLines={1} style={s.aboutT}>{name}</Text>
            {firstLine(note) ? <Text numberOfLines={1} style={s.aboutS}>{firstLine(note)}</Text> : null}
          </View>
          <IconBtn icon="note" label="Open the note" iconSize={14} onPress={() => onOpen()} testID="notes-ask-open" />
        </View>
        <View style={s.chat}>
          {error ? <Text testID="notes-ask-error" style={s.quiet}>I could not open the assistant. Check your AI account.</Text>
            : data ? <Suspense fallback={null}><ChatsConversation data={data} compact /></Suspense>
            : <Text style={s.quiet}>Opening your assistant</Text>}
        </View>
        <View style={s.vis} testID="notes-ask-vis">
          <Ico name="lock" size={12} color="var(--ink-3)" />
          <Text style={s.visText}>{askWords(note)}</Text>
        </View>
      </View>
    </SidePane>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, minHeight: 0, paddingTop: 6 },
  about: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginHorizontal: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  aboutIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  aboutK: { fontSize: 11.5, color: "var(--ink-4)" as string },
  aboutT: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string, marginTop: 1 },
  aboutS: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 2 },
  chat: { flex: 1, minHeight: 0, overflow: "hidden" },
  quiet: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
  follow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  vis: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 2 },
  visText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
});
