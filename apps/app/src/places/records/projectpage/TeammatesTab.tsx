// The Teammates tab of a project (owner ruling 20 Oct 2026): the agents that work on this project and nowhere else, with the lead first. A teammate is added from the one Add people and agents sheet (an agent of the Space, or New agent for this project: a name, a line on
// when to use it and a model). The lead is who answers first in a new chat of the project. Teammates are not on the Agents page; removing one made for this project moves it to Trash.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

export function TeammatesTab({ projectId, refresh = 0, onAdd }: { projectId: string; /** Counts each time the sheet added someone: the list reads again. */ refresh?: number; onAdd(): void }): ReactElement {
  const d = useProjectPageData();
  const [list, setList] = useState<Teammates | null>(null);
  const menu = useMenu();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const read = useCallback(async (): Promise<void> => {
    try { setList((await d.call("projects.teammates.list", { projectId })) as Teammates); } catch { setNote("The teammates could not be read."); }
  }, [d, projectId]);
  useEffect(() => { void read(); }, [read, refresh]);
  const remove = async (agentId: string, name: string): Promise<void> => {
    setBusy(true); setNote("");
    try { await d.call("projects.teammates.remove", { projectId, agentId, idempotencyKey: key() }); setNote(`${name} is off the project`); await read(); }
    catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); }
    finally { setBusy(false); }
  };
  // who answers first is chosen here; adding is the sheet, which adds a Member
  const setRole = async (agentId: string, name: string, role: Role): Promise<void> => {
    setBusy(true); setNote("");
    try { await d.call("projects.members.set", { projectId, principal: agentId, role, idempotencyKey: key() }); setNote(`${name} is now ${ROLE_WORDS[role].toLowerCase()}`); await read(); }
    catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); }
    finally { setBusy(false); }
  };
  const rows = (list?.teammates ?? []).map((m) => (
    <Row key={m.agentId} id={`teammate:${m.agentId}`} title={m.name} note={`${ROLE_WORDS[m.role]}${m.roleLine ? ` · ${m.roleLine}` : ""} · ${m.status}`}
      leading={<View style={s.face}><Avatar name={m.name} kind="agent" /></View>}
      trailing={<>
        <Pressable accessibilityRole="button" accessibilityLabel={`Role of ${m.name}`} testID={`teammate-role-${m.agentId}`} disabled={busy}
          onPress={(event) => {
            const target = event.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } };
            const rect = target.getBoundingClientRect?.();
            menu.show(ROLES.map((r) => ({ label: `${ROLE_WORDS[r]}: ${ROLE_NOTE[r]}`, checked: r === m.role, onSelect: () => void setRole(m.agentId, m.name, r) })), rect?.left ?? event.nativeEvent.pageX, rect?.bottom ?? event.nativeEvent.pageY, "other");
          }} style={s.text}><Text style={s.textLabel}>Role</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Take ${m.name} off this project`} testID={`teammate-remove-${m.agentId}`} disabled={busy} onPress={() => void remove(m.agentId, m.name)} style={s.text}><Text style={s.textLabel}>Remove</Text></Pressable>
      </>} />
  ));
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} testID="project-teammates">
      <Text style={s.lead}>Teammates are agents for this project. They live here, not on the Agents page. Add one from your agents, or make a new one for this project.</Text>
      <View style={s.section}>
        <View style={s.sh}><Text accessibilityRole="header" style={s.h2}>Teammates</Text><Text style={s.count}>{list?.teammates.length ?? ""}</Text></View>
        {list === null ? <Text style={s.dim}>Loading…</Text> : rows.length > 0 ? rows : <Text style={s.dim} testID="teammates-none">No teammates yet. Add a lead to answer first in this project's chats.</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Add people and agents" testID="teammate-add" onPress={onAdd} style={s.open}><Text style={s.openText}>Add people and agents</Text></Pressable>
      </View>
      {note ? <Text style={s.dim} accessibilityLiveRegion="polite" testID="teammates-note">{note}</Text> : null}
      {menu.element}
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
  open: { alignSelf: "flex-start", height: 30, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, backgroundColor: "var(--accent-wash)" as string },
  openText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  text: { paddingHorizontal: 8, height: 28, justifyContent: "center" },
  textLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
