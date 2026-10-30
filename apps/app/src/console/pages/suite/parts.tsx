// The pieces both setup pages are made of: a numbered step, a value with a Copy button, a link out, the status line, the service rows and the member rows.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Dot, Glyph } from "../../shell/glyphs.tsx";
import { Group, Section, pointer } from "../../shell/ui.tsx";
import { Button } from "../shared.tsx";
import { memberNote } from "./model.ts";
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
      <View style={{ flex: 1, minWidth: 0 }}>
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
            leading={<Dot tone={r.state === "healthy" ? "ok" : "warn"} label={r.state === "healthy" ? "Healthy" : "Degraded"} />}
            trailing={<Text style={[s.state, { color: (r.state === "healthy" ? "var(--ink-3)" : "var(--warn)") as string }]}>{r.state === "healthy" ? "Healthy" : "Degraded"}</Text>}
          />
        ))}
      </Group>
    </Section>
  );
}

export function Members({ rows, onToggle, busy }: { rows: readonly MemberRow[]; onToggle: (m: MemberRow) => void; busy: boolean }): ReactElement {
  return (
    <Section title="Members" count={rows.length} testID="suite-members">
      <Group>
        {rows.length === 0 ? (
          <View style={{ padding: 12 }}><Text style={s.para}>No one in your Space has an address on this domain yet. People are matched by email when they join.</Text></View>
        ) : rows.map((m) => (
          <Row
            key={m.email} id={m.email} title={m.email} note={memberNote(m)}
            leading={<Dot tone={m.excluded ? "off" : m.mapped ? "ok" : "off"} label={m.excluded ? "Excluded" : m.mapped ? "Included" : "Not matched"} />}
            trailing={m.mapped ? <Button label={m.excluded ? "Include" : "Exclude"} disabled={busy} testID={`member-toggle-${m.email}`} onPress={() => onToggle(m)} /> : undefined}
          />
        ))}
      </Group>
    </Section>
  );
}

export function StepsCard({ children }: { children: ReactNode }): ReactElement { return <View style={s.steps}>{children}</View>; }

const s = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, marginBottom: 22 },
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
