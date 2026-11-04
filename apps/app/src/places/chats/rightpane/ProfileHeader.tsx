// The one header of a profile pane, for a person and for an agent: the face with a presence dot, the name, one role line that opens to the full text when pressed, the quiet icon row of what can be done
// (only what the shell can do is passed, so no button is drawn that does nothing), and one "..." menu. Both ChatRightPane (the agent of the open chat) and ProfilePane (anyone's profile tab) draw it.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Icon, Tool } from "./parts.tsx";
import type { IconName } from "./parts.tsx";

export type Presence = "on" | "away" | "asleep";
export interface HeaderAction { key: string; icon: IconName; label: string; onPress(): void; hint?: string }

const PRESENCE: Record<Presence, { color: string; word: string }> = {
  on: { color: "var(--ok)", word: "Online" },
  away: { color: "var(--warn)", word: "Away" },
  asleep: { color: "var(--ink-4)", word: "Asleep" },
};

/** "Agent · runs the nightly builds": the kind, then the role with its first letter lowered. A person's line is passed whole. */
export const roleLine = (kind: string, role: string | undefined): string => (role ? `${kind} · ${role.charAt(0).toLowerCase()}${role.slice(1)}` : kind);

export function ProfileHeader({ name, seedId, kind, presence, pulse = false, line, actions, onMore, testID = "pane-agent" }: {
  name: string; seedId?: string | undefined; kind: "agent" | "assistant" | "person"; presence?: Presence; pulse?: boolean; line: string; actions: readonly HeaderAction[]; onMore?: (x: number, y: number) => void; testID?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const p = presence ? PRESENCE[presence] : null;
  return (
    <View testID={testID} style={st.root}>
      <View style={st.top}>
        <View aria-hidden testID={`face-${name}`} style={st.face}>
          <Avatar name={name} seedId={seedId} kind={kind === "person" ? "person" : "agent"} size={44} {...(pulse ? { state: "working" as const } : {})} />
          {p ? <View testID="presence" accessibilityLabel={p.word} style={[st.dot, { backgroundColor: p.color as string }]} /> : null}
        </View>
        <View style={st.text}>
          <Text numberOfLines={1} style={st.name}>{name}</Text>
          <Pressable role="button" accessibilityRole="button" accessibilityLabel={open ? "Show less" : "Show more"} aria-expanded={open} testID="profile-line" onPress={() => setOpen(!open)} style={st.lineBox}>
            <Text numberOfLines={open ? undefined : 1} style={st.line}>{line}</Text>
            <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], marginTop: 3 }}><Icon name="chev" size={11} color="var(--ink-3)" /></View>
          </Pressable>
        </View>
      </View>
      {actions.length > 0 || onMore ? (
        <View testID="profile-actions" style={st.acts}>
          {/* ui-rows-lint: not a list (the profile's action buttons in a row) */}
          {actions.map((a) => (
            <Act key={a.key} a={a} />
          ))}
          <View style={st.grow} />
          {onMore ? <Tool icon="more" label="More" onPress={onMore} testID="pane-more" /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** A quiet action: icon and label, no box until the pointer is over it. */
function Act({ a }: { a: HeaderAction }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable role="button" accessibilityRole="button" accessibilityLabel={a.hint ?? a.label} testID={`profile-${a.key}`} onPress={a.onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} style={[st.act, over && st.actOver]}>
      <Icon name={a.icon} size={15} color={over ? "var(--ink)" : "var(--ink-2)"} /><Text style={st.actText}>{a.label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 6, gap: 20 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  face: { width: 44, height: 44, flexGrow: 0, flexShrink: 0 },
  dot: { position: "absolute", right: -2, bottom: -2, width: 10, height: 10, borderRadius: 5, boxShadow: "0 0 0 2px var(--side)" } as object,
  text: { flex: 1, minWidth: 0, paddingTop: 1 },
  name: { fontSize: 16.5, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string },
  lineBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 2, maxWidth: "100%" },
  line: { flexShrink: 1, fontSize: 13, lineHeight: 19, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: -8 },
  act: { height: 34, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  actOver: { backgroundColor: "var(--hover)" as string },
  actText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
  grow: { flex: 1 },
});
