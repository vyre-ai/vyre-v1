// Starter automations. Each card is a real definition built from catalogue steps. "Use template" makes a Personal draft and opens it.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import type { AutomationsData } from "../canvas/data.tsx";
import { pointer } from "../canvas/parts.tsx";
import { TEMPLATES_LINE } from "../chrome.ts";
import { templatesOf } from "./read.ts";
import type { TemplateItem } from "./read.ts";
import { Frame, Row, Status, useCall, useRowMenu, v } from "./parts.tsx";

/** Make the draft from a template and open it. Returns the new automation's id. */
export async function startFromTemplate(data: Pick<AutomationsData, "call" | "nav">, key: string): Promise<string | null> {
  const out = await data.call("automations.templates.use", { templateKey: key }) as { automation?: { id?: string } };
  const id = out?.automation?.id ?? null;
  if (id) data.nav.openAutomation(id);
  return id;
}

export function templateMenu(open: boolean, on: { toggle(): void; use(): void }): MenuEntry[] {
  return [{ label: "Use template", onSelect: on.use }, { label: open ? "Hide the steps" : "Show the steps", onSelect: on.toggle }];
}

/** The gallery rows. Pressing a row shows its steps and what to set up; Use template makes the draft. */
export function TemplateList({ templates, open, busy, onToggle, onUse }: {
  templates: readonly TemplateItem[]; open: string | null; busy: boolean; onToggle(key: string): void; onUse(t: TemplateItem): void;
}): ReactElement {
  const rm = useRowMenu();
  return (
    <View testID="template-list" style={v.list}>
      {rm.element}
      {templates.flatMap((t) => {
        const isOpen = open === t.key;
        const row = (
          <Row
            key={t.key} id={`template-${t.key}`} title={t.title} note={t.summary} selected={isOpen} trailing={(
              <View style={v.trail}>
                <Text numberOfLines={1} style={v.right}>{t.starts}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Use template ${t.title}`} accessibilityState={{ disabled: busy }} disabled={busy} testID={`use-${t.key}`} onPress={() => onUse(t)} style={[v.btnPrimary, pointer]}>
                  <Text style={v.btnPrimaryText}>Use template</Text>
                </Pressable>
              </View>
            )} onPress={() => onToggle(t.key)}
            domProps={{ "aria-label": `${t.title}. ${t.summary} ${isOpen ? "Hide" : "Show"} the steps`, ...rm.rowDom(t.title, () => templateMenu(isOpen, { toggle: () => onToggle(t.key), use: () => onUse(t) })) }}
          />
        );
        if (!isOpen) return [row];
        return [row, (
          <View key={`detail-${t.key}`} testID={`template-detail-${t.key}`} style={[v.detail, { marginLeft: 12 }]}>
            <Text style={v.section}>Steps</Text>
            {/* ui-rows-lint: not a list (one numbered sentence per step) */}
            {t.steps.map((st, i) => <Text key={st.id} style={v.row}>{`${i + 1}. ${st.title}`}</Text>)}
            <Text style={v.section}>Before you turn it on</Text>
            {/* ui-rows-lint: not a list (one sentence per thing to set up) */}
            {t.setUp.map((line) => <Text key={line} style={v.dim}>{line}</Text>)}
          </View>
        )];
      })}
    </View>
  );
}

export function TemplateGallery(): ReactElement {
  const data = useAutomationsData();
  const state = useCall("automations.templates.list", {}, templatesOf);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function use(t: TemplateItem): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await startFromTemplate(data, t.key);
    } catch (e) { setNote(e instanceof Error ? e.message : "That template was not used."); } finally { setBusy(false); }
  }
  return (
    <Frame testID="templates" title="Templates" line={TEMPLATES_LINE}>
      <Status state={state} />
      {state.phase === "ready" ? <TemplateList templates={state.value} open={open} busy={busy} onToggle={(k) => setOpen(open === k ? null : k)} onUse={(t) => void use(t)} /> : null}
      {note ? <Text style={v.err} accessibilityRole="alert">{note}</Text> : null}
    </Frame>
  );
}
