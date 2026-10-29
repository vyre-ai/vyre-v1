import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Field, s } from "./editor-ui.tsx";

export const MAX_CHOICES = 200;
export interface SavedChoice { key: string; refId: string; label: string }
type Candidate = { refId: string; label: string };

/** What the list shows: every saved choice first, marked when the publisher can no longer offer it, then the other candidates. Pure, so the rules are tested without drawing. */
export function choiceRows(saved: readonly SavedChoice[], candidates: readonly Candidate[], picked: ReadonlySet<string>): { refId: string; label: string; picked: boolean; gone: boolean }[] {
  const live = new Set(candidates.map((c) => c.refId));
  const out = saved.map((c) => ({ refId: c.refId, label: c.label, picked: picked.has(c.refId), gone: !live.has(c.refId) }));
  const have = new Set(saved.map((c) => c.refId));
  for (const c of candidates) if (!have.has(c.refId)) out.push({ refId: c.refId, label: c.label, picked: picked.has(c.refId), gone: false });
  return out;
}

/** The "Public choices" card for one relation or person question: the publisher picks the records or people a visitor may choose from; a visitor sees their labels and nothing else. */
export function FormChoices({ formId, field, saved, saveFirst, disabled, onSaved }: { formId: string; field: { key: string; title: string; type: string }; saved: readonly SavedChoice[]; saveFirst: boolean; disabled: boolean; onSaved(): void }): ReactElement {
  const d = useAppsData();
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set(saved.map((c) => c.refId)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const savedKey = saved.map((c) => c.refId).join(",");
  useEffect(() => { setPicked(new Set(saved.map((c) => c.refId))); }, [savedKey]);
  useEffect(() => {
    if (saveFirst) return;
    let live = true;
    setError("");
    void (d.call("forms.choices_candidates", { formId, field: field.key, ...(q.trim() ? { q: q.trim() } : {}) }) as Promise<CapMap["forms.choices_candidates"]["out"]>)
      .then((out) => { if (live) setCandidates(out.candidates); }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [d, formId, field.key, q, saveFirst, savedKey]);
  const rows = choiceRows(saved, candidates, picked);
  const noun = field.type === "person" ? "people" : "records";
  const toggle = (refId: string): void => {
    const next = new Set(picked);
    if (next.has(refId)) next.delete(refId); else if (next.size < MAX_CHOICES) next.add(refId);
    setPicked(next); setNotice("");
  };
  const save = async (): Promise<void> => {
    setBusy(true); setError("");
    try { await mutate(d, "forms.choices_set", { formId, field: field.key, choices: [...picked].map((refId) => ({ refId })) }, actionKey()); setNotice(`Saved. Visitors can pick from ${picked.size} ${picked.size === 1 ? "choice" : "choices"}.`); onSaved(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <View testID={`apps-choices-${field.key}`} style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={[s.text, { fontWeight: "600" }]}>{`Public choices for ${field.title}`}</Text>
    <Text style={s.text}>{`Choose which ${noun} a visitor may pick. A visitor sees only the name, never anything else about it. Up to ${MAX_CHOICES}.`}</Text>
    {saveFirst ? <Text style={s.text}>{`Save the form first, so ${field.title} is an asked question.`}</Text> : <>
      <Field label={`Search ${noun}`} value={q} onChange={setQ} disabled={disabled} />
      <View>{rows.map((r) => <Row key={r.refId} id={`choice-${field.key}-${r.refId}`} title={r.label} selected={r.picked} {...(r.gone ? { noteLead: "Unavailable", note: "Saving removes it", noteLeadTone: "warning" as const } : {})} onPress={() => toggle(r.refId)} trailing={<Text style={s.text}>{r.gone ? (r.picked ? "Will be removed" : "Removed") : r.picked ? "Offered" : "Not offered"}</Text>} />)}</View>
      {rows.length === 0 && !error ? <Text style={s.text}>{`No ${noun} to offer.`}</Text> : null}
      <Text style={s.text}>{`${picked.size} of ${MAX_CHOICES} chosen.`}</Text>
      <View style={s.actions}><Button title="Save choices" testID={`apps-choices-save-${field.key}`} primary disabled={disabled || busy} onPress={() => void save()} /></View>
    </>}
    {notice ? <Text accessibilityLiveRegion="polite" style={s.text}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={s.text}>{error}</Text> : null}
  </View>;
}
