// Mount for lane l-memory (MEMORY-RULES 4, 5, 7, 9): what memory shows in a shared place. ?part=knows (the Knows tab in the side pane), noted (the quiet "Noted ... Undo" line and the open question with a choice per answer),
// chip (an agent's answer with its source chip). The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Knows, SourceChip } from "../../../ui/src/Knows/index.tsx";
import type { KnowsItem } from "../../../ui/src/Knows/model.ts";
import { LinkCard } from "../../../ui/src/blocks/link-card/LinkCard.tsx";

export const title = "Memory in a shared place: Knows, the Noted line, the open question, the source chip";

const ITEMS: KnowsItem[] = [
  { factId: "f1", kind: "decision", text: "Waive the consult fee for referrals", state: "current", by: "Omar Haddad", at: "Today 9:50 am", canEdit: true },
  { factId: "f2", kind: "decision", text: "The consult stays Tuesday at 2:00 with Maya", state: "current", by: "Maya Chen", at: "Yesterday 4:20 pm", canEdit: true },
  { factId: "f3", kind: "decision", text: "Consult on Monday at 11:00", state: "replaced", replacedBy: "The consult stays Tuesday at 2:00 with Maya", by: "Maya Chen", at: "Yesterday 4:12 pm", canEdit: true },
  { factId: "f4", kind: "fact", text: "Elena Rivera was referred by Maya Chen", state: "current", by: "Omar Haddad", at: "Yesterday 4:12 pm", canEdit: true },
  { factId: "f5", kind: "commitment", text: "Intake chases the intake form on Monday at 5:00 pm if it is not back", state: "current", by: "Intake", at: "Yesterday 4:20 pm", owes: "Intake, Mon 5:00 pm", canEdit: true },
  { factId: "f6", kind: "preference", text: "Short replies in this chat", state: "current", by: "Maya Chen", at: "Yesterday 4:20 pm", canEdit: true },
  { factId: "f7", kind: "decision", text: "Billing runs on the first", state: "disputed", by: "Omar Haddad", at: "Today 8:10 am", canEdit: true },
];
const names = (id: string): string => ({ usr_maya: "Maya", usr_omar: "Omar" } as Record<string, string>)[id] ?? id;

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "knows"), []);
  if (part === null) return null;
  const wrap = (kids: ReactNode): ReactNode => <View style={{ padding: 16, maxWidth: 520, backgroundColor: "var(--paper)" as string, minHeight: 700 }}>{kids}</View>;
  if (part === "noted") {
    return wrap(
      <View testID="memory-noted" style={{ gap: 12 }}>
        <LinkCard id="n1" data={{ icon: "fact", lead: "Noted: decision", title: "Waive the consult fee for referrals", target: { type: "fact", id: "f1" }, actions: [{ key: "undo", label: "Undo", cap: "memory.undo", input: { factId: "f1" } }] }} nameOf={names} />
        <LinkCard id="n2" data={{ icon: "fact", lead: "Noted: commitment", title: "Intake chases the form on Monday at 5:00 pm" }} nameOf={names} />
        <LinkCard id="q1" data={{ icon: "fact", lead: "Open question", title: "Two statements about one thing", body: "One said: The review is on Thursday morning\nAnother said: The review is on Friday morning\nWhich holds?", actions: [{ key: "a", label: "The review is on Thursday morning", cap: "memory.question.resolve", input: {} }, { key: "b", label: "The review is on Friday morning", cap: "memory.question.resolve", input: {} }] }} nameOf={names} />
      </View>,
    );
  }
  if (part === "chip") {
    return wrap(
      <View testID="memory-chip" style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, color: "var(--ink)" as string }}>The consult stays Tuesday at 2:00 with Maya.</Text>
        <SourceChip by="Maya Chen" at="Yesterday 4:20 pm" />
      </View>,
    );
  }
  return wrap(<Knows place="Rivera account" items={ITEMS} onSource={() => undefined} onEdit={() => undefined} onRemove={() => undefined} />);
}
