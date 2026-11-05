// What a project's chat shows before anyone has said anything: the start of the channel, the project's goal, who is in it and which of them are agents. The project page hands it to the chat
// through the frame store (chats/conversation/frame.ts), so the chat draws it where it would draw "Say something to start".
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";

export interface IntroPerson { id: string; name: string; kind: "person" | "agent" | "group"; role: string }

/** "Lead", "Member": the words under a name. */
export function introPeople(people: readonly { principal: string; role: string; kind?: string }[], nameOf: (id: string) => string, roleWords: Readonly<Record<string, string>>): IntroPerson[] {
  const seen = new Set<string>();
  const out: IntroPerson[] = [];
  for (const m of people) {
    if (seen.has(m.principal)) continue;
    seen.add(m.principal);
    out.push({ id: m.principal, name: nameOf(m.principal), kind: m.kind === "agent" ? "agent" : m.kind === "group" ? "group" : "person", role: roleWords[m.role] ?? m.role });
  }
  return out;
}

export function ProjectIntro({ title, goal, people }: { title: string; goal: string | undefined; people: readonly IntroPerson[] }): ReactElement {
  const humans = people.filter((p) => p.kind !== "agent");
  const agents = people.filter((p) => p.kind === "agent");
  return (
    <View testID="project-intro" style={st.root}>
      <Text accessibilityRole="header" style={st.title}>{`This is the start of ${title}`}</Text>
      {goal ? <Text testID="project-intro-goal" style={st.goal}>{goal}</Text> : <Text style={st.dim}>No goal written yet. The Overview tab is where it goes.</Text>}
      {humans.length > 0 ? <Group testID="project-intro-people" label="In this project" list={humans} /> : null}
      {agents.length > 0 ? <Group testID="project-intro-agents" label="Agents" list={agents} /> : null}
      <Text style={st.dim}>Say something to start.</Text>
    </View>
  );
}

function Group({ label, list, testID }: { label: string; list: readonly IntroPerson[]; testID: string }): ReactElement {
  return (
    <View testID={testID} style={st.group}>
      <Text style={st.label}>{label}</Text>
      <View style={st.wrap}>
        {/* ui-rows-lint: not a list (people laid side by side in a wrapping row) */}
        {list.map((p) => (
          <View key={p.id} style={st.person}><Avatar name={p.name} seedId={p.id} kind={p.kind === "agent" ? "agent" : "person"} size={22} /><Text style={st.name}>{p.name}</Text><Text style={st.role}>{p.role}</Text></View>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { gap: 10, paddingVertical: 32, paddingHorizontal: 4, maxWidth: 560, alignSelf: "center", width: "100%" },
  title: { color: "var(--ink)" as string, fontSize: 20, lineHeight: 26, fontWeight: "600" },
  goal: { color: "var(--ink-2)" as string, fontSize: 14.5, lineHeight: 21 },
  dim: { color: "var(--ink-3)" as string, fontSize: 13, lineHeight: 19 },
  group: { gap: 6, marginTop: 6 },
  label: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  person: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3, paddingLeft: 3, paddingRight: 10, borderRadius: 14, backgroundColor: "var(--sunk)" as string },
  name: { color: "var(--ink)" as string, fontSize: 13 },
  role: { color: "var(--ink-3)" as string, fontSize: 12 },
});
