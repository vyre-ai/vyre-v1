// A Journey record's page, top: the stages as a stepper (click one to move the record there) and the subject the record follows, as a link. The regular details follow below it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLive, usePageData } from "../recordpage/data.tsx";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { optionsOf } from "../table/model.ts";
import { hueOf } from "../table/model.ts";
import { GateSheet } from "./GateSheet.tsx";
import { stagesOn } from "../typeedit/stages.ts";
import { GateError, isJourneyManaged, journeyOfType, moveInJourney, movePlain, stageFieldOf } from "./model.ts";
import type { MissingField } from "./model.ts";

/** The type the Journey's subject field points at. The schema writes it as `target`; older types wrote `to`. */
export function subjectTarget(f: FieldDef | undefined): string | null {
  const t = f?.options?.["target"] ?? f?.options?.["to"];
  return typeof t === "string" ? t : null;
}

function Subject({ field, row }: { field: FieldDef; row: RecordRow }): ReactElement | null {
  const data = usePageData();
  const target = subjectTarget(field) ?? "";
  const id = typeof row.fields[field.key] === "string" ? (row.fields[field.key] as string) : Array.isArray(row.fields[field.key]) ? String((row.fields[field.key] as unknown[])[0] ?? "") : "";
  const rq = useLive("records.get", { type: target, recordId: id });
  const dq = useLive("schema.describe", { type: target });
  if (!id || !target) return null;
  const def = dq.status === "ready" ? dq.data.types.find((t) => t.key === target) : undefined;
  const sub = rq.status === "ready" ? (rq.data.record as RecordRow | undefined) : undefined;
  const title = sub && def ? String(sub.fields[def.titleField] ?? "") || "Untitled" : "Open";
  return (
    <View style={c.subjectRow} testID="journey-subject">
      <Text style={c.subjectLabel}>{def ? `${def.title}` : "Subject"}</Text>
      <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`} testID="journey-subject-link" onPress={() => data.nav.openRecord(target, id)}>
        <Text style={c.link} numberOfLines={1}>{title}</Text>
      </Pressable>
    </View>
  );
}

export function JourneyStepper({ type, row, def }: { type: string; row: RecordRow; def: TypeDef }): ReactElement | null {
  const data = usePageData();
  const [journey, setJourney] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<{ stage: string; missing: readonly MissingField[] } | null>(null);
  useEffect(() => {
    let live = true;
    journeyOfType(data.call, type).then((j) => { if (live) setJourney(j); }).catch(() => { if (live) setJourney(null); });
    return () => { live = false; };
  }, [data, type]);
  const field = stageFieldOf(def);
  if (!field) return null;
  // a type with stages that is not a Journey moves the record by writing its stage field
  const plain = stagesOn(def) && !isJourneyManaged(field);
  const stages = optionsOf(field);
  const now = typeof row.fields[field.key] === "string" ? (row.fields[field.key] as string) : "";
  const at = stages.findIndex((s) => s.key === now);
  const subject = def.fields.find((f) => f.key === "subject" && f.type === "relation");
  const go = (stage: string): void => {
    if ((!journey && !plain) || busy || stage === now) return;
    setBusy(true); setError(null);
    (plain ? movePlain(data.call, type, row, field.key, stage) : moveInJourney(data.call, journey!.id, row, stage)).catch((e: unknown) => { if (e instanceof GateError) setGate({ stage: e.toStage || stage, missing: e.missing }); else setError(e instanceof Error ? e.message : "Could not move it. Try again."); }).finally(() => setBusy(false));
  };
  const steps: ReactElement[] = [];
  for (let i = 0; i < stages.length; i++) {
    const g = stages[i]!;
    const here = i === at, past = at >= 0 && i < at;
    steps.push(
      <Pressable
        key={g.key} accessibilityRole="button" accessibilityLabel={`${g.title}${here ? ", current stage" : ""}`} accessibilityState={{ selected: here, disabled: !journey && !plain }} testID={`step-${g.key}`}
        onPress={() => go(g.key)} style={({ hovered }: { hovered?: boolean }) => [c.step, here && c.stepOn, hovered === true && !here && c.stepOver]}
      >
        <View style={[c.dot, { backgroundColor: here || past ? (`hsl(${hueOf(g.key)}, 55%, 52%)` as string) : "var(--line-2)" }]} />
        <Text numberOfLines={1} style={[c.stepText, here && c.stepTextOn, !here && !past && c.stepTextOff]}>{g.title}</Text>
      </Pressable>,
    );
  }
  return (
    <View style={c.wrap} testID="journey-stepper" accessibilityLabel={`${def.title} stages`}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={c.steps}>{steps}</ScrollView>
      {subject ? <Subject field={subject} row={row} /> : null}
      {gate && (journey || plain) ? (
        <GateSheet
          call={data.call} {...(plain ? { plainField: field.key } : { journeyId: journey!.id })} type={type} def={def} row={row} toStage={gate.stage} missing={gate.missing}
          stageTitle={stages.find((g) => g.key === gate.stage)?.title ?? gate.stage} onDone={() => setGate(null)} onClose={() => setGate(null)}
        />
      ) : null}
      {error ? <Text style={c.err} accessibilityRole="alert" testID="journey-stepper-error">{error}</Text> : null}
    </View>
  );
}

const c = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 14 },
  steps: { flexDirection: "row", alignItems: "center", gap: 4 },
  step: { height: 30, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, borderRadius: 8 },
  stepOn: { backgroundColor: "var(--accent-wash)" as string },
  stepOver: { backgroundColor: "var(--hover)" as string },
  dot: { width: 9, height: 9, borderRadius: 9 },
  stepText: { fontSize: 13, color: "var(--ink-2)" as string },
  stepTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  stepTextOff: { color: "var(--ink-3)" as string },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  subjectLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
  link: { fontSize: 13.5, fontWeight: "500", color: "var(--accent)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
});
