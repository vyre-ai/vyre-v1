// The pieces both setup pages are made of: a numbered step, a value with a Copy button, a link out, the status line, the service rows and the member rows.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Dot, Glyph } from "../../shell/glyphs.tsx";
import { Group, Lead, Section, pointer } from "../../shell/ui.tsx";
import { Actions, Button, Field, Select } from "../shared.tsx";
import { matchProblem, memberNote } from "./model.ts";
import type { MemberRow, ServiceRow, Summary } from "./model.ts";

/** Only addresses this module wrote can be opened; nothing a server sent. */
const SAFE = /^https:\/\/(console\.cloud\.google\.com|admin\.google\.com|entra\.microsoft\.com|learn\.microsoft\.com|login\.microsoftonline\.com)\//;
export const openable = (url: string): boolean => SAFE.test(url);

export function copyToClipboard(text: string): void {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  void clip?.writeText(text).catch(() => undefined);
}

export function CopyButton({ value, label = "Copy", testID }: { value: string; label?: string; testID?: string }): ReactElement {
  const [done, setDone] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${label} ${done ? "(copied)" : ""}`.trim()} testID={testID} style={[s.copy, pointer]}
      onPress={() => { copyToClipboard(value); setDone(true); setTimeout(() => setDone(false), 1600); }}
    >
      <Text style={s.copyText}>{done ? "Copied" : label}</Text>
    </Pressable>
  );
}

export function OpenLink({ url, label, testID }: { url: string; label: string; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} testID={testID} style={[s.link, pointer]} onPress={() => { if (openable(url)) void Linking.openURL(url); }}>
      <Text style={s.linkText}>{label}</Text>
      <Glyph name="open" size={12} color="var(--accent)" />
    </Pressable>
  );
}

/** A value to copy: the label on the left, the value in a quiet code box, the Copy button on the right. */
export function CopyRow({ label, value, note, testID }: { label: string; value: string; note?: string; testID?: string }): ReactElement {
  return (
    <View style={s.copyRow} testID={testID}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.copyLabel}>{label}</Text>
        <Text selectable style={s.code} numberOfLines={3}>{value}</Text>
        {note ? <Text style={s.noteText}>{note}</Text> : null}
      </View>
      <CopyButton value={value} label="Copy" testID={testID ? `${testID}-copy` : undefined} />
    </View>
  );
}

/** A block of text to copy whole: a PowerShell snippet. */
export function CodeBlock({ value, testID }: { value: string; testID?: string }): ReactElement {
  return (
    <View style={s.block} testID={testID}>
      <Text selectable style={s.codeBlockText}>{value}</Text>
      <View style={{ alignItems: "flex-end", marginTop: 8 }}><CopyButton value={value} label="Copy all" testID={testID ? `${testID}-copy` : undefined} /></View>
    </View>
  );
}

export type StepState = "done" | "next" | "later";

/**
 * A numbered step. A finished step keeps its place and shows a check; the first unfinished one is "next". Every step stays readable so an admin can go back and look.
 */
export function Step({ n, title, state, children, testID }: { n: number; title: string; state: StepState; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={[s.step, state === "later" && { opacity: 0.72 }]} testID={testID ?? `step-${n}`} accessibilityLabel={`Step ${n}: ${title}`}>
      <View style={[s.num, state === "done" && s.numDone, state === "next" && s.numNext]}>
        {state === "done" ? <Glyph name="check" size={14} color="var(--ok)" /> : <Text style={[s.numText, state === "next" && { color: "var(--accent)" as string }]}>{n}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" style={s.stepTitle}>{title}</Text>
        <View style={{ marginTop: 6, gap: 8 }}>{children}</View>
      </View>
    </View>
  );
}

export function Para({ children }: { children: ReactNode }): ReactElement { return <Text style={s.para}>{children}</Text>; }

export function Bullets({ items }: { items: readonly string[] }): ReactElement {
  return (
    <View style={{ gap: 3 }}>
      {/* ui-rows-lint: not a list (a few lines of instruction text, not rows of things to open) */}
      {items.map((t) => <View key={t} style={{ flexDirection: "row", gap: 8 }}><Text style={s.para}>{"•"}</Text><Text style={[s.para, { flex: 1 }]}>{t}</Text></View>)}
    </View>
  );
}

/** Where a person pastes a secret. It is emptied the moment the Vault has it; nothing here shows it again. */
export function PasteBox({ label, value, onChange, hint, testID, lines = 6 }: { label: string; value: string; onChange: (v: string) => void; hint?: string; testID?: string; lines?: number }): ReactElement {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.copyLabel}>{label}</Text>
      <TextInput
        multiline numberOfLines={lines} value={value} onChangeText={onChange} accessibilityLabel={label} testID={testID} autoCapitalize="none" autoCorrect={false} spellCheck={false}
        style={[s.paste, { minHeight: lines * 18 + 16 }]}
      />
      {hint ? <Text style={s.noteText}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({ summary, right, testID }: { summary: Summary; right?: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={s.banner} testID={testID ?? "suite-status"} accessibilityRole="summary">
      <Dot tone={summary.tone} size={9} label={summary.tone === "ok" ? "Healthy" : "Needs attention"} />
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={s.bannerTitle}>{summary.title}</Text>
        <Text style={s.bannerLine}>{summary.line}</Text>
      </View>
      {right}
    </View>
  );
}

export function Services({ rows, title = "Services" }: { rows: readonly ServiceRow[]; title?: string }): ReactElement {
  return (
    <Section title={title} count={rows.length} testID="suite-services">
      <Group>
        {rows.map((r) => (
          <Row
            key={r.key} id={r.key} title={r.title} note={r.hint}
            leading={<Lead><Dot tone={r.state === "healthy" ? "ok" : "warn"} label={r.state === "healthy" ? "Healthy" : "Degraded"} /></Lead>}
            trailing={<Text style={[s.state, { color: (r.state === "healthy" ? "var(--ink-3)" : "var(--warn)") as string }]}>{r.state === "healthy" ? "Healthy" : "Degraded"}</Text>}
          />
        ))}
      </Group>
    </Section>
  );
}

export function Members({ rows, onToggle, onUnmatch, busy }: { rows: readonly MemberRow[]; onToggle: (m: MemberRow) => void; onUnmatch?: ((m: MemberRow) => void) | undefined; busy: boolean }): ReactElement {
  return (
    <Section title="Members" count={rows.length} testID="suite-members">
      <Group>
        {rows.length === 0 ? (
          <View style={{ padding: 12 }}><Text style={s.para}>No one is matched yet. People are matched by the email their invitation went to, so someone who joined without one is not listed. The person setting this up is matched to the address they type.</Text></View>
        ) : rows.map((m) => (
          <Row
            key={m.email} id={m.email} title={m.email} note={memberNote(m)}
            leading={<Lead><Dot tone={m.excluded ? "off" : m.mapped ? "ok" : "off"} label={m.excluded ? "Excluded" : m.mapped ? "Included" : "Not matched"} /></Lead>}
            trailing={m.mapped ? <View style={{ flexDirection: "row", gap: 6 }}><Button label={m.excluded ? "Include" : "Exclude"} disabled={busy} testID={`member-toggle-${m.email}`} onPress={() => onToggle(m)} />{onUnmatch ? <Button label="Unmatch" disabled={busy} testID={`member-unmatch-${m.email}`} onPress={() => onUnmatch(m)} /> : null}</View> : undefined}
          />
        ))}
      </Group>
    </Section>
  );
}

/** "Match to…": an address that no invitation holds, matched by hand to a person in the Space. */
export function MatchPerson({ people, domain, busy, onMatch }: { people: readonly { key: string; title: string }[]; domain?: string | undefined; busy: boolean; onMatch: (email: string, userId: string) => void }): ReactElement {
  const [email, setEmail] = useState("");
  const [who, setWho] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <Section title="Match an address to a person" testID="suite-match">
      <Group>
        <View style={{ padding: 12, gap: 4 }}>
          <Para>For the owner, or anyone whose work address differs from the one their invitation went to.</Para>
          <Field label={`Work address${domain ? ` at ${domain}` : ""}`} value={email} onChange={setEmail} testID="match-email" />
          <Select label="Person" value={who} options={people} onChange={setWho} />
          {problem ? <Text style={s.noteText}>{problem}</Text> : null}
          <Actions><Button label="Match" disabled={busy} testID="match-go" onPress={() => { const p = matchProblem(email, who, domain); setProblem(p); if (!p) { onMatch(email.trim(), who); setEmail(""); } }} /></Actions>
        </View>
      </Group>
    </Section>
  );
}

export interface DirPerson { email: string; name?: string | undefined; suspended: boolean; userId?: string | undefined }
export interface Invited { email: string; link: string }

/** "Bring your team in": the directory's people, tick the ones to invite, and the links to send once a person approves. */
export function Directory({ people, picked, links, busy, onLoad, onToggle, onInvite }: {
  people: readonly DirPerson[] | null; picked: ReadonlySet<string>; links: readonly Invited[]; busy: boolean; onLoad: () => void; onToggle: (email: string) => void; onInvite: () => void;
}): ReactElement {
  return (
    <Section title="Bring your team in" count={people ? people.length : undefined} testID="suite-directory" right={<Button label={people ? "Reload the directory" : "Load the directory"} disabled={busy} testID="directory-load" onPress={onLoad} />}>
      <Group>
        {people === null ? <View style={{ padding: 12 }}><Para>Load your directory to choose who to invite. Nobody is invited until you press Invite, and each invitation is a link that is only sent after a person approves it.</Para></View> : null}
        {people === null ? null : people.map((p) => (
          <Row
            key={p.email} id={p.email} title={p.name ?? p.email} note={p.userId ? `${p.email}. Already in the Space.` : p.suspended ? `${p.email}. Suspended in your directory.` : p.email}
            leading={<Lead><Dot tone={p.userId ? "ok" : "off"} label={p.userId ? "In the Space" : "Not yet"} /></Lead>}
            trailing={p.userId || p.suspended ? undefined : <Button label={picked.has(p.email) ? "Chosen" : "Choose"} disabled={busy} testID={`directory-pick-${p.email}`} onPress={() => onToggle(p.email)} />}
          />
        ))}
      </Group>
      {people && picked.size > 0 ? <Actions><Button label={`Invite ${picked.size} ${picked.size === 1 ? "person" : "people"}`} disabled={busy} testID="directory-invite" onPress={onInvite} /></Actions> : null}
      {links.length > 0 ? (
        <View style={{ gap: 8, marginTop: 8 }} testID="directory-links">
          <Para>These invitation links are shown once. Send each only after a person approves it.</Para>
          {/* ui-rows-lint: not a list (values to copy, not rows of things to open) */}
          {links.map((l) => <CopyRow key={l.email} label={l.email} value={l.link} />)}
        </View>
      ) : null}
    </Section>
  );
}

export function StepsCard({ children }: { children: ReactNode }): ReactElement { return <View style={s.steps}>{children}</View>; }

const s = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, marginBottom: 22 },
  bannerTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  bannerLine: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 2 },
  state: { fontSize: 12.5 },
  steps: { borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, paddingHorizontal: 14, paddingVertical: 4 },
  step: { flexDirection: "row", gap: 12, paddingVertical: 14 },
  num: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numDone: { borderColor: "var(--ok)" as string },
  numNext: { borderColor: "var(--accent)" as string },
  numText: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  stepTitle: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  para: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  noteText: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 3 },
  copyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  copyLabel: { fontSize: 12, color: "var(--ink-3)" as string },
  code: { fontSize: 12.5, color: "var(--ink)" as string, marginTop: 2, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  codeBlockText: { fontSize: 12, lineHeight: 18, color: "var(--ink)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  block: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  copy: { paddingHorizontal: 10, height: 28, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, backgroundColor: "var(--raised)" as string },
  copyText: { fontSize: 12.5, color: "var(--ink)" as string },
  link: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  linkText: { fontSize: 13, fontWeight: "500", color: "var(--accent)" as string },
  paste: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, padding: 8, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textAlignVertical: "top" },
});
