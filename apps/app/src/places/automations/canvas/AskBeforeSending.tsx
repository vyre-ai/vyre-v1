// "Ask before sending" on a step that sends: Off sends at once, On holds the send for approval.
// A Space rule that requires approval for sends still wins; the note says so when one is set.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { MenuButton } from "../operations/parts.tsx";
import { useOptionalAutomationsData } from "./data.tsx";

// The steps that reach people or other systems. This is a list, not a read of generated/registry.json: generated/registry.ts loads that file with readFileSync at module load, which has no
// file to read in the web bundle or in the static export. The test next to this file checks the list against the registry, so a new outward step fails it until it is added here.
export const OUTWARD_STEPS: readonly string[] = [
  "connector_request", "github.issue.comment", "github.issue.create", "google.calendar.create_event", "google.docs.create_document", "google.drive.create_folder", "google.gmail.send_message",
  "google.sheets.append_values", "http_request", "ms.calendar.create_event", "ms.drive.create_folder", "ms.mail.send_message", "post_message", "send_email", "send_sms", "sign",
];
const OUTWARD = new Set(OUTWARD_STEPS);

/** A step that reaches people or other systems. Only these carry the setting. */
export const sendsOutward = (key: string): boolean => OUTWARD.has(key);

export function approvalChoices(on: boolean, set: (next: boolean) => void): MenuEntry[] {
  return [{ label: "Off", checked: !on, onSelect: () => set(false) }, { label: "On", checked: on, onSelect: () => set(true) }];
}

export function approvalNote(on: boolean, adminRule: boolean): string {
  if (adminRule) return on ? "Your Space requires approval for sends. This step waits for approval." : "Your Space requires approval for sends. This step waits even though this is Off.";
  return on ? "The send waits until someone approves it." : "The send goes out as soon as the step runs.";
}

export function AskBeforeSending({ on, adminRule, onSet }: { on: boolean; adminRule: boolean; onSet(next: boolean): void }): ReactElement {
  return (
    <View testID="ask-before-sending" style={a.group}>
      <Text style={a.head}>Before it sends</Text>
      <View style={a.row}>
        <Text style={a.label}>Ask before sending</Text>
        <MenuButton testID="choose-ask-before-sending" label={on ? "On" : "Off"} entries={approvalChoices(on, onSet)} />
      </View>
      <Text testID="ask-before-sending-note" style={a.hint}>{approvalNote(on, adminRule)}</Text>
    </View>
  );
}

/** Reads whether a Space rule asks for sends, once. An unreadable answer says nothing rather than guessing. */
export function SendApproval({ on, onSet }: { on: boolean; onSet(next: boolean): void }): ReactElement {
  const data = useOptionalAutomationsData();
  const [adminRule, setAdminRule] = useState(false);
  useEffect(() => {
    let live = true;
    void data?.call("gate.effective_rule", { principal: { kind: "service", id: "svc_automation" }, act: "send" })
      .then((out) => { if (live) setAdminRule((out as { adminRule?: unknown } | null)?.adminRule === true); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [data]);
  return <AskBeforeSending on={on} adminRule={adminRule} onSet={onSet} />;
}

const a = StyleSheet.create({
  group: { gap: 6, marginTop: 4 },
  head: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  label: { fontSize: 13, color: "var(--ink)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
});
