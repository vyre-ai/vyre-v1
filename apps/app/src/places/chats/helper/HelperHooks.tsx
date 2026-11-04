// The hooks section of a helper (lane l-hooks, the approved prototype): the rules this helper runs under. Ones its lead gave it for this helper say "From <lead>", the ones it picked up from the run, the
// agent or the Space say "Inherited". A row opens the lead's Hooks tab at that hook where the shell can; the helper cannot change them itself.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../rightpane/parts.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { kindWord, titleOf, whatOf } from "../rightpane/hooks-model.ts";
import type { Hook } from "../rightpane/hooks-model.ts";

export type HelperHooksOut = CapMap["hooks.list"]["out"];

/** Which of the hooks this helper's own lead gave it, and which it inherits. */
export function splitHooks(hooks: readonly Hook[], helperThreadId: string): { own: Hook[]; inherited: Hook[] } {
  return { own: hooks.filter((h) => h.scope === "run" && h.threadId === helperThreadId), inherited: hooks.filter((h) => !(h.scope === "run" && h.threadId === helperThreadId)) };
}

function HookRow({ h, tag, open }: { h: Hook; tag: string; open?: (hookId: string) => void }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable key={h.id} accessibilityRole="button" accessibilityLabel={`${tag}: ${h.line}`} testID={`helper-hook-${h.id}`} disabled={!open} onPress={() => open?.(h.id)} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} style={[st.row, over && open ? st.over : null]}>
      <View style={st.text}>
        <Text style={st.when}>{titleOf(h)}</Text>
        <Text style={st.what}>{kindWord(h)}: {whatOf(h)}</Text>
      </View>
      <Text style={st.tag}>{tag}</Text>
      {open ? <Icon name="chev" size={11} color="var(--ink-4)" /> : null}
    </Pressable>
  );
}

export function HelperHooks({ hooks, helperThreadId, lead, name, open }: { hooks: readonly Hook[]; helperThreadId: string; lead: string; /** The helper's own name: "Hooks for Research" */ name: string; open?: (hookId: string) => void }): ReactElement | null {
  if (hooks.length === 0) return null;
  const { own, inherited } = splitHooks(hooks, helperThreadId);
  return (
    <View testID="helper-hooks" style={st.root}>
      <View style={st.head}><Text accessibilityRole="header" style={st.label}>{`Hooks for ${name}`}</Text><Text style={st.label}>{own.length + inherited.length}</Text></View>
      {own.map((h) => <HookRow key={h.id} h={h} tag={`From ${lead}`} {...(open ? { open } : {})} />)}
      {inherited.map((h) => <HookRow key={h.id} h={h} tag="Inherited" {...(open ? { open } : {})} />)}
    </View>
  );
}

const st = StyleSheet.create({
  root: { marginTop: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  over: { backgroundColor: "color-mix(in srgb, var(--ink) 5%, transparent)" as string },
  text: { flex: 1, minWidth: 0 },
  when: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  what: { marginTop: 1, fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  tag: { fontSize: 12, color: "var(--ink-3)" as string },
});
