// The one card for every held outward act: a message to a person, an email, a text, a post in a channel, and a send in the person's own Chrome (lane l-chrome2a, owner bug rc.20).
//   Header   the recipient's avatar and name and the channel in plain words ("Dex wants to message Aliza Rizvi"), and, only when it does not go now, when ("Sends at 9:00").
//   Body     what it says, drawn by the chat's own block renderer (bold, lists, links), in full; past about twelve lines it is cut with "Show all".
//   Edit     the body becomes the shared MarkdownEditor in place, with Save and Cancel. Saving keeps it held and the card says "Edited by you".
//   Buttons  Deny, Edit, then Allow (primary, it sends, right-most, the Card library's order): the one approval vocabulary (Allow, Always allow, Deny). Deny asks for a reason, optional, that goes back to the agent. After Allow the card reads
//            "Sent to Aliza · 04:38", after Deny "Not sent".
// It knows nothing of the Gate or of Chrome: the caller says what Allow, Save and Deny do. No internal field name is ever drawn.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, CardActions, CardDeny, CardDone, CardField, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import { MarkdownEditor } from "../../../../../../ui/src/RichEditor/MarkdownEditor.tsx";
import { MarkdownText } from "../../../../../../ui/src/stream/MarkdownText.tsx";
import { Face } from "../needsyou/parts.tsx";
import { Glyph } from "./parts.tsx";

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
  /** The header words when "<agent> wants to <verb>" is not what the surface says ("Intake drafted a reply"). */
  title?: string;
  /** The text this replaced, one click away: "Show the earlier draft". */
  earlier?: { text: string };
  /** Labels of `fields` whose text is Markdown (a link). */
  fieldMd?: readonly string[];
  /** The face in the header when it is not the recipient's: the agent that wrote the draft. */
  headFace?: { name: string; seed: string; kind: "agent" | "person" };
  /** Who it goes to, as faces and names, above the subject: "To", and "Cc" when there is one. The recipient must be seen before Send. */
  peopleRows?: ReadonlyArray<{ label: string; people: ReadonlyArray<{ name: string; seed: string; /** under the name: the number or address it goes to */ sub?: string }> }>;
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
  /** "Scout stopped before Send". */
  stoppedNote?: string | undefined;
  onSend(): Promise<void>;
  onSave?(saved: HeldSaved): Promise<void>;
  onDrop(reason: string): Promise<void>;
  /** A quiet item in the card's "..." menu: always let this agent do this (its words, e.g. "Always allow Dex to message Aliza"). Pressing it keeps the rule and sends. */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [agenda, setAgenda] = useState(false);
  const [done, setDone] = useState<"sent" | "dropped" | null>(null);
  const state = done ?? p.state;
  const long = linesOf(p.body) > BODY_LINES;
  const run = (f: () => Promise<void>, after?: () => void): void => {
    setBusy(true); setError("");
    f().then(() => { setBusy(false); after?.(); }, (e: unknown) => { setBusy(false); setError(e instanceof Error && e.message ? e.message : "That did not work. Try again."); });
  };
  const faces = p.headFace ? [p.headFace] : p.to.slice(0, 2);
  const title = p.title ?? `${p.agent} wants to ${p.verb}`;

  if (state !== "waiting") {
    return (
      <CardDone testID={p.testID} ok={state === "sent"} glyph={<Glyph name={state === "sent" ? "check" : "x"} size={13} color={state === "sent" ? "var(--ok)" : "var(--ink-3)"} />} text={state === "sent" ? (p.state === "dropped" ? "Sent" : p.doneLine ?? "Sent") : (p.state === "dropped" ? p.doneLine ?? "Not sent" : "Not sent")} />
    );
  }
  const reset = (): void => { setEditing(false); setError(""); setDraft({ body: p.body, subject: p.subject ?? "", to: p.to.map((r) => r.name).join(", ") }); };
  const save = (): void => { if (busy || draft.body.trim() === "") return; run(() => (p.onSave ? p.onSave({ body: draft.body, ...(p.editSubject ? { subject: draft.subject } : {}), ...(p.editTo ? { to: draft.to } : {}) }) : Promise.resolve()), () => setEditing(false)); };
  return (
    <Card kind="decision" testID={p.testID} label={title} onCancel={editing ? reset : denying ? () => setDenying(false) : undefined} {...(editing && (p.editTo || p.editSubject) ? { onEnter: save } : {})}>
      <CardHead
        title={title} {...(p.schedule ? { meta: p.schedule, metaTestID: `${p.testID}-schedule` } : {})}
        lead={faces.length > 0 ? (
          // ui-rows-lint: not a list (the faces of who it goes to)
          <View style={st.faces}>{faces.map((r, i) => <View key={`${r.seed}${i}`} style={i > 0 ? st.faceNext : undefined}><Face name={r.name} seedId={r.seed} kind={r.kind ?? "person"} size={22} /></View>)}</View>
        ) : undefined}
        trailing={<>
          {p.edited ? <Text style={st.edited} testID={`${p.testID}-edited`}>Edited by you</Text> : null}
          {p.onAlways && p.alwaysLabel && !editing && !denying ? <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => setMenu((m) => !m)} testID={`${p.testID}-more`}><Text style={st.more}>...</Text></Pressable> : null}
        </>}
      />
      {menu && p.onAlways && p.alwaysLabel && !editing && !denying ? (
        <View style={st.menu}><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setMenu(false); void run(() => p.onAlways!(), () => setDone("sent")); }} testID={`${p.testID}-always`}><Text style={st.menuItem}>{p.alwaysLabel}</Text></Pressable></View>
      ) : null}
      <View style={st.rows}>
        {(p.peopleRows ?? []).filter((r) => r.people.length > 0).map((r) => (
          // ui-rows-lint: not a list (the people a message goes to, faces with names in one line)
          <View key={r.label} style={st.row} testID={`${p.testID}-people-${r.label.toLowerCase()}`}><Text style={st.label}>{r.label}</Text><View style={st.guests}>{r.people.slice(0, 6).map((g, i) => <View key={`${g.seed}${i}`} style={st.guest}><Face name={g.name} seedId={g.seed} kind="person" size={g.sub ? 24 : 18} /><View><Text style={st.value}>{g.name}</Text>{g.sub ? <Text style={st.sub}>{g.sub}</Text> : null}</View></View>)}{r.people.length > 6 ? <Text style={st.sub}>{`and ${r.people.length - 6} more`}</Text> : null}</View></View>
        ))}
        {editing && p.editTo ? <CardField label="To" testID={`${p.testID}-to`} value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} /> : null}
        {editing && p.editSubject ? <CardField label={p.subjectLabel ?? "Subject"} testID={`${p.testID}-subject`} value={draft.subject} onChange={(v) => setDraft((d) => ({ ...d, subject: v }))} />
        : p.subject ? <View style={st.row}><Text style={st.label}>{p.subjectLabel ?? "Subject"}</Text><Text style={[st.value, p.subjectLabel ? st.strong : undefined]} testID={`${p.testID}-subject-text`}>{p.subject}</Text></View> : null}
        {!editing ? (p.fields ?? []).flatMap(([label, text]) => [
          <View key={label} style={st.row}><Text style={st.label}>{label}</Text>{(p.fieldMd ?? []).includes(label) ? <View style={{ flex: 1 }}><MarkdownText text={text} /></View> : <Text style={st.value} testID={`${p.testID}-field-${label.toLowerCase()}`}>{text}</Text>}</View>,
          // ui-rows-lint: not a list (the invitees of an event, faces with names in one line)
          ...(label === "When" && p.invitees && (p.invitees.length > 0 || p.inviteNote) ? [<View key="who" style={st.row} testID={`${p.testID}-invitees`}><Text style={st.label}>Who</Text><View style={st.guests}>{p.invitees.slice(0, 8).map((g, i) => <View key={`${g.seed}${i}`} style={st.guest}><Face name={g.name} seedId={g.seed} kind="person" size={18} /><Text style={st.value}>{g.name}</Text></View>)}{p.invitees.length > 8 ? <Text style={st.sub}>{`and ${p.invitees.length - 8} more`}</Text> : null}{p.inviteNote ? <Text style={st.sub} testID={`${p.testID}-invite-note`}>{p.inviteNote}</Text> : null}</View></View>] : []),
        ]) : null}
      </View>
      {editing ? (
        <View style={st.editor} testID={`${p.testID}-editor`}>
          {(p.editor ?? SharedEditor)({ value: draft.body, onChange: (md) => setDraft((d) => ({ ...d, body: md })), label: p.fold ? "Edit the agenda" : "Edit the message" })}
          <CardActions busy={busy} secondary={[{ label: "Cancel", onPress: reset, testID: `${p.testID}-cancel` }]} primary={{ label: "Save", onPress: save, disabled: draft.body.trim() === "", testID: `${p.testID}-save` }} />
        </View>
      ) : (
        p.fold && p.body.trim() === "" ? null : p.fold && !agenda ? (
          <Pressable accessibilityRole="button" onPress={() => setAgenda(true)} testID={`${p.testID}-fold`}><Text style={st.link}>{`${p.fold}  \u203a`}</Text></Pressable>
        ) : <View>
          {p.fold ? <Pressable accessibilityRole="button" onPress={() => setAgenda(false)}><Text style={st.link}>{`${p.fold}  \u2304`}</Text></Pressable> : null}
          <View testID={`${p.testID}-body`} style={[st.body, long && !all && { maxHeight: BODY_LINES * LINE_PX, overflow: "hidden" }]}><MarkdownText text={p.body} /></View>
          {long ? <Pressable accessibilityRole="button" onPress={() => setAll((x) => !x)} testID={`${p.testID}-all`}><Text style={st.link}>{all ? "Show less" : "Show all"}</Text></Pressable> : null}
        </View>
      )}
      {p.earlier && !editing ? (
        <View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: earlierOpen }} onPress={() => setEarlierOpen((v) => !v)} testID={`${p.testID}-earlier`}><Text style={st.link}>{earlierOpen ? "Hide the earlier draft" : "Show the earlier draft"}</Text></Pressable>
          {earlierOpen ? <View testID={`${p.testID}-earlier-text`} style={st.body}><MarkdownText text={p.earlier.text} /></View> : null}
        </View>
      ) : null}
      {denying ? (
        <CardDeny ids={{ reason: `${p.testID}-reason`, back: `${p.testID}-back`, go: `${p.testID}-drop-go` }} busy={busy} onBack={() => setDenying(false)} onDeny={(r) => run(() => p.onDrop(r), () => setDone("dropped"))} />
      ) : !editing ? (
        <CardActions
          busy={busy}
          {...(p.stoppedNote ? { note: <Text style={st.sub} testID={`${p.testID}-stopped`}>{p.stoppedNote}</Text> } : {})}
          secondary={[...(p.editable ? [{ label: "Edit", icon: <Glyph name="edit" size={13} color="var(--ink-2)" />, onPress: () => { setDraft({ body: p.body, subject: p.subject ?? "", to: p.to.map((r) => r.name).join(", ") }); setEditing(true); }, testID: `${p.testID}-edit` }] : []), { label: "Deny", onPress: () => setDenying(true), testID: `${p.testID}-drop` }]}
          primary={{ label: "Allow", icon: <Glyph name="check" size={13} color="var(--accent-ink)" />, onPress: () => run(p.onSend, () => setDone("sent")), testID: `${p.testID}-send` }}
        />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={st.error} testID={`${p.testID}-error`}>{error}</Text> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  faces: { flexDirection: "row", alignItems: "center" },
  faceNext: { marginLeft: -6 },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  strong: { fontWeight: "600" },
  guests: { flex: 1, gap: 4 },
  guest: { flexDirection: "row", alignItems: "center", gap: 6 },
  edited: { fontSize: 12, color: "var(--ink-3)" as string },
  more: { fontSize: 16, color: "var(--ink-3)" as string, paddingHorizontal: 6, letterSpacing: 1 },
  menu: { alignSelf: "flex-end", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  menuItem: { fontSize: 13, color: "var(--ink-2)" as string },
  rows: { gap: 6 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  label: { width: 60, fontSize: 12, color: "var(--ink-3)" as string },
  value: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  body: { padding: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string, paddingTop: 4 },
  editor: { gap: 8 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
