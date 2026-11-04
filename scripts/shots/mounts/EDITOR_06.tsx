// Mount for l-editor: the Console audit log in plain words (?part=audit), and a before and after list of acts (?part=words): the old text (the act's code name with dots turned to spaces) beside what a person reads now.
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { auditSentence } from "../../../lib/words/audit.ts";

export const title = "Activity and audit wording";

const ACTS: [string, string?][] = [
  ["files.save", "Fee agreement.pdf"], ["tasks.working_notes.set", "Send Josh the meeting link"], ["records.create"], ["access.actors.create"], ["google.calendar.create_event"], ["vault.item.delete"], ["gate.approved"],
  ["agent.routine_changed"], ["file.comment_resolved", "Engagement letter.docx"], ["member.joined"], ["mounts.sheet_write"], ["automation.trigger_dropped", "Chase unpaid invoices"], ["engine.mcp.oauth_start"], ["task.sent_back", "Review Redline v3"],
  ["call.recording_ready"], ["thread.closed", "Launch plan"], ["identity.claim_owner"], ["memory.note_restored", "Rivera notes"], ["stripe.invoice.send"], ["skills.space.install", "write-brief"], ["plugin.uninstalled"], ["views.share_external", "Open matters"],
];

function Words() {
  const rows = ACTS.map(([a, r]) => ({ a, before: `Priya Raman ${a.replace(/[._]/g, " ")}${r ? ` ${r}` : ""}`, after: auditSentence({ actor: "Priya Raman", action: a, ...(r ? { resource: r } : {}) }) }));
  return (
    <ScrollView style={{ flex: 1, padding: 24 }} testID="words">
      <View style={{ flexDirection: "row", gap: 24, maxWidth: 1100, alignSelf: "center", width: "100%" }}>
        <View style={{ flex: 1 }}><Text style={{ color: "var(--ink-3)", fontSize: 12, marginBottom: 8 }}>Before</Text>{rows.map((r) => <Text key={r.a} style={{ color: "var(--ink-3)", fontSize: 13.5, lineHeight: 26 }}>{r.before}</Text>)}</View>
        <View style={{ flex: 1 }}><Text style={{ color: "var(--ink-3)", fontSize: 12, marginBottom: 8 }}>After</Text>{rows.map((r) => <Text key={r.a} style={{ color: "var(--ink)", fontSize: 13.5, lineHeight: 26 }}>{r.after}</Text>)}</View>
      </View>
    </ScrollView>
  );
}

export default function Mount() {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => { setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "words"); }, []);
  if (part === null) return <View style={{ flex: 1 }} />;
  if (part === "words") return <Words />;
  const s = createSampleConsole();
  return <View style={{ flex: 1 }}><ConsoleDataProvider value={s.data}><ConsoleShell width={1280} initialPage="audit" /></ConsoleDataProvider></View>;
}
