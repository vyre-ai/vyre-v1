// The hooks section of a helper (lane l-hooks, the approved prototype): the rules this helper runs under. Ones its lead gave it for this helper say "From <lead>", the ones it picked up from the run, the
// agent or the Space say "Inherited". A row opens the lead's Hooks tab at that hook where the shell can; the helper cannot change them itself.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../needsyou/parts.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { kindWord, titleOf, whatOf } from "../rightpane/hooks-model.ts";
import type { Hook } from "../rightpane/hooks-model.ts";

export type HelperHooksOut = CapMap["hooks.list"]["out"];

/** Which of the hooks this helper's own lead gave it, and which it inherits. */
export function splitHooks(hooks: readonly Hook[], helperThreadId: string): { own: Hook[]; chat: Hook[]; inherited: Hook[] } {
  const own = hooks.filter((h) => h.scope === "run" && h.threadId === helperThreadId);
  // the chat's own rules bind the helper too: shown as "From this chat", read-only here
  const chat = hooks.filter((h) => h.scope === "chat");
  return { own, chat, inherited: hooks.filter((h) => !own.includes(h) && !chat.includes(h)) };
}

function HookRow({ h, tag, open }: { h: Hook; tag: string; open?: (hookId: string) => void }): ReactElement {
  // one ui/Row: the rule, what it does under it, where it comes from and the chevron on the right; the Row paints hover and selection across its whole width
  return (
    <View testID={`helper-hook-${h.id}`} accessibilityLabel={`${tag}: ${h.line}`}>
      <Row id={`helper-hook-${h.id}`} tall title={titleOf(h)} note={`${kindWord(h)}: ${whatOf(h)}`}
        trailing={<View style={st.trail}><Text style={st.tag}>{tag}</Text>{open ? <Icon name="chev" size={11} color="var(--ink-4)" /> : null}</View>}
        {...(open ? { onPress: () => open(h.id) } : {})} />
    </View>
  );
}

export function HelperHooks({ hooks, helperThreadId, lead, name, open }: { hooks: readonly Hook[]; helperThreadId: string; lead: string; /** The helper's own name: "Hooks for Research" */ name: string; open?: (hookId: string) => void }): ReactElement | null {
  if (hooks.length === 0) return null;
  const { own, chat, inherited } = splitHooks(hooks, helperThreadId);
  return (
    <View testID="helper-hooks" style={st.root}>
      <View style={st.head}><Text accessibilityRole="header" style={st.label}>{`Hooks for ${name}`}</Text><Text style={st.label}>{own.length + chat.length + inherited.length}</Text></View>
      {/* ui-rows-lint: not a list (each line is a HookRow, which draws a ui/Row itself) */}
      {own.map((h) => <HookRow key={h.id} h={h} tag={`From ${lead}`} {...(open ? { open } : {})} />)}
      {/* ui-rows-lint: not a list (each line is a HookRow, which draws a ui/Row itself) */}
      {chat.map((h) => <HookRow key={h.id} h={h} tag="From this chat" {...(open ? { open } : {})} />)}
      {/* ui-rows-lint: not a list (each line is a HookRow, which draws a ui/Row itself) */}
      {inherited.map((h) => <HookRow key={h.id} h={h} tag="Inherited" {...(open ? { open } : {})} />)}
    </View>
  );
}

const st = StyleSheet.create({
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  root: { marginTop: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  row: { paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  rowIn: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  over: { backgroundColor: "var(--hover)" as string },
  text: { flex: 1, minWidth: 0 },
  when: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  what: { marginTop: 1, fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  tag: { fontSize: 12, color: "var(--ink-3)" as string },
});

/**
 * The same section for a place that has only a thread id and the capability door (the crew peek): it reads `hooks.list` for the helper's thread, as the person, and draws the rows above. The list for a helper
 * holds the hooks its lead gave it (run scope, on its own thread), the run hooks of the chat above, the Space's and the person's, so "From <lead>" and "Inherited" come out as on the helper's own page.
 */
export function HelperHooksSection({ threadId, call, lead, name, open }: { threadId: string; call(cap: string, input: unknown): Promise<unknown>; lead: string; name: string; open?: (hookId: string) => void }): ReactElement | null {
  const [hooks, setHooks] = useState<readonly Hook[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(call("hooks.list", { threadId })).then((r) => { if (live) setHooks(((r ?? {}) as { hooks?: Hook[] }).hooks ?? []); }, () => { if (live) setHooks([]); });
    return () => { live = false; };
  }, [call, threadId]);
  return <HelperHooks hooks={hooks} helperThreadId={threadId} lead={lead} name={name} {...(open ? { open } : {})} />;
}
