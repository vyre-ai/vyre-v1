// ui/Segmented: the one two-to-four option switch. A sunk track with the chosen option raised on it. Each option may carry a tooltip (`hint`), so the difference between
// "Public" and "Invite only" is a hover away and takes no paragraph on the page. Colours are skin tokens.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Tooltip } from "../Tooltip/index.tsx";

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** Shown as the tooltip and read out as the hint. */
  hint?: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
  testID?: string;
}

export function Segmented<T extends string>({ options, value, onChange, label, testID }: SegmentedProps<T>): ReactElement {
  const buttons: ReactElement[] = [];
  for (const o of options) {
    const on = o.id === value;
    buttons.push(
      <Tooltip key={o.id} text={o.hint ?? ""}>
      <Pressable
        accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={o.label} {...(o.hint ? { accessibilityHint: o.hint } : {})}
        testID={testID ? `${testID}-${o.id}` : undefined} onPress={() => onChange(o.id)}
        style={({ hovered }: { hovered?: boolean }) => [s.btn, on && s.on, !on && hovered === true && s.over]}
      >
        <Text style={[s.text, on && s.textOn]}>{o.label}</Text>
      </Pressable>
      </Tooltip>,
    );
  }
  return <View accessibilityRole="tablist" accessibilityLabel={label} testID={testID} style={s.track}>{buttons}</View>;
}

const s = StyleSheet.create({
  track: { flexDirection: "row", padding: 2, borderRadius: 9, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  btn: { flex: 1, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  on: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" } as object,
  over: { backgroundColor: "var(--hover)" as string },
  text: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  textOn: { color: "var(--ink)" as string },
});
