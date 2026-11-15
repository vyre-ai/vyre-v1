// The Island above the composer (prototype p-crew): while helpers work, one small pill says so and wears their faces; it says "Needs you" in amber when one waits for a person. It reads the same crew status as the
// strip, the header chip and the pane, and pressing it opens the pane. It is gone when nobody is working.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { useCalmWord } from "../conversation/ActivityLine.tsx";
import { counts, faceSeed, islandText, nameOf } from "./model.ts";
import type { ActivityStore } from "../../../shell/session/turn-streams.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { CrewStatusOut } from "./model.ts";

export function CrewIsland({ status, onPress }: { status: CrewStatusOut; onPress: () => void }): ReactElement | null {
  const c = counts(status.totals);
  if (c.active === 0) return null;
  const active =
    c.needsYou > 0
      ? status.members.filter((m) => m.state === "needs_you")
      : status.members.filter((m) => m.state === "working");
  return (
    <View style={st.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={c.needsYou > 0 ? `${c.needsYou} helper needs you` : `${c.active} helpers working`}
        testID="crew-island"
        onPress={onPress}
        style={st.pill}
      >
        <View style={[st.dot, { backgroundColor: (c.needsYou > 0 ? "var(--warn)" : "var(--accent)") as string }]} />
        <Text testID="crew-island-text" numberOfLines={1} style={st.text}>
          {islandText(status)}
        </Text>
        {/* ui-rows-lint: not a list (the faces of the helpers at work, a decoration on one pill) */}
        <View style={st.faces}>
          {active.slice(0, 5).map((m) => (
            <Avatar key={m.id} name={nameOf(m)} seedId={faceSeed(m)} kind="agent" size={20} />
          ))}
        </View>
      </Pressable>
    </View>
  );
}

let lastBlocks: { key: string; store: ActivityStore } | null = null;
/**
 * A reply whose work shows as live blocks (no activity stream reaches this screen) gives the island the same snapshot shape the reply line reads: one live step per live block. The snapshot is kept
 * while its key stands, so a render never makes a new one.
 */
export function blocksActivity(key: string, live: number): ActivityStore | undefined {
  if (live === 0) return undefined;
  const k = `${key}:${live}`;
  if (lastBlocks?.key === k) return lastBlocks.store;
  const snap = {
    startedAt: 0,
    thinking: "",
    version: 1,
    steps: Array.from({ length: live }, (_, i) => ({ id: `b${i}`, name: "step", state: "live" as const })),
  } as ReturnType<ActivityStore["get"]>;
  lastBlocks = { key: k, store: { get: () => snap, subscribe: () => () => undefined } };
  return lastBlocks.store;
}

/**
 * The island of anyone working (prototype p-crew, scene "live"): one pill above the composer that says "Thinking" or "Writing" (the same one word the reply line shows: useCalmWord), wears the faces of everyone
 * working, and opens the crew when pressed. For any working agent, the lead alone included. The screen hides it while a question is open and shows the amber helper pill when one waits for a person.
 */
export function WorkIsland({
  store,
  stream,
  held = false,
  faces,
  onPress,
}: {
  /** The live reply of the lead, when there is one: its activity and its streamed words. */
  store?: ActivityStore | undefined;
  stream?: StreamStore | undefined;
  held?: boolean;
  faces: ReadonlyArray<{ id: string; name: string; seed: string }>;
  onPress: () => void;
}): ReactElement | null {
  const { label, writing } = useCalmWord(store, stream, held);
  if (faces.length === 0) return null;
  return (
    <View style={st.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the crew`}
        testID="work-island"
        onPress={onPress}
        style={st.pill}
      >
        <WorkingMark state={writing ? "writing" : "thinking"} step={label} size={18} />
        <Text testID="work-island-text" numberOfLines={1} style={st.text}>
          {label}
        </Text>
        {/* ui-rows-lint: not a list (the faces of everyone working, a decoration on one pill) */}
        <View style={st.faces}>
          {faces.slice(0, 5).map((f) => (
            <Avatar key={f.id} name={f.name} seedId={f.seed} kind="agent" size={20} />
          ))}
        </View>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: 6, paddingHorizontal: 12 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 34,
    maxWidth: "100%",
    minWidth: 0,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-1)",
  } as object,
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { flexShrink: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  faces: { flexDirection: "row", gap: 4 },
});
