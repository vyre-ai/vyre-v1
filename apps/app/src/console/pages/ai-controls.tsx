import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { Select } from "./shared.tsx";

/** The labelled picker the AI pages use: the shared Select, so every picker looks and opens the same way. */
export function Choice({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: readonly { key: string; title: string }[]; onChange(value: string): void; disabled?: boolean }): ReactElement {
  return <Select label={label} value={value} options={options} onChange={onChange} disabled={disabled} />;
}

export function Tick({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange(checked: boolean): void; disabled?: boolean }): ReactElement {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={(event) => { event.stopPropagation(); onChange(!checked); }} style={{ width: 32, minHeight: 32, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}>
    <View style={{ width: 15, height: 15, borderWidth: 1, borderColor: checked ? "var(--accent)" as string : "var(--line-2)" as string, backgroundColor: checked ? "var(--accent)" as string : "transparent", borderRadius: 3, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: "#fff" }}>{checked ? "✓" : ""}</Text></View>
  </Pressable>;
}
