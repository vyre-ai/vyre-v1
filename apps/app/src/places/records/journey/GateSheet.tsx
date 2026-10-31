// The sheet a refused stage move opens: the fields the stage is waiting on, each with its input. Fill them and "Save and move" writes them and moves the record in one step.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { TextButton } from "../typeedit/parts.tsx";
import { editKind } from "../recordpage/model.ts";
import { optionsOf } from "../table/model.ts";
import type { RecordRow, TypeDef } from "../table/model.ts";
import { fillAndMove } from "./model.ts";
import type { Call, Entered, MissingField } from "./model.ts";

export interface GateSheetProps {
  call: Call;
  journeyId: string;
  type: string;
  def: Pick<TypeDef, "fields">;
  row: RecordRow;
  toStage: string;
  /** The title of the stage the record is going to. */
  stageTitle: string;
  missing: readonly MissingField[];
  onDone(): void;
  onClose(): void;
}

export function GateSheet({ call, journeyId, type, def, row, toStage, stageTitle, missing: first, onDone, onClose }: GateSheetProps): ReactElement {
  const [missing, setMissing] = useState(first);
  const [entered, setEntered] = useState<Entered>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const put = (key: string, v: string | boolean): void => { setEntered((e) => ({ ...e, [key]: v })); setError(null); };
  const save = (): void => {
    if (busy) return;
    setBusy(true); setError(null);
    fillAndMove(call, { journeyId, type, row, def, missing, entered, toStage }).then((r) => {
      if (r.ok) { onDone(); return; }
      setError(r.message);
      if (r.missing) setMissing(r.missing);
    }).finally(() => setBusy(false));
  };
  const rows: ReactElement[] = [];
  for (const m of missing) {
    const f = def.fields.find((x) => x.key === m.key);
    const kind = f ? editKind(f) : "text";
    const mine = entered[m.key];
    const label = m.when === "leave" ? `${m.title}, needed to leave ${m.stage}` : m.title;
    rows.push(
      <View key={m.key} style={s.row} testID={`gate-field-${m.key}`}>
        <Text style={s.label}>{m.title}</Text>
        {f && kind === "choice" ? (
          <View style={s.chips} accessibilityRole="radiogroup">
            {optionsOf(f).map((o) => <TextButton key={o.key} label={o.title} selected={mine === o.key} testID={`gate-${m.key}-${o.key}`} onPress={() => put(m.key, o.key)} />)}
          </View>
        ) : kind === "checkbox" ? (
          <View style={s.chips} accessibilityRole="radiogroup">
            <TextButton label="Yes" selected={mine === true} testID={`gate-${m.key}-yes`} onPress={() => put(m.key, true)} />
            <TextButton label="No" selected={mine === false} testID={`gate-${m.key}-no`} onPress={() => put(m.key, false)} />
          </View>
        ) : (
          <TextField value={typeof mine === "string" ? mine : ""} onChangeText={(t) => put(m.key, t)} accessibilityLabel={label} testID={`gate-input-${m.key}`} placeholder={kind === "date" ? "2025-10-24" : ""} onSubmitEditing={save} />
        )}
      </View>,
    );
  }
  return (
    <Dialog
      title={`Before it moves to ${stageTitle}`} onClose={onClose} width={460} testID="gate-sheet"
      actions={[{ label: "Cancel", onPress: onClose, testID: "gate-cancel" }, { label: busy ? "Saving" : "Save and move", primary: true, disabled: busy, onPress: save, testID: "gate-save" }]}
    >
      <Text style={s.lead}>{missing.length === 1 ? "One field needs an answer." : `${missing.length} fields need an answer.`}</Text>
      <View style={s.list}>{rows}</View>
      {error ? <Text style={s.error} accessibilityRole="alert" testID="gate-error">{error}</Text> : null}
    </Dialog>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 13, color: "var(--ink-2)" as string, marginBottom: 10 },
  list: { gap: 12 },
  row: { gap: 5 },
  label: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  error: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 10 },
});
