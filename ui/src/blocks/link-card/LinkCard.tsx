// The link card, drawn. A line (glyph, the verb, the thing's name as a link) for a plain card; a card with the words and buttons under it for an agent's summary. The host gives it the glyph, the
// name lookup and what opening and a button do, so this file knows nothing about tasks or facts.
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isFullCard, linkCardLine } from "./model.ts";
import type { LinkCardData } from "./model.ts";
import type { CardState } from "./state.ts";
import { HIDDEN_TITLE } from "./state.ts";

export interface LinkCardProps {
  id: string;
  data: LinkCardData;
  nameOf: (id: string) => string;
  /** The glyph for `data.icon`, drawn by the host. */
  icon?: ReactNode;
  onOpen?: (target: NonNullable<LinkCardData["target"]>) => void;
  onAction?: (key: string) => void;
  /** Keys of buttons already pressed: they read as done and do nothing twice. */
  done?: ReadonlySet<string>;
  /** What the thing is doing now, read by the host as the reader. */
  state?: CardState | null;
  /** The reader may not open the thing: its name is not shown and it is not a link. */
  hidden?: boolean;
}

export function LinkCard({ id, data, nameOf, icon, onOpen, onAction, done, state, hidden }: LinkCardProps): ReactElement {
  const line = linkCardLine(data, nameOf);
  const open = data.target && onOpen && !hidden ? (): void => onOpen(data.target!) : undefined;
  const head = (
    <View style={st.head}>
      {icon ? <View style={st.icon}>{icon}</View> : null}
      <Text numberOfLines={2} style={st.text}>
        {`${line}: `}
        <Text accessibilityRole={open ? "link" : "text"} testID={`link-card-${id}-open`} onPress={open} style={open ? st.link : st.title}>{hidden ? HIDDEN_TITLE : data.title}</Text>
      </Text>
      {state && !hidden ? <Text testID={`link-card-${id}-state`} style={[st.state, state.tone === "ok" && st.ok, state.tone === "warn" && st.warn, state.tone === "bad" && st.bad]}>{state.text}</Text> : null}
    </View>
  );
  // the buttons are built in a loop: they are a few small buttons under a card, not the rows of a list
  const buttons: ReactElement[] = [];
  for (const a of data.actions ?? []) {
    const was = done?.has(a.key) === true;
    buttons.push(
      <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ disabled: was }} disabled={was || !onAction} testID={`link-card-${id}-${a.key}`} onPress={() => onAction?.(a.key)} style={[st.btn, was && st.btnDone]}>
        <Text style={st.btnText}>{was ? `${a.label} \u2713` : a.label}</Text>
      </Pressable>,
    );
  }
  if (!isFullCard(data)) return <View testID={`link-card-${id}`} accessibilityRole="text" style={st.line}>{head}</View>;
  return (
    <View testID={`link-card-${id}`} style={st.card}>
      {head}
      {data.body ? <Text style={st.body}>{data.body}</Text> : null}
      {data.actions?.length ? (
        <View style={st.acts}>
          {buttons}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  line: { paddingVertical: 4, marginVertical: 2 },
  card: { marginVertical: 6, maxWidth: 520, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 8, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  icon: { width: 18, height: 20, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 20, color: "var(--ink-3)" as string },
  link: { color: "var(--accent)" as string, fontWeight: "500" },
  title: { color: "var(--ink)" as string, fontWeight: "500" },
  state: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, marginLeft: 8, lineHeight: 20 },
  ok: { color: "var(--ok)" as string },
  warn: { color: "var(--warn)" as string },
  bad: { color: "var(--danger)" as string },
  body: { fontSize: 13.5, lineHeight: 21, color: "var(--ink)" as string },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: { height: 28, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  btnDone: { opacity: 0.6 },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
});
