// The one card for every held outward act: a message to a person, an email, a text, a post in a channel, and a send in the person's own Chrome (lane l-chrome2a, owner bug rc.20).
//   Header   the recipient's avatar and name and the channel in plain words ("Dex wants to message Aliza Rizvi"), and, only when it does not go now, when ("Sends at 9:00").
//   Body     what it says, drawn by the chat's own block renderer (bold, lists, links), in full; past about twelve lines it is cut with "Show all".
//   Edit     the body becomes the shared MarkdownEditor in place, with Save and Cancel. Saving keeps it held and the card says "Edited by you".
//   Buttons  Send (primary), Edit, Don't send. Don't send asks for a reason, optional, that goes back to the agent. After Send the card reads "Sent to Aliza · 04:38", after Don't send "Not sent".
// It knows nothing of the Gate or of Chrome: the caller says what Send, Save and Don't send do. No internal field name is ever drawn.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MarkdownEditor } from "../../../../../../ui/src/RichEditor/MarkdownEditor.tsx";
import { MarkdownText } from "../../../../../../ui/src/stream/MarkdownText.tsx";
import { Face } from "../needsyou/parts.tsx";
import { Glyph, TextButton } from "./parts.tsx";

export interface HeldRecipient { name: string; seed: string; kind?: "person" | "agent" }
export interface HeldSaved { body: string; subject?: string; to?: string }

export interface HeldCardProps {
  testID: string;
  /** Who the agent is, for "<agent> wants to ...". */
  agent: string;
  to: readonly HeldRecipient[];
  /** The channel and who, in plain words: "message Aliza Rizvi", "email aliza@example.com", "text +14155550123", "post in this chat". */
  verb: string;
  /** Only when it does not go now: "Sends at 9:00". */
  schedule?: string | null | undefined;
  subject?: string | undefined;
  /** Extra labelled lines (From, Where). */
  fields?: ReadonlyArray<readonly [string, string]>;
  /** Labels of `fields` whose text is Markdown (a link). */
  fieldMd?: readonly string[];
  /** A calendar entry's guests, as faces and names, shown after its When line; and whether they are emailed. */
  invitees?: ReadonlyArray<{ name: string; seed: string }>;
  inviteNote?: string;
  /** The body sits folded under this label until opened ("Agenda"). */
  fold?: string;
  /** What the Subject line is called ("Title" for an event). */
  subjectLabel?: string;
  /** What it says, as Markdown. */
  body: string;
  /** The act has been edited by the person: the card says so. */
  edited?: boolean;
  /** waiting: held; sent and dropped: answered. */
  state: "waiting" | "sent" | "dropped";
  /** The line an answered card reads: "Sent to Aliza · 04:38". */
  doneLine?: string | undefined;
  /** Whether Edit is offered. */
  editable: boolean;
  /** The To line is editable too (a send in Chrome: the page's own field). */
  editTo?: boolean;
  /** Subject is editable (email, Chrome). */
  editSubject?: boolean;
  sendLabel?: string;
  dropLabel?: string;
  /** "Scout stopped before Send". */
  stoppedNote?: string | undefined;
  onSend(): Promise<void>;
  onSave?(saved: HeldSaved): Promise<void>;
  onDrop(reason: string): Promise<void>;
  /** A quiet item in the card's "..." menu: always let this agent do this (its words, e.g. "Always let Dex message Aliza"). Pressing it keeps the rule and sends. */
  alwaysLabel?: string;
  onAlways?: () => Promise<void>;
  /** The editor the body turns into. The shared MarkdownEditor unless a test or a screenshot puts its own in (a browser's TipTap cannot be typed into under test). */
  editor?: HeldEditor;
}

export type HeldEditor = (p: { value: string; onChange: (markdown: string) => void; label: string }) => ReactElement;
const SharedEditor: HeldEditor = ({ value, onChange, label }) => <MarkdownEditor value={value} onChange={onChange} label={label} bare minHeight={120} autoFocus />;

/** How many lines of the body show before "Show all". */
export const BODY_LINES = 12;
const LINE_PX = 20;
const COLS = 88;

/** Roughly how many lines this Markdown takes: its own lines, and long lines as they wrap. */
export function linesOf(markdown: string): number {
  return markdown.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / COLS)), 0);
}

export function HeldCard(p: HeldCardProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ body: p.body, subject: p.subject ?? "", to: p.to.map((r) => r.name).join(", ") });
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const [agenda, setAgenda] = useState(false);
  const [done, setDone] = useState<"sent" | "dropped" | null>(null);
  const state = done ?? p.state;
  const long = linesOf(p.body) > BODY_LINES;
  const run = (f: () => Promise<void>, after?: () => void): void => {
    setBusy(true); setError("");
    f().then(() => { setBusy(false); after?.(); }, (e: unknown) => { setBusy(false); setError(e instanceof Error && e.message ? e.message : "That did not work. Try again."); });
  };
  const faces = p.to.slice(0, 2);
  const title = `${p.agent} wants to ${p.verb}`;

  if (state !== "waiting") {
    return (
      <View testID={p.testID} style={st.done} accessibilityRole="text">
        <Glyph name={state === "sent" ? "check" : "x"} size={13} color={state === "sent" ? "var(--ok)" : "var(--ink-3)"} />
        <Text style={st.doneText} testID={`${p.testID}-done`}>{state === "sent" ? (p.state === "dropped" ? "Sent" : p.doneLine ?? "Sent") : (p.state === "dropped" ? p.doneLine ?? "Not sent" : "Not sent")}</Text>
      </View>
    );
  }
  return (
    <View testID={p.testID} style={st.card} accessibilityRole="summary" accessibilityLabel={title}>
      <View style={st.head}>
        {faces.length > 0 ? <View style={st.faces}>{faces.map((r, i) => <View key={`${r.seed}${i}`} style={i > 0 ? st.faceNext : undefined}><Face name={r.name} seedId={r.seed} kind={r.kind ?? "person"} size={22} /></View>)}</View> : null}
        <View style={st.titles}>
          <Text style={st.title} numberOfLines={2}>{title}</Text>
          {p.schedule ? <Text style={st.sub} testID={`${p.testID}-schedule`}>{p.schedule}</Text> : null}
        </View>
        {p.edited ? <Text style={st.edited} testID={`${p.testID}-edited`}>Edited by you</Text> : null}
        {p.onAlways && p.alwaysLabel && !editing && !denying ? <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => setMenu((m) => !m)} testID={`${p.testID}-more`}><Text style={st.more}>...</Text></Pressable> : null}
      </View>
      {menu && p.onAlways && p.alwaysLabel && !editing && !denying ? (
        <View style={st.menu}><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setMenu(false); void run(() => p.onAlways!(), () => setDone("sent")); }} testID={`${p.testID}-always`}><Text style={st.menuItem}>{p.alwaysLabel}</Text></Pressable></View>
      ) : null}
      <View style={st.rows}>
        {editing && p.editTo ? (
          <View style={st.row}><Text style={st.label}>To</Text><TextInput accessibilityLabel="To" testID={`${p.testID}-to`} value={draft.to} onChangeText={(v) => setDraft((d) => ({ ...d, to: v }))} style={st.input} /></View>
        ) : null}
        {editing && p.editSubject ? (
          <View style={st.row}><Text style={st.label}>{p.subjectLabel ?? "Subject"}</Text><TextInput accessibilityLabel={p.subjectLabel ?? "Subject"} testID={`${p.testID}-subject`} value={draft.subject} onChangeText={(v) => setDraft((d) => ({ ...d, subject: v }))} style={st.input} /></View>
        ) : p.subject ? <View style={st.row}><Text style={st.label}>{p.subjectLabel ?? "Subject"}</Text><Text style={[st.value, p.subjectLabel ? st.strong : undefined]} testID={`${p.testID}-subject-text`}>{p.subject}</Text></View> : null}
        {!editing ? (p.fields ?? []).flatMap(([label, text]) => [
          <View key={label} style={st.row}><Text style={st.label}>{label}</Text>{(p.fieldMd ?? []).includes(label) ? <View style={{ flex: 1 }}><MarkdownText text={text} /></View> : <Text style={st.value} testID={`${p.testID}-field-${label.toLowerCase()}`}>{text}</Text>}</View>,
          ...(label === "When" && p.invitees && (p.invitees.length > 0 || p.inviteNote) ? [<View key="who" style={st.row} testID={`${p.testID}-invitees`}><Text style={st.label}>Who</Text><View style={st.guests}>{p.invitees.slice(0, 8).map((g, i) => <View key={`${g.seed}${i}`} style={st.guest}><Face name={g.name} seedId={g.seed} kind="person" size={18} /><Text style={st.value}>{g.name}</Text></View>)}{p.invitees.length > 8 ? <Text style={st.sub}>{`and ${p.invitees.length - 8} more`}</Text> : null}{p.inviteNote ? <Text style={st.sub} testID={`${p.testID}-invite-note`}>{p.inviteNote}</Text> : null}</View></View>] : []),
        ]) : null}
      </View>
      {editing ? (
        <View style={st.editor} testID={`${p.testID}-editor`}>
          {(p.editor ?? SharedEditor)({ value: draft.body, onChange: (md) => setDraft((d) => ({ ...d, body: md })), label: p.fold ? "Edit the agenda" : "Edit the message" })}
          <View style={st.acts}>
            <TextButton label="Cancel" onPress={() => { setEditing(false); setError(""); setDraft({ body: p.body, subject: p.subject ?? "", to: p.to.map((r) => r.name).join(", ") }); }} disabled={busy} testID={`${p.testID}-cancel`} />
            <TextButton label="Save" primary disabled={busy || draft.body.trim() === ""} onPress={() => run(() => (p.onSave ? p.onSave({ body: draft.body, ...(p.editSubject ? { subject: draft.subject } : {}), ...(p.editTo ? { to: draft.to } : {}) }) : Promise.resolve()), () => setEditing(false))} testID={`${p.testID}-save`} />
          </View>
        </View>
      ) : (
        p.fold && p.body.trim() === "" ? null : p.fold && !agenda ? (
          <Pressable accessibilityRole="button" onPress={() => setAgenda(true)} testID={`${p.testID}-fold`}><Text style={st.link}>{`${p.fold}  ›`}</Text></Pressable>
        ) : <View>
          {p.fold ? <Pressable accessibilityRole="button" onPress={() => setAgenda(false)}><Text style={st.link}>{`${p.fold}  ⌄`}</Text></Pressable> : null}
          <View testID={`${p.testID}-body`} style={[st.body, long && !all && { maxHeight: BODY_LINES * LINE_PX, overflow: "hidden" }]}><MarkdownText text={p.body} /></View>
          {long ? <Pressable accessibilityRole="button" onPress={() => setAll((x) => !x)} testID={`${p.testID}-all`}><Text style={st.link}>{all ? "Show less" : "Show all"}</Text></Pressable> : null}
        </View>
      )}
      {denying ? (
        <View style={st.deny}>
          <TextInput accessibilityLabel="Why not (optional)" testID={`${p.testID}-reason`} value={reason} onChangeText={setReason} placeholder="Reason (optional)" placeholderTextColor="var(--ink-4)" multiline style={st.reasonInput} />
          <View style={st.acts}>
            <TextButton label="Back" onPress={() => setDenying(false)} disabled={busy} testID={`${p.testID}-back`} />
            <TextButton label={p.dropLabel ?? "Don't send"} danger disabled={busy} onPress={() => run(() => p.onDrop(reason.trim()), () => setDone("dropped"))} testID={`${p.testID}-drop-go`} />
          </View>
        </View>
      ) : !editing ? (
        <View style={st.foot}>
          <View style={st.acts}>
            <TextButton label={p.sendLabel ?? "Send"} primary icon="check" disabled={busy} onPress={() => run(p.onSend, () => setDone("sent"))} testID={`${p.testID}-send`} />
            {p.editable ? <TextButton label="Edit" ring icon="edit" disabled={busy} onPress={() => { setDraft({ body: p.body, subject: p.subject ?? "", to: p.to.map((r) => r.name).join(", ") }); setEditing(true); }} testID={`${p.testID}-edit`} /> : null}
            <TextButton label={p.dropLabel ?? "Don't send"} disabled={busy} onPress={() => setDenying(true)} testID={`${p.testID}-drop`} />
          </View>
          {p.stoppedNote ? <Text style={st.sub}>{p.stoppedNote}</Text> : null}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={st.error} testID={`${p.testID}-error`}>{error}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 8, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, maxWidth: 666, alignSelf: "stretch" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  faces: { flexDirection: "row", alignItems: "center" },
  faceNext: { marginLeft: -6 },
  titles: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  strong: { fontWeight: "600" },
  guests: { flex: 1, gap: 4 },
  guest: { flexDirection: "row", alignItems: "center", gap: 6 },
  edited: { fontSize: 12, color: "var(--ink-3)" as string },
  more: { fontSize: 16, color: "var(--ink-3)" as string, paddingHorizontal: 6, letterSpacing: 1 },
  menu: { alignSelf: "flex-end", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  menuItem: { fontSize: 13, color: "var(--ink-2)" as string },
  rows: { gap: 6 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  label: { width: 60, fontSize: 12, color: "var(--ink-3)" as string },
  value: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  input: { flex: 1, minWidth: 0, minHeight: 30, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, paddingHorizontal: 9, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string, fontSize: 13 },
  body: { padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string, paddingTop: 4 },
  editor: { gap: 8 },
  deny: { gap: 8 },
  reasonInput: { minHeight: 56, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, fontSize: 13, color: "var(--ink)" as string },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  acts: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  done: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  doneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
