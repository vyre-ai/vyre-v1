// The small pieces of the Computer tab as drawn (AGENT-COMPUTER-2026-11-13.md part A): a state dot, a section head with its dot and word, a group head with the owner's face.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Face } from "./parts.tsx";
import type { Dot as DotTone } from "./work-model.ts";

const color = (t: DotTone): string =>
  t === "run" ? "var(--ok)" : t === "wait" ? "var(--warn)" : t === "dead" ? "var(--danger)" : "var(--ink-4)";

/** Green is running, amber waiting, grey idle, hollow grey asleep, red ended. */
export function Dot({ tone, size = 7 }: { tone: DotTone; size?: number }): ReactElement {
  const hollow = tone === "zz";
  return (
    <View
      testID={`dot-${tone}`}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size,
        flexShrink: 0,
        flexGrow: 0,
        backgroundColor: hollow ? "transparent" : color(tone),
        borderWidth: hollow ? 1.2 : 0,
        borderColor: color(tone),
      }}
    />
  );
}

/** "Terminals", then a dot and one word; the quiet buttons go at the right. */
export function SectionHead({
  text,
  dot,
  word,
  right,
  testID,
}: {
  text: string;
  dot?: DotTone;
  word?: string;
  right?: ReactElement | null;
  testID?: string;
}): ReactElement {
  return (
    <View testID={testID} style={st.head}>
      <Text accessibilityRole="header" style={st.headText}>
        {text}
      </Text>
      {dot ? <Dot tone={dot} /> : null}
      {word ? <Text style={st.headWord}>{word}</Text> : null}
      <View style={{ flex: 1 }} />
      {right ?? null}
    </View>
  );
}

/** An owner's face and name, with one quiet word after it ("helper", "own tab"). */
export function GroupHead({
  name,
  tag,
  agent,
}: {
  name: string;
  tag?: string | undefined;
  agent: boolean;
}): ReactElement {
  return (
    <View testID={`group-${name}`} style={st.group}>
      {agent ? <Face name={name} size={16} /> : <Avatar name={name} kind="person" size={16} />}
      <Text style={st.groupName}>{name}</Text>
      {tag ? <Text style={st.groupTag}>{tag}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  head: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 6,
  },
  headText: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  headWord: { fontSize: 12, color: "var(--ink-3)" as string },
  group: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 2 },
  groupName: { fontSize: 12.5, color: "var(--ink-2)" as string },
  groupTag: { fontSize: 11.5, color: "var(--ink-4)" as string },
});
