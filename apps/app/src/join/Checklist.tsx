// join/Checklist: the first-run checklist (spec 3.13, 2.1, ARCH 7.0), drawn inside the Home first-run layout as the prototype has it: the greeting, the date line and the
// "Get started n of N" card of rows on the page itself, never a modal over a wash. It follows the Space skin like Home does (join pages proper keep the platform palette).
// Items come from home.checklist; the AI account row leads, each row has its own action, done rows say Done, and the assistant waits behind the AI account. Hidden once all
// are done or dismissed ("All set"). Home's own card (places/home/sections-b) is a separate lane's code; this is the join screen's copy of the same layout.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../ui/src/Row/index.tsx";

export type ChecklistKey = "photo_and_title" | "connect_mailbox_and_calendar" | "meet_assistant" | "open_first_project" | "import";
export interface ChecklistItem { key: ChecklistKey; title: string; done: boolean }

const WORDS: Record<ChecklistKey, { sub: (space: string) => string; action: string }> = {
  photo_and_title: { sub: (space) => `Next to your name in ${space}`, action: "Add" },
  connect_mailbox_and_calendar: { sub: () => "So agents can draft and schedule for you", action: "Connect" },
  meet_assistant: { sub: () => "Say hello in a chat", action: "Open" },
  open_first_project: { sub: () => "Start with the one you were invited to", action: "Open" },
  import: { sub: () => "Mail, drives, CRM or spreadsheets", action: "Import" },
};

export interface ChecklistProps {
  space: string;
  items: ChecklistItem[];
  /** false once dismissed or finished */
  visible: boolean;
  /** the assistant is locked until an AI account is connected */
  assistantLocked?: boolean;
  /** "Good morning, Dana" */
  heading?: string;
  /** "Friday, October 24" */
  dateLine?: string;
  onGo?: (key: ChecklistKey | "ai") => void;
  onDismiss?: () => void;
}

interface Line { key: ChecklistKey | "ai"; title: string; sub: string; done: boolean; locked: boolean; action: string }

function Circle({ done }: { done: boolean }): ReactElement {
  return <View style={[s.circle, done && s.circleDone]} testID={done ? "check-done" : "check-open"}>{done ? <Text style={s.tick}>{"✓"}</Text> : null}</View>;
}

export function Checklist({ space, items, visible, assistantLocked, heading, dateLine, onGo, onDismiss }: ChecklistProps): ReactElement {
  const lines: Line[] = [{ key: "ai", title: "Connect an AI account", sub: "Your assistant stays locked until you do", done: !assistantLocked, locked: false, action: "Connect" }];
  for (const it of items) {
    const blocked = it.key === "meet_assistant" && !!assistantLocked && !it.done;
    lines.push({ key: it.key, title: it.title, sub: it.done ? "Done" : blocked ? "Connect an AI account first" : WORDS[it.key].sub(space), done: it.done, locked: blocked, action: WORDS[it.key].action });
  }
  const done = lines.filter((l) => l.done).length;
  const rows: ReactElement[] = [];
  lines.forEach((l, i) => rows.push(
    <View key={l.key} style={[s.item, i > 0 && s.itemLine]} testID={`check-${l.key}`}>
      <Row
        id={`first-${l.key}`} title={l.title} note={l.sub} leading={<View style={s.lead}><Circle done={l.done} /></View>}
        trailing={l.done ? null : l.locked ? <Text style={s.locked}>Locked</Text> : (
          <Pressable accessibilityRole="button" accessibilityLabel={`${l.action}: ${l.title}`} testID={`go-${l.key}`} onPress={() => onGo?.(l.key)} style={s.go}><Text style={s.goText}>{l.action}</Text></Pressable>
        )}
        {...(l.done || l.locked ? {} : { onPress: () => onGo?.(l.key) })}
      />
    </View>,
  ));
  const finished = !visible || (items.length > 0 && done === lines.length);
  return (
    <View testID="join-checklist" style={s.page}>
      <View style={s.col}>
        <Text accessibilityRole="header" aria-level={1} style={s.h1}>{heading ?? `Welcome to ${space}`}</Text>
        <Text style={s.date}>{`${dateLine ? `${dateLine} · ` : ""}Welcome to ${space}`}</Text>
        {finished ? (
          <View style={s.done} testID="checklist-finished">
            <Text accessibilityRole="header" style={s.doneTitle}>All set</Text>
            <Text style={s.doneSub}>{`${space} is ready.`}</Text>
          </View>
        ) : (
          <View testID="s-first" accessibilityLabel="Get started" style={s.card}>
            <View style={s.head}>
              <Text accessibilityRole="header" style={s.title}>Get started</Text>
              <Text style={s.n} testID="first-progress">{`${done} of ${lines.length}`}</Text>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" testID="checklist-done" onPress={onDismiss} style={s.hide}><Text style={s.hideText}>Hide</Text></Pressable>
            </View>
            <View testID="checklist" accessibilityRole="list" style={s.body}>
              {rows}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, minHeight: "100%" as unknown as number, backgroundColor: "var(--win)" as string, alignItems: "center", paddingTop: 48, paddingHorizontal: 20 },
  col: { width: "100%", maxWidth: 760 },
  h1: { margin: 0, fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.6, color: "var(--ink)" as string },
  date: { marginTop: 4, marginBottom: 26, fontSize: 13.5, color: "var(--ink-2)" as string },
  card: { marginBottom: 22 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, height: 24, marginBottom: 4 },
  title: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  n: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  hide: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 5 },
  hideText: { fontSize: 12, color: "var(--ink-3)" as string },
  body: { borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  item: { paddingVertical: 4, paddingHorizontal: 6 },
  itemLine: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  lead: { width: 32, alignItems: "flex-start", justifyContent: "center" },
  circle: { width: 20, height: 20, borderRadius: 99, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  circleDone: { backgroundColor: "var(--ok)" as string, borderWidth: 0 },
  tick: { fontSize: 11, lineHeight: 12, color: "#fff", fontWeight: "700" },
  go: { height: 26, paddingHorizontal: 12, borderRadius: 7, backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  goText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  locked: { fontSize: 12.5, color: "var(--ink-3)" as string },
  done: { marginTop: 4 },
  doneTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  doneSub: { marginTop: 4, fontSize: 13.5, color: "var(--ink-2)" as string },
});
