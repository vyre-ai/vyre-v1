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
import { Frame, ListRow, Status, useCall, v } from "./parts.tsx";

/** Make the draft from a template and open it. Returns the new automation's id. */
export async function startFromTemplate(data: Pick<AutomationsData, "call" | "nav">, key: string): Promise<string | null> {
  const out = await data.call("automations.templates.use", { templateKey: key }) as { automation?: { id?: string } };
  const id = out?.automation?.id ?? null;
  if (id) data.nav.openAutomation(id);
  return id;
}

export function TemplateCard({ t, open, busy, onToggle, onUse }: { t: TemplateItem; open: boolean; busy: boolean; onToggle(): void; onUse(): void }): ReactElement {
  const menu = (): MenuEntry[] => [
    { label: "Use template", onSelect: onUse },
    { label: open ? "Hide the steps" : "Show the steps", onSelect: onToggle },
  ];
  return (
    <View testID={`template-${t.key}`} style={v.stack}>
      <ListRow testID={`template-row-${t.key}`} selected={open} label={`${t.title}. ${t.summary} ${open ? "Hide" : "Show"} the steps`} onPress={onToggle} menu={menu}>
        <View style={v.lineMain}>
          <Text style={v.strong} numberOfLines={1}>{t.title}</Text>
          <Text style={v.dim}>{t.summary}</Text>
        </View>
        <Text style={v.right}>{t.starts}</Text>
      </ListRow>
      {open ? (
        <View testID={`template-detail-${t.key}`} style={[v.detail, { marginLeft: 12 }]}>
          <Text style={v.section}>Steps</Text>
          {t.steps.map((s, i) => <Text key={s.id} style={v.row}>{`${i + 1}. ${s.title}`}</Text>)}
          <Text style={v.section}>Before you turn it on</Text>
          {t.setUp.map((line) => <Text key={line} style={v.dim}>{line}</Text>)}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} testID={`use-${t.key}`} onPress={onUse} style={[v.btnPrimary, pointer]}>
            <Text style={v.btnPrimaryText}>Use template</Text>
          </Pressable>
        </View>
      ) : null}
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
      {state.phase === "ready" ? (
        <View style={v.list}>
          {/* ui-rows-lint: TemplateCard is the row */}
          {state.value.map((t) => <TemplateCard key={t.key} t={t} open={open === t.key} busy={busy} onToggle={() => setOpen(open === t.key ? null : t.key)} onUse={() => void use(t)} />)}
        </View>
      ) : null}
      {note ? <Text style={v.err} accessibilityRole="alert">{note}</Text> : null}
    </Frame>
  );
}
