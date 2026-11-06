// The "how you work" card: three short questions, answers saved to the person's own memory. The first two are a blank field you start typing in: matching kinds of work (and then tools, with their
// marks) appear as you type, a pick becomes a chip, and anything typed is accepted. The third is a choice between two. Works without an AI account.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import type { CapCall } from "../shell/session/caps.ts";
import { saveInterviewEdit } from "./interview.ts";
import type { SavedAnswers } from "./interview.ts";
import { draftGet, draftSet } from "./drafts.ts";
import { ToolTile } from "./ProviderLogo.tsx";
import { Glyph } from "./StepGlyph.tsx";
import { POPULAR_ROLES, POPULAR_TOOLS, ROLES, TOOLS, suggest } from "./work-kinds.ts";
import { CARD } from "./card-style.ts";
import { RADIUS } from "../../../../ui/src/tokens/radius.ts";

const STYLES = ["Short and to the point", "Full detail"] as const;
const ASK = ["What do you do most?", "Which tools do you use?", "How should updates read?"] as const;
const PLACE = ["Start typing, like accountant or designer", "Start typing, like Gmail or Slack"] as const;
const toolKey = (name: string): string | undefined => TOOLS.find((t) => t[0] === name)?.[1] || undefined;

export function InterviewCard({ call, onSaved, gate }: { call: CapCall; onSaved(count: number): void; /** in the onboarding screen the bar's main button is Next, then Save */ gate?(save: (() => Promise<boolean>) | null, label?: string): void }): ReactElement {
  const run = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  // reopened from the rail or Back: the answers already given are shown, editable, and saving corrects the facts made before
  const was = useRef(draftGet<{ q: number; work: string[]; tools: string[]; style: string; saved: SavedAnswers }>("interview"));
  const [q, setQ] = useState(was.current?.q ?? 0);
  const [work, setWork] = useState<string[]>(was.current?.work ?? []);
  const [tools, setTools] = useState<string[]>(was.current?.tools ?? []);
  const [style, setStyle] = useState(was.current?.style ?? "");
  const saved = useRef<SavedAnswers>(was.current?.saved ?? {});
  const [typed, setTyped] = useState("");
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { draftSet("interview", { q, work, tools, style, saved: saved.current }); }, [q, work, tools, style]);
  const picked = q === 0 ? work : tools;
  const setPicked = q === 0 ? setWork : setTools;
  const list = q === 0 ? ROLES : TOOLS;
  // before anything is typed, the most common picks show so the list is never empty; typing narrows the whole list
  const popular = (q === 0 ? POPULAR_ROLES : POPULAR_TOOLS).filter((n) => !picked.includes(n)).slice(0, 8);
  const near = typed.trim() === "" && q < 2 ? (q === 0 ? popular : popular.map((n) => TOOLS.find((t) => t[0] === n) ?? ([n, ""] as const))) : suggest(list as readonly (string | readonly [string, string])[], typed, picked);
  const text = typed.trim();
  const exact = list.some((x) => (typeof x === "string" ? x : x[0]).toLowerCase() === text.toLowerCase());
  const add = (name: string): void => { const n = name.trim(); if (n !== "" && !picked.includes(n)) setPicked([...picked, n]); setTyped(""); setHi(0); };
  const rowCount = near.length + (text !== "" && !exact ? 1 : 0);
  const key = (e: { nativeEvent?: { key?: string } }): void => {
    const k = e.nativeEvent?.key;
    if (k === "ArrowDown" && rowCount > 0) setHi((hi + 1) % rowCount);
    else if (k === "ArrowUp" && rowCount > 0) setHi((hi + rowCount - 1) % rowCount);
    else if (k === "Backspace" && typed === "" && picked.length > 0) setPicked(picked.slice(0, -1));
  };
  const enter = (): void => {
    if (rowCount > 0 && text !== "") { const n = near[hi]; add(hi < near.length && n !== undefined ? (typeof n === "string" ? n : n[0]) : text); }
    else if (picked.length > 0) setQ(q + 1);
  };
  const ready = q === 0 ? work.length > 0 : q === 1 ? tools.length > 0 : style !== "";
  const save = async (): Promise<void> => {
    if (busy || !ready) return;
    setBusy(true); setError("");
    try { const out = await saveInterviewEdit(call, { work: work.join(", "), tools: tools.join(", "), style }, run.current, saved.current); saved.current = out.saved; draftSet("interview", { q, work, tools, style, saved: out.saved }); onSaved(out.count); } catch { setError("Could not save to your memory. Try again."); } finally { setBusy(false); }
  };

  // the bar's main button does what Next and Save do here, so the card has no second primary button
  useEffect(() => {
    if (!gate) return undefined;
    if (!ready) gate(null);
    else if (q < 2) gate(async () => { setQ(q + 1); setTyped(""); setHi(0); return false; }, "Next");
    else gate(async () => {
      setError("");
      try { const out = await saveInterviewEdit(call, { work: work.join(", "), tools: tools.join(", "), style }, run.current, saved.current); saved.current = out.saved; draftSet("interview", { q, work, tools, style, saved: out.saved }); return true; } catch { setError("Could not save to your memory. Try again."); return false; }
    }, "Save");
    return () => gate(null);
  }, [gate, ready, q, work, tools, style, call]);
  const dots: ReactElement[] = [];
  for (let i = 0; i < 3; i++) dots.push(<View key={i} style={[s.dot, i <= q && s.dotOn]} />);
  const chips: ReactElement[] = [];
  for (const name of picked) {
    chips.push(
      <View key={name} style={s.chip}>
        {q === 1 ? <ToolTile name={name} {...(toolKey(name) ? { k: toolKey(name)! } : {})} size={17} /> : null}
        <Text style={s.chipText}>{name}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={() => setPicked(picked.filter((x) => x !== name))} style={s.chipX}><Glyph paths={["M4 4l8 8M12 4l-8 8"]} size={11} color="var(--ink-3)" width={2} /></Pressable>
      </View>,
    );
  }
  const rows: ReactElement[] = [];
  near.forEach((n, i) => {
    const name = typeof n === "string" ? n : n[0];
    rows.push(
      <Pressable key={name} testID={`interview-suggest-${i}`} accessibilityRole="button" onPress={() => add(name)} style={[s.row, i === hi && s.rowOn]}>
        {q === 1 ? <ToolTile name={name} {...(toolKey(name) ? { k: toolKey(name)! } : {})} size={20} /> : <View style={s.rowIcon}><Glyph paths={["M10.500 10.500L14 14", "M11.500 7a4.500 4.500 0 11-9 0 4.500 4.500 0 019 0z"]} size={12} color="var(--ink-3)" /></View>}
        <Text style={s.rowText}>{name}</Text>
      </Pressable>,
    );
  });
  if (text !== "" && !exact) {
    rows.push(
      <Pressable key="free" testID="interview-add-free" accessibilityRole="button" onPress={() => add(text)} style={[s.row, hi === near.length && s.rowOn]}>
        <View style={s.rowIcon}><Glyph paths={["M8 3.500v9M3.500 8h9"]} size={12} color="var(--ink-3)" /></View>
        <Text style={s.rowText}>{`Add "${text}"`}</Text>
      </Pressable>,
    );
  }
  const styleRows: ReactElement[] = [];
  for (const o of STYLES) {
    styleRows.push(
      <Pressable key={o} testID={`interview-style-${o === STYLES[0] ? "short" : "full"}`} accessibilityRole="radio" accessibilityState={{ selected: style === o }} onPress={() => setStyle(o)} style={[s.row, s.rowTall]}>
        <View style={[s.radio, style === o && s.radioOn]}>{style === o ? <View style={s.radioDot} /> : null}</View>
        <Text style={s.rowText}>{o}</Text>
      </Pressable>,
    );
  }
  return (
    <View testID="interview-card" style={s.col}>
      <View style={s.dots}>{dots}</View>
      <Text style={s.ask} accessibilityRole="header">{ASK[q]}</Text>
      {q < 2 ? (
        <>
          <View style={s.field}>
            {chips}
            <TextField testID={`interview-${q === 0 ? "work" : "tools"}`} accessibilityLabel={ASK[q]} value={typed} onChangeText={(v) => { setTyped(v); setHi(0); }} placeholder={picked.length > 0 ? "Add another" : PLACE[q]!} autoCorrect={false}
              onKeyPress={key} onSubmitEditing={enter} blurOnSubmit={false} style={s.input} />
          </View>
          {rows.length > 0 ? <View testID="interview-suggestions" style={s.sug}>{rows}</View> : null}
        </>
      ) : <View style={s.sug}>{styleRows}</View>}
      {error ? <Text testID="interview-error" style={s.err}>{error}</Text> : null}
      {gate ? (q > 0 ? <Pressable testID="interview-back" accessibilityRole="link" onPress={() => { setQ(q - 1); setTyped(""); setHi(0); }}><Text style={s.prev}>Previous question</Text></Pressable> : null) : <View style={s.actions}>
        {q < 2
          ? <Pressable testID="interview-next" accessibilityRole="button" disabled={!ready} onPress={() => setQ(q + 1)} style={[s.primary, !ready && s.off]}><Text style={[s.primaryText, !ready && s.offText]}>Next</Text></Pressable>
          : <Pressable testID="interview-save" accessibilityRole="button" disabled={busy || !ready} onPress={() => void save()} style={[s.primary, (busy || !ready) && s.off]}><Text style={[s.primaryText, (busy || !ready) && s.offText]}>{busy ? "Saving" : "Save"}</Text></Pressable>}
        {q > 0 ? <Pressable testID="interview-back" accessibilityRole="button" onPress={() => { setQ(q - 1); setTyped(""); setHi(0); }} style={s.ghost}><Text style={s.ghostText}>Back</Text></Pressable> : null}
      </View>}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 12 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 22, height: 4, borderRadius: 2, backgroundColor: "var(--line-2)" as string },
  dotOn: { backgroundColor: "var(--accent)" as string },
  ask: { fontSize: 17, lineHeight: 24, fontWeight: "600", color: "var(--ink)" as string },
  field: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, padding: 8, minHeight: 46, borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string },
  input: CARD.input,
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 8, paddingRight: 4, borderRadius: RADIUS, backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  chipX: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  sug: { marginTop: -4, borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 38, paddingHorizontal: 12 },
  rowTall: { minHeight: 46 },
  rowOn: { backgroundColor: "var(--sel)" as string },
  rowIcon: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  rowText: { fontSize: 14, color: "var(--ink)" as string },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: "var(--accent)" as string },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  err: CARD.err,
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  prev: { fontSize: 13, color: "var(--accent)" as string },
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  off: CARD.off,
  offText: CARD.offText,
  ghost: CARD.ghost,
  ghostText: CARD.ghostText,
});
