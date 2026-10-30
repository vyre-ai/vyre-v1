// The Teammates tab of a project (owner ruling 20 Oct 2026): the agents that work on this project and nowhere else, with the lead first. A teammate is made by asking: a name, a role and a line on
// when to use it, one tap. The lead is who answers first in a new chat of the project. Teammates are not on the Agents page; removing one made for this project moves it to Trash.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useProjectPageData } from "./data.tsx";
import { ROLE_WORDS } from "./model.ts";

type Teammates = CapMap["projects.teammates.list"]["out"];
type Role = "lead" | "member" | "reviewer";
const ROLES: readonly Role[] = ["lead", "member", "reviewer"];
const ROLE_NOTE: Readonly<Record<Role, string>> = { lead: "Answers first in a new chat of this project", member: "Does work on the project", reviewer: "Reads and checks; cannot change the project" };
const key = (): string => globalThis.crypto.randomUUID();

export function TeammatesTab({ projectId }: { projectId: string }): ReactElement {
  const d = useProjectPageData();
  const menu = useMenu();
  const [list, setList] = useState<Teammates | null>(null);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const read = useCallback(async (): Promise<void> => {
    try { setList((await d.call("projects.teammates.list", { projectId })) as Teammates); } catch { setNote("The teammates could not be read."); }
  }, [d, projectId]);
  useEffect(() => { void read(); }, [read]);
  const act = async (cap: string, input: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(true); setNote("");
    try { await d.call(cap, { ...input, idempotencyKey: key() }); setNote(done); await read(); return true; }
    catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); return false; }
    finally { setBusy(false); }
  };
  const rows = (list?.teammates ?? []).map((m) => (
    <Row key={m.agentId} id={`teammate:${m.agentId}`} title={m.name} note={`${ROLE_WORDS[m.role]}${m.roleLine ? ` · ${m.roleLine}` : ""} · ${m.status}`}
      leading={<View style={s.face}><Avatar name={m.name} kind="agent" /></View>}
      trailing={<Pressable accessibilityRole="button" accessibilityLabel={`Take ${m.name} off this project`} testID={`teammate-remove-${m.agentId}`} disabled={busy} onPress={() => void act("projects.teammates.remove", { projectId, agentId: m.agentId }, `${m.name} is off the project`)} style={s.text}><Text style={s.textLabel}>Remove</Text></Pressable>} />
  ));
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} testID="project-teammates">
      <Text style={s.lead}>Teammates are agents for this project. They live here, not on the Agents page. Ask for one with a name, a role and a line on when to use it.</Text>
      <View style={s.section}>
        <View style={s.sh}><Text accessibilityRole="header" style={s.h2}>Teammates</Text><Text style={s.count}>{list?.teammates.length ?? ""}</Text></View>
        {list === null ? <Text style={s.dim}>Loading…</Text> : rows.length > 0 ? rows : <Text style={s.dim} testID="teammates-none">No teammates yet. Add a lead to answer first in this project's chats.</Text>}
      </View>
      <View style={s.section}>
        <View style={s.sh}><Text accessibilityRole="header" style={s.h2}>Add a teammate</Text></View>
        <TextInput accessibilityLabel="Name" placeholder="Security reviewer" placeholderTextColor="var(--ink-4)" testID="teammate-name" value={name} onChangeText={setName} style={s.input} />
        <TextInput accessibilityLabel="Use this teammate when" placeholder="Checks every draft for privilege and confidentiality." placeholderTextColor="var(--ink-4)" testID="teammate-brief" value={brief} onChangeText={setBrief} style={s.input} />
        <Pressable accessibilityRole="button" accessibilityLabel="Role" testID="teammate-role" style={s.pick}
          onPress={(event) => {
            const target = event.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } };
            const rect = target.getBoundingClientRect?.();
            menu.show(ROLES.map((r) => ({ label: `${ROLE_WORDS[r]}: ${ROLE_NOTE[r]}`, checked: r === role, onSelect: () => setRole(r) })), rect?.left ?? event.nativeEvent.pageX, rect?.bottom ?? event.nativeEvent.pageY, "other");
          }}>
          <Text style={s.pickLabel}>{`${ROLE_WORDS[role]} · ${ROLE_NOTE[role]}`}</Text>
        </Pressable>
        {menu.element}
        <Pressable accessibilityRole="button" testID="teammate-add" disabled={busy || name.trim() === ""} onPress={() => void act("projects.teammates.create", { projectId, name: name.trim(), role, ...(brief.trim() ? { brief: brief.trim() } : {}) }, `${name.trim()} joined the project`).then((ok) => { if (ok) { setName(""); setBrief(""); } })}
          style={[s.open, (busy || name.trim() === "") && { opacity: 0.5 }]}><Text style={s.openText}>Add teammate</Text></Pressable>
      </View>
      {note ? <Text style={s.dim} accessibilityLiveRegion="polite" testID="teammates-note">{note}</Text> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  scrollIn: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, maxWidth: 860, gap: 10 },
  lead: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
  section: { marginTop: 10, gap: 8 },
  sh: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 4 },
  h2: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  face: { marginRight: 10 },
  input: { height: 34, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--raised)" as string },
  pick: { minHeight: 34, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7 },
  pickLabel: { fontSize: 13, color: "var(--ink)" as string },
  open: { alignSelf: "flex-start", height: 30, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, backgroundColor: "var(--accent-wash)" as string },
  openText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  text: { paddingHorizontal: 8, height: 28, justifyContent: "center" },
  textLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
