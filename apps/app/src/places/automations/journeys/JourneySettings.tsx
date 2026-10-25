// The Settings tab of a Journey (spec 2.12): the record type and its Subject, when a record starts one, the name, moving in-flight records to the current version, and deleting the
// Journey type (its records stay in Records as plain records). People without the Design Journeys role do not see this tab. Changes save as they are made, with Undo where there is a way back.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton, webOnly } from "../canvas/parts.tsx";
import type { KeyEventLike } from "../canvas/parts.tsx";
import { useConfigExtras } from "../config/data.tsx";
import { Overlay } from "../config/Overlay.tsx";
import { Group, Hint, Lab, SRow, Switch } from "../config/parts.tsx";
import type { Design } from "./data.ts";
import { MigrateSheet } from "./MigrateSheet.tsx";
import { plural, startRuleWords } from "./model.ts";
import type { Journey } from "./model.ts";

export function JourneySettings({ journey: j, versions, design }: { journey: Journey; versions: readonly { versionId: string; n: number }[]; design: Design }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const [name, setName] = useState(j.name);
  const [confirm, setConfirm] = useState(false);
  const [migrate, setMigrate] = useState(false);
  const rule = j.startRule;
  const commit = (): void => { void design.rename(name).then((ok) => { if (!ok) setName(j.name); }); };
  const del = (): void => { void design.saved.run(`Deleted ${j.name}`, async () => { await data.call("journeys.delete", { journeyId: j.id }); }); };

  return (
    <View testID="journey-settings" accessibilityLabel="Journey settings" style={t.body}>
      <Lab first>Record type</Lab>
      <Group testID="record-type">
        <SRow label={j.recordType} sub="Its records live in Records." minHeight={48}><TextButton label="Open in Records" icon="open" testID="settings-open-records" onPress={() => extras.openRecords?.(j.recordType)} /></SRow>
        <SRow label="Subject" sub="The record each one follows, a relation to a record type" minHeight={48} last><Text testID="subject" style={t.value}>{j.subjectType}</Text></SRow>
      </Group>

      <Lab>Starts when</Lab>
      <Group testID="start-rule">
        <SRow label="The start rule" sub={startRuleWords(rule)} minHeight={48} last>
          {rule ? <Switch on={rule.enabled} label="Start rule on" testID="rule-enabled" onChange={(v) => void design.design(j.stages, v ? "Records start on their own" : "Records are added by hand", { ...rule, enabled: v })} /> : null}
        </SRow>
      </Group>
      <Hint>Without a start rule, records are added by hand.</Hint>

      <Lab>Name</Lab>
      <Group testID="name">
        <SRow minHeight={44} last>
          <TextInput
            accessibilityLabel="Journey name" testID="journey-name" value={name} onChangeText={setName} onBlur={commit} onSubmitEditing={commit}
            {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Escape") { setName(j.name); e.stopPropagation?.(); } } })}
            style={t.input}
          />
        </SRow>
      </Group>

      {j.version > 1 && versions.length > 1 ? (
        <>
          <Lab>Versions</Lab>
          <Group testID="versions">
            <SRow label={`Move records to version ${j.version}`} sub="Records stay on the version they started on until you move them. You see where each one goes first." minHeight={56} last>
              <TextButton label="Preview…" testID="migrate" onPress={() => setMigrate(true)} />
            </SRow>
          </Group>
        </>
      ) : null}

      <Lab>Danger</Lab>
      <Group testID="danger">
        <SRow label="Delete this Journey type" sub={`${plural(j.inFlight, "record")} stay in Records as plain records`} minHeight={48} last>
          {confirm ? (
            <View style={t.confirm}><Text style={t.confirmText}>Delete it?</Text><TextButton label="Delete" testID="confirm-delete-journey" onPress={del} /><TextButton label="Cancel" testID="cancel-delete-journey" onPress={() => setConfirm(false)} /></View>
          ) : <TextButton label="Delete…" icon="trash" testID="delete-journey" onPress={() => setConfirm(true)} />}
        </SRow>
      </Group>
      {migrate ? <Overlay label="Move records to the current version" onClose={() => setMigrate(false)} testID="migrate-overlay"><MigrateSheet journey={j} onClose={() => setMigrate(false)} /></Overlay> : null}
    </View>
  );
}

const t = StyleSheet.create({
  body: { paddingBottom: 24 },
  value: { fontSize: 13, color: "var(--ink-2)" as string },
  input: { flex: 1, height: 30, borderRadius: 7, paddingHorizontal: 8, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--hover)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  confirm: { flexDirection: "row", alignItems: "center", gap: 6 },
  confirmText: { fontSize: 12.5, color: "var(--ink-2)" as string },
});
