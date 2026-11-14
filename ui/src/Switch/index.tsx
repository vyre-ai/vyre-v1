// ui/Switch: the one on/off switch. It is the Settings switch (34 by 20, the accent when on), so every place draws the same size, the same hover and the same keys: Space and Enter toggle it,
// a disabled switch does nothing and is dimmed, and the label is what a screen reader hears. `labelled` draws the words beside the track as one pressable row (a sheet's option).
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

const web = Platform.OS === "web";
const pointer = (web ? { cursor: "pointer" } : {}) as ViewStyle;

export interface SwitchProps {
  on: boolean;
  onChange(next: boolean): void;
  /** What a screen reader hears; with `labelled`, also the words beside the track. */
  label: string;
  disabled?: boolean;
  labelled?: boolean;
  testID?: string;
}

interface KeyEventLike {
  key?: string;
  preventDefault?: () => void;
}

export function Switch({ on, onChange, label, disabled = false, labelled = false, testID }: SwitchProps): ReactElement {
  const keys = web
    ? {
        onKeyDown: (e: KeyEventLike) => {
          if (disabled) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault?.();
            onChange(!on);
          }
        },
      }
    : {};
  const paint = [st.sw, { backgroundColor: (on ? "var(--accent)" : "var(--press)") as string }, disabled && st.dim];
  const knob = <View style={[st.knob, { left: on ? 17 : 2 }]} />;
  const common = {
    accessibilityRole: "switch" as const,
    accessibilityLabel: label,
    accessibilityState: { checked: on, disabled },
    "aria-checked": on,
    testID,
    disabled,
    onPress: () => onChange(!on),
    ...keys,
    // the words of the switch on hover and keyboard focus, through the one tooltip (react-native-web drops a `title` prop on a Pressable, so it goes as data-tt)
    ...(web && !labelled ? ({ dataSet: { tt: label } } as object) : {}),
  };
  if (!labelled)
    return (
      <Pressable {...common} style={[...paint, pointer]}>
        {knob}
      </Pressable>
    );
  return (
    <Pressable {...common} style={[st.row, pointer]}>
      <View style={paint}>{knob}</View>
      <Text style={st.text}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  sw: { width: 34, height: 20, borderRadius: 10, justifyContent: "center" },
  knob: { position: "absolute", top: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" },
  dim: { opacity: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  text: { color: "var(--ink-2)" as string, fontSize: 12.5 },
});
