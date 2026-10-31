// The Automations start page: what the body shows when no Automation is open. With none yet it is a calm, centred "Automate something" with three ways in (a template, a blank
// Automation, ask Vyre) and a few popular templates from the same catalogue the Templates page reads. With some, the heading is "Pick an automation" and the three ways in are smaller.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAutomationsData, useScreenQuery, SIDEBAR } from "../canvas/data.tsx";
import { Glyph } from "../canvas/icons.tsx";
import type { GlyphName } from "../canvas/icons.tsx";
import { pointer } from "../canvas/parts.tsx";
import { templatesOf } from "../operations/read.ts";
import type { TemplateItem } from "../operations/read.ts";
import { startFromTemplate } from "../operations/TemplateGallery.tsx";
import { useCall } from "../operations/parts.tsx";

export const POPULAR_COUNT = 6;

export type StartChoice = "template" | "blank" | "ask";

export interface StartChoiceDef { key: StartChoice; title: string; line: string; icon: GlyphName }

export const START_CHOICES: readonly StartChoiceDef[] = [
  { key: "template", title: "Start from a template", line: "A working automation you adjust.", icon: "flask" },
  { key: "blank", title: "Blank automation", line: "Build it step by step.", icon: "plus" },
  { key: "ask", title: "Ask Vyre to build it", line: "Say what you want. Vyre drafts it.", icon: "sparkle" },
];

/** The icon a template tile wears, from its first step. */
export function templateGlyph(t: Pick<TemplateItem, "steps">): GlyphName {
  const first = t.steps[0]?.key ?? "";
  if (first.includes("mail")) return "mail";
  if (first.includes("sms") || first.includes("phone")) return "phone";
  if (first === "ai") return "ai";
  if (first.startsWith("wait")) return "clock";
  if (first.startsWith("records")) return "record";
  return "bolt";
}

/** The first few templates of the catalogue, in the catalogue's order. */
export function popularTemplates(all: readonly TemplateItem[] | null): TemplateItem[] {
  return (all ?? []).slice(0, POPULAR_COUNT);
}

export interface StartViewProps {
  /** True when the person already has Automations: the heading becomes "Pick an automation" and the choices shrink. */
  hasAutomations: boolean;
  templates: readonly TemplateItem[] | null;
  busy?: boolean;
  note?: string | null;
  onChoose(choice: StartChoice): void;
  onUseTemplate(t: TemplateItem): void;
}

/** The page itself, with no data of its own. */
export function AutomationsStartView({ hasAutomations, templates, busy = false, note = null, onChoose, onUseTemplate }: StartViewProps): ReactElement {
  const tiles = hasAutomations ? [] : popularTemplates(templates);
  return (
    <ScrollView testID="automations-start" style={s.scroll} contentContainerStyle={s.center} accessibilityLabel={hasAutomations ? "Pick an automation" : "Automate something"}>
      <View style={s.column}>
        <Text accessibilityRole="header" testID="automations-start-title" style={s.title}>{hasAutomations ? "Pick an automation" : "Automate something"}</Text>
        {hasAutomations ? <Text style={s.sub}>Choose one from the list, or start a new one.</Text> : <Text style={s.sub}>Pick a way to begin. You can change everything afterwards.</Text>}
        <View style={[s.choices, hasAutomations && s.choicesSmall]} testID="automations-start-choices">
          {/* ui-rows-lint: not a list (three start choice cards side by side) */}
          {START_CHOICES.map((c) => (
            <Pressable
              key={c.key} accessibilityRole="button" accessibilityLabel={c.title} accessibilityState={{ disabled: busy }} disabled={busy}
              testID={`start-${c.key}`} onPress={() => onChoose(c.key)} style={[s.card, hasAutomations && s.cardSmall, pointer]}
            >
              <View style={[s.iconTile, hasAutomations && s.iconTileSmall]}><Glyph name={c.icon} size={hasAutomations ? 14 : 20} color="var(--accent)" /></View>
              <Text style={[s.cardTitle, hasAutomations && s.cardTitleSmall]}>{c.title}</Text>
              {hasAutomations ? null : <Text style={s.cardLine}>{c.line}</Text>}
            </Pressable>
          ))}
        </View>
        {tiles.length > 0 ? (
          <View style={s.popular} testID="automations-start-popular">
            <Text accessibilityRole="header" style={s.popHead}>Popular templates</Text>
            <View style={s.tiles}>
              {/* ui-rows-lint: not a list (template tiles in a wrapping grid) */}
              {tiles.map((t) => (
                <Pressable
                  key={t.key} accessibilityRole="button" accessibilityLabel={`${t.title}. ${t.summary}`} accessibilityState={{ disabled: busy }} disabled={busy}
                  testID={`start-template-${t.key}`} onPress={() => onUseTemplate(t)} style={[s.tile, pointer]}
                >
                  <Glyph name={templateGlyph(t)} size={15} color="var(--ink-3)" />
                  <View style={s.tileText}>
                    <Text numberOfLines={1} style={s.tileTitle}>{t.title}</Text>
                    {t.summary ? <Text numberOfLines={2} style={s.tileLine}>{t.summary}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {note ? <Text accessibilityRole="alert" testID="automations-start-note" style={s.note}>{note}</Text> : null}
      </View>
    </ScrollView>
  );
}

/** The start page wired to the place: the catalogue, the list, and what each choice does. `onAsk` opens the assistant in the tab; the shell supplies it. */
export function AutomationsStart({ onTemplates, onAsk }: { onTemplates(): void; onAsk(): void }): ReactElement {
  const data = useAutomationsData();
  const list = useScreenQuery<{ automations: readonly unknown[] }>(SIDEBAR, "automations", {});
  const catalog = useCall("automations.templates.list", {}, templatesOf);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try { await work(); } catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  };
  const choose = (c: StartChoice): void => {
    if (c === "template") onTemplates();
    else if (c === "ask") onAsk();
    else void run(async () => {
      const out = (await data.call("automations.create", { name: "New automation" })) as { automation?: { id?: string } };
      if (out?.automation?.id) data.nav.openAutomation(out.automation.id);
    });
  };
  return (
    <AutomationsStartView
      hasAutomations={list.status === "ready" && list.data.automations.length > 0}
      templates={catalog.phase === "ready" ? catalog.value : null}
      busy={busy} note={note} onChoose={choose}
      onUseTemplate={(t) => void run(() => startFromTemplate(data, t.key))}
    />
  );
}

export const START_STYLE = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "var(--win)" as string },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  column: { width: "100%", maxWidth: 720, alignItems: "center", gap: 14 },
  title: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as string, textAlign: "center" },
  sub: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-3)" as string, textAlign: "center", marginBottom: 6 },
  choices: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  choicesSmall: { gap: 8 },
  card: { flexGrow: 1, flexBasis: 180, maxWidth: 230, minHeight: 124, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, gap: 8, alignItems: "flex-start" },
  cardSmall: { flexGrow: 0, flexBasis: "auto", minHeight: 0, flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, gap: 8 },
  iconTile: { width: 36, height: 36, borderRadius: 10, backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center" },
  iconTileSmall: { width: 24, height: 24, borderRadius: 7 },
  cardTitle: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  cardTitleSmall: { fontSize: 13, fontWeight: "500" },
  cardLine: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  popular: { width: "100%", marginTop: 18, gap: 10 },
  popHead: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string, textAlign: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  tile: { flexGrow: 1, flexBasis: 200, maxWidth: 230, flexDirection: "row", gap: 10, padding: 10, borderRadius: 10, backgroundColor: "var(--hover)" as string, alignItems: "flex-start" },
  tileText: { flex: 1, minWidth: 0, gap: 2 },
  tileTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  tileLine: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  note: { fontSize: 13, color: "var(--danger)" as string, textAlign: "center" },
});
const s = START_STYLE;
