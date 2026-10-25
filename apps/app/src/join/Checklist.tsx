// join/Checklist: the first-run checklist in the join pattern (spec 3.13, 2.1, ARCH 7.0). Five steps from home.checklist; each row has its own action,
// done rows say Done, and the assistant waits behind the AI account. Hidden once all are done or dismissed ("All set").
import { Text, View } from "react-native";
import { AppIcon, Bar, Button, Check, Group, Panel, Step, TextButton, Title, baseText, useJoin } from "./kit.tsx";

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
  onGo?: (key: ChecklistKey) => void;
  onDismiss?: () => void;
}

function ItemRow({ item, space, locked, divider, onGo }: { item: ChecklistItem; space: string; locked: boolean; divider?: boolean; onGo?: (k: ChecklistKey) => void }) {
  const { p } = useJoin();
  const w = WORDS[item.key];
  const blocked = item.key === "meet_assistant" && locked && !item.done;
  return (
    <View testID={`check-${item.key}`} accessibilityRole={"listitem" as never} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 }}>
      {divider ? <View pointerEvents="none" style={{ position: "absolute", left: 16, right: 0, top: 0, height: 1, backgroundColor: p.hair }} /> : null}
      <View accessibilityLabel={item.done ? "Done" : "Not done"} style={[{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: p.tx2 }, item.done ? { backgroundColor: p.blue, borderColor: p.blue } : null]}>
        {item.done ? <Check size={12} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[baseText(p), { fontWeight: "500" }]}>{item.title}</Text>
        <Text style={[baseText(p), { fontSize: 13, lineHeight: 18, color: p.tx2 }]}>{item.done ? "Done" : blocked ? "Connect an AI account first" : w.sub(space)}</Text>
      </View>
      {item.done ? null : blocked ? <Text style={[baseText(p), { fontSize: 13, color: p.tx2 }]}>Locked</Text> : <TextButton testID={`go-${item.key}`} label={w.action} onPress={() => onGo?.(item.key)} />}
    </View>
  );
}

export function Checklist({ space, items, visible, assistantLocked, onGo, onDismiss }: ChecklistProps) {
  const done = items.filter((i) => i.done).length;
  const finished = !visible || (items.length > 0 && done === items.length);
  const bar = <Bar hideBack cont={<Button testID="checklist-done" label={finished ? "Done" : "Not now"} onPress={onDismiss} />} />;
  return (
    <Panel center bar={bar}>
      <Step id="checklist">
        <AppIcon kind="space" letter={space} />
        <Title title={finished ? "All set" : "Get started"} sub={finished ? `${space} is ready.` : `${done} of ${items.length} done`} />
        {finished ? null : (
          <Group testID="checklist">
            {items.map((it) => <ItemRow key={it.key} item={it} space={space} locked={!!assistantLocked} onGo={onGo} />)}
          </Group>
        )}
      </Step>
    </Panel>
  );
}

