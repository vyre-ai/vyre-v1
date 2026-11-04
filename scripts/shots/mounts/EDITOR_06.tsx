// Mount for l-editor: the Console audit log in plain words (?part=audit), and a before and after list of acts (?part=words): the old text (the act's code name with dots turned to spaces) beside what a person reads now.
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { auditSentence } from "../../../lib/words/audit.ts";
import { fileEventWords } from "../../../lib/words/files.ts";
import { stepNamer } from "../../../apps/app/src/places/automations/runs/model.ts";

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

const FOLDERS: Record<string, string> = { fld_clients: "Clients / Rivera", fld_brand: "Marketing / Brand" };
const FILE_EVENTS: [string, string, Record<string, unknown>][] = [
  ["Priya Raman", "file.created", { name: "Fee agreement.pdf", folderId: "fld_clients" }], ["Priya Raman", "file.renamed", { from: "Draft fee.pdf", to: "Fee agreement.pdf" }], ["Priya Raman", "file.moved", { toFolderId: "fld_clients" }],
  ["Omar Haddad", "file.version_added", { n: 3, versionId: "ver_01hx" }], ["Omar Haddad", "file.shared_external", { linkId: "lnk_8d2" }], ["Omar Haddad", "file.external_revoked", { linkId: "lnk_8d2" }],
  ["Priya Raman", "file.deleted", { folderId: "fld_clients" }], ["Priya Raman", "file.restored", { folderId: "fld_brand" }], ["Intake (Agent)", "file.markup_saved", {}], ["Intake (Agent)", "file.agent_read", { redacted: true }], ["Priya Raman", "file.redacted", { shape: "span", label: "Phone" }],
];
function FilesPart() {
  const rows = FILE_EVENTS.map(([who, type, p], i) => ({ i, before: `${who.split(" ")[0]} ${type.replace(/[._]/g, " ")}`, after: `${who} ${fileEventWords(type, p, { fileName: "Fee agreement.pdf", folder: (id) => FOLDERS[id] }) ?? "(no line)"}` }));
  return <Two testID="files" rows={rows} />;
}
const NODES = [{ id: "step_1", key: "records.find", title: "Find the client" }, { id: "n_7f3a", key: "send_email" }, { id: "step_3", key: "wait", input: { forDuration: "2d" } }, { id: "step_4", key: "http_request" }, { id: "n_91bc", key: "create_task", title: "Chase the invoice" }];
function RunsPart() {
  const name = stepNamer(NODES);
  const rows = NODES.map((n, i) => ({ i, before: `${n.id.replace(/[_.-]+/g, " ").replace(/^./, (c) => c.toUpperCase())}${i === 3 ? " failed" : ""}`, after: `${name(n.id)}${i === 3 ? " failed" : ""}` }));
  return <Two testID="runs" rows={rows} />;
}
function Two({ rows, testID }: { rows: { i: number; before: string; after: string }[]; testID: string }) {
  return (
    <ScrollView style={{ flex: 1, padding: 24 }} testID={testID}>
      <View style={{ flexDirection: "row", gap: 24, maxWidth: 1100, alignSelf: "center", width: "100%" }}>
        <View style={{ flex: 1 }}><Text style={{ color: "var(--ink-3)", fontSize: 12, marginBottom: 8 }}>Before</Text>{rows.map((r) => <Text key={r.i} style={{ color: "var(--ink-3)", fontSize: 13.5, lineHeight: 24 }}>{r.before}</Text>)}</View>
        <View style={{ flex: 1 }}><Text style={{ color: "var(--ink-3)", fontSize: 12, marginBottom: 8 }}>After</Text>{rows.map((r) => <Text key={r.i} style={{ color: "var(--ink)", fontSize: 13.5, lineHeight: 24 }}>{r.after}</Text>)}</View>
      </View>
    </ScrollView>
  );
}

export default function Mount() {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => { setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "words"); }, []);
  if (part === null) return <View style={{ flex: 1 }} />;
  if (part === "words") return <Words />;
  if (part === "files") return <FilesPart />;
  if (part === "runs") return <RunsPart />;
  const s = createSampleConsole();
  return <View style={{ flex: 1 }}><ConsoleDataProvider value={s.data}><ConsoleShell width={1280} initialPage="audit" /></ConsoleDataProvider></View>;
}
