// Inbox > the running call as a green pill in the title bar (name and clock). The shell places it beside the title; while it is mounted the floating dock keeps out of the way.
// Press opens the conversation of the person the call is with.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatClock } from "../../../../../../ui/src/Softphone/index.tsx";
import { usePhone } from "./phone.tsx";

export function CallTitlePill(): ReactElement | null {
  const phone = usePhone();
  const has = phone !== null;
  const hold = phone?.holdPill;
  useEffect(() => (has ? hold?.() : undefined), [has, hold]);
  const pill = phone?.pill() ?? null;
  if (!phone || !pill) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Call with ${pill.name}, ${formatClock(pill.secs)}`} testID="call-title-pill" onPress={() => phone.openCall()} style={({ hovered }: { hovered?: boolean }) => [s.pill, hovered === true && s.hover]}>
      <View style={s.dot} />
      <Text numberOfLines={1} style={s.text}>{`${pill.name} ${formatClock(pill.secs)}`}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: { height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10, borderRadius: 13, backgroundImage: "linear-gradient(color-mix(in srgb, var(--ok) 16%, transparent), color-mix(in srgb, var(--ok) 16%, transparent))" as unknown as undefined },
  hover: { backgroundImage: "linear-gradient(color-mix(in srgb, var(--ok) 26%, transparent), color-mix(in srgb, var(--ok) 26%, transparent))" as unknown as undefined },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ok)" as string },
  text: { color: "var(--ink)" as string, fontSize: 12, fontWeight: "500" },
});
