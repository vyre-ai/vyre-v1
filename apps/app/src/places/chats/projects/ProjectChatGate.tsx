// What a project's Chat tab says to someone who may see the project but is not in its (invite-only) chat, a Space admin for one. A calm line, no error and no Retry. A Space admin may join: the button gives
// them the Member role on the project (projects.members.set, which the host writes the grants for), and the chat opens. Anyone else is told who can add them.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function ProjectChatGate({ projectId, me, admin, call, onJoined }: { projectId: string; me: string; admin: boolean; call(cap: string, input: unknown): Promise<unknown>; onJoined(): void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const join = async (): Promise<void> => {
    setBusy(true); setNote("");
    try { await call("projects.members.set", { projectId, principal: me, role: "member", idempotencyKey: globalThis.crypto.randomUUID() }); onJoined(); }
    catch (e) { setNote(e instanceof Error && e.message ? e.message : "That did not work."); setBusy(false); }
  };
  return (
    <View testID="project-chat-gate" style={st.box}>
      <Text accessibilityRole="header" style={st.title}>{"You're not in this project's chat"}</Text>
      {admin ? (
        <>
          <Text style={st.line}>As an admin you can join it. You become a Member of the project.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Join chat" testID="project-chat-join" disabled={busy} onPress={() => void join()} style={st.btn}><Text style={st.btnText}>Join chat</Text></Pressable>
        </>
      ) : <Text testID="project-chat-ask" style={st.line}>{"The project's Lead can add you."}</Text>}
      {note ? <Text testID="project-chat-note" accessibilityLiveRegion="polite" style={st.line}>{note}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 13, lineHeight: 19, color: "var(--ink-3)" as string, textAlign: "center" },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 8, justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--accent)" as string },
});
