// The link card, drawn. A line (glyph, the verb, the thing's name as a link) for a plain card; a card with the words and buttons under it for an agent's summary. The host gives it the glyph, the
// name lookup and what opening and a button do, so this file knows nothing about tasks or facts.
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isFullCard, isInlineAction, linkCardLine } from "./model.ts";
import type { LinkCardData } from "./model.ts";
import type { CardState } from "./state.ts";
import { hiddenTitle } from "./state.ts";

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
  /** Ask for access to the thing: shown beside the stand-in for a thing the reader cannot open. */
  onAskAccess?: () => void;
  /** The ask was made. */
  asked?: boolean;
  /** The time the line was written, as the reader reads times ("9:50 am"): shown at the right of a Noted line. */
  time?: string;
}

export function LinkCard({ id, data, nameOf, icon, onOpen, onAction, done, state, hidden, onAskAccess, asked, time }: LinkCardProps): ReactElement {
  const line = linkCardLine(data, nameOf);
  const open = data.target && onOpen && !hidden ? (): void => onOpen(data.target!) : undefined;
  const head = (
    <View style={st.head}>
      {icon ? <View style={st.icon}>{icon}</View> : null}
      <Text numberOfLines={2} style={st.text}>
        {data.style === "question" ? "" : `${line}: `}
        <Text accessibilityRole={open ? "link" : "text"} testID={`link-card-${id}-open`} onPress={open} style={open ? st.link : data.style === "question" ? st.qtitle : st.title}>{hidden ? hiddenTitle(data.target?.type) : data.title}</Text>
        {hidden && onAskAccess ? <Text style={st.title}>{" \u00b7 "}</Text> : null}
        {hidden && onAskAccess ? <Text accessibilityRole={asked ? "text" : "link"} testID={`link-card-${id}-ask`} onPress={asked ? undefined : onAskAccess} style={asked ? st.title : st.link}>{asked ? "Asked for access" : "Ask for access"}</Text> : null}
      </Text>
      {state && !hidden ? <Text testID={`link-card-${id}-state`} style={[st.state, state.tone === "ok" && st.ok, state.tone === "warn" && st.warn, state.tone === "bad" && st.bad]}>{state.text}</Text> : null}
    </View>
  );
  // the buttons are built in a loop: they are a few small buttons under a card, not the rows of a list
  const buttons: ReactElement[] = [];
  for (const a of data.actions ?? []) {
    const was = done?.has(a.key) === true;
    buttons.push(
      <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ disabled: was }} disabled={was || !onAction} testID={`link-card-${id}-${a.key}`} onPress={() => onAction?.(a.key)} style={[st.btn, was && st.btnDone, data.style === "question" && buttons.length === 0 && st.btnPrimary]}>
        <Text style={[st.btnText, data.style === "question" && buttons.length === 0 && st.btnPrimaryText]}>{was ? `${a.label} \u2713` : a.label}</Text>
      </Pressable>,
    );
  }
  if (data.style === "noted") {
    // the quiet line every memory leaves in a shared place: a dot, "Noted: decision, go with Harbor", Undo, and the time at the right
    const a = data.actions?.[0];
    const was = a ? done?.has(a.key) === true : false;
    return (
      <View testID={`link-card-${id}`} style={st.noted}>
        <Text style={st.notedText}>
          <Text>{`${data.lead}, `}</Text>
          <Text style={st.notedWords}>{data.title.charAt(0).toLowerCase() + data.title.slice(1)}</Text>
          {a ? <Text>{" \u00b7 "}</Text> : null}
          {a ? <Text accessibilityRole="button" testID={`link-card-${id}-${a.key}`} onPress={was || !onAction ? undefined : () => onAction(a.key)} style={st.notedUndo}>{was ? `${a.label} \u2713` : a.label}</Text> : null}
        </Text>
        {time ? <Text testID={`link-card-${id}-time`} style={st.notedTime}>{time}</Text> : null}
      </View>
    );
  }
  if (isInlineAction(data)) {
    const a = data.actions![0]!;
    const was = done?.has(a.key) === true;
    return (
      <View testID={`link-card-${id}`} style={st.line}>
        {head}
        <Pressable accessibilityRole="button" accessibilityLabel={a.label} disabled={was || !onAction} testID={`link-card-${id}-${a.key}`} onPress={() => onAction?.(a.key)}><Text style={[st.link, st.inlineBtn]}>{was ? `${a.label} \u2713` : a.label}</Text></Pressable>
      </View>
    );
  }
  if (!isFullCard(data)) return <View testID={`link-card-${id}`} accessibilityRole="text" style={st.line}>{head}</View>;
  return (
    <View testID={`link-card-${id}`} style={st.card}>
      {head}
      {data.sub ? <Text style={st.sub}>{data.sub}</Text> : null}
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
  line: { flexShrink: 1, minWidth: 0, paddingVertical: 0, marginVertical: 0, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8 },
  inlineBtn: { fontSize: 13, lineHeight: 20 },
  card: { marginVertical: 6, maxWidth: 520, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 8, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  head: { flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  icon: { width: 18, height: 20, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 20, color: "var(--ink-3)" as string },
  link: { color: "var(--accent)" as string, fontWeight: "500" },
  title: { color: "var(--ink-3)" as string },
  state: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, marginLeft: 8, lineHeight: 20 },
  ok: { color: "var(--ok)" as string },
  warn: { color: "var(--warn)" as string },
  bad: { color: "var(--danger)" as string },
  body: { fontSize: 13.5, lineHeight: 21, color: "var(--ink)" as string },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: { height: 28, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  btnDone: { opacity: 0.6 },
  btnPrimary: { backgroundColor: "var(--ink)" as string },
  btnPrimaryText: { color: "var(--win)" as string },
  qtitle: { color: "var(--ink)" as string, fontWeight: "500", fontSize: 14 },
  sub: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: -4 },
  noted: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 8 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "var(--ok)" as string },
  notedText: { fontSize: 13, lineHeight: 20, color: "var(--ink-3)" as string },
  notedWords: { color: "var(--ink-3)" as string },
  notedUndo: { color: "var(--accent)" as string, fontWeight: "500" },
  notedTime: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
});
