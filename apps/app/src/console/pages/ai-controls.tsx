import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";

export function Choice({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: readonly { key: string; title: string }[]; onChange(value: string): void; disabled?: boolean }): ReactElement {
  const menu = useMenu();
  return <View style={{ gap: 6, marginVertical: 8 }}>
    <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled }} style={{ minHeight: 34, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, opacity: disabled ? 0.5 : 1 }} onPress={(event) => {
      const target = event.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } };
      const rect = target.getBoundingClientRect?.();
      menu.show(options.map((option) => ({ label: option.title, checked: option.key === value, onSelect: () => onChange(option.key) })), rect?.left ?? event.nativeEvent.pageX, rect?.bottom ?? event.nativeEvent.pageY, "other");
    }}><Text style={{ fontSize: 13, color: "var(--ink)" as string }}>{options.find((option) => option.key === value)?.title ?? value}</Text></Pressable>
    {menu.element}
  </View>;
}

export function Tick({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange(checked: boolean): void; disabled?: boolean }): ReactElement {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={(event) => { event.stopPropagation(); onChange(!checked); }} style={{ width: 32, minHeight: 32, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}>
    <View style={{ width: 15, height: 15, borderWidth: 1, borderColor: checked ? "var(--accent)" as string : "var(--line-2)" as string, backgroundColor: checked ? "var(--accent)" as string : "transparent", borderRadius: 3, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: "#fff" }}>{checked ? "✓" : ""}</Text></View>
  </Pressable>;
}
