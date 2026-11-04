// ui/FacePicker: the one "Choose a face" sheet. A big live preview with the name under it and four small expressions, underline tabs for the families (Faces, Friends, Blobs, Glass, Emoji, Upload), a grid of the
// curated faces, a row of tints, Shuffle and Upload. Esc, Done and a press outside close it and keep the pick; the caller shows Undo. It reads and writes the stored text of agentface.ts and nothing else.

import { createElement, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar, takenFaces } from "../Avatar/index.tsx";
import { Dialog } from "../Dialog/index.tsx";
import { DRAWN, EMOJI, FAMILIES, PER_FAMILY, TINTS, formatFace, hasExpressions, parseFace, shuffleFace, suggestFace } from "../Avatar/agentface.ts";
import type { FaceSpec } from "../Avatar/agentface.ts";
import type { FaceState } from "../Avatar/props.ts";
import { squareDataUrl } from "./image.ts";

export interface FacePickerProps {
  /** The agent's name, under the preview. */
  name: string;
  /** The face it wears now, as stored; anything that is not a library face starts the sheet on a suggestion. */
  value: string;
  /** Faces already worn in the Space, so the first suggestion is one nobody has. Defaults to the shell's list. */
  taken?: readonly string[];
  /** Esc, Done or a press outside: the face as stored, or null when nothing changed. */
  onDone(face: string | null): void;
  testID?: string;
}

const EXPRESSIONS: { key: "idle" | "working" | "asleep" | "done"; label: string }[] = [{ key: "idle", label: "Idle" }, { key: "working", label: "Working" }, { key: "asleep", label: "Asleep" }, { key: "done", label: "Finished" }];
const stateOf = (k: string): FaceState | undefined => (k === "idle" ? undefined : (k as FaceState));

/** The sheet's starting face: the one it wears, else a suggestion. Exported for the tests. */
export function startFace(value: string, taken: readonly string[], random?: () => number): FaceSpec {
  return parseFace(value) ?? suggestFace(taken, random);
}

export function FacePicker({ name, value, taken, onDone, testID = "face-picker" }: FacePickerProps): ReactElement {
  const used = taken ?? takenFaces();
  const first = useMemo(() => startFace(value, used), []);  // eslint-disable-line react-hooks/exhaustive-deps
  const [cur, setCur] = useState<FaceSpec>(first);
  const [tab, setTab] = useState<(typeof FAMILIES)[number]["key"]>(first.fam === "img" ? "upload" : first.fam);
  const [expr, setExpr] = useState<(typeof EXPRESSIONS)[number]["key"]>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const tint = cur.fam === "img" ? 0 : cur.tint;
  const text = formatFace(cur);
  const finish = (): void => onDone(text === value ? null : text);
  const withTint = (s: FaceSpec, t: number): FaceSpec => (s.fam === "img" ? s : { ...s, tint: t });
  const set = (s: FaceSpec): void => { setCur(s); setProblem(null); };

  const upload = (file: Blob | undefined): void => {
    if (!file) return;
    void squareDataUrl(file).then((url) => { if (url === null) setProblem("That picture could not be used. Try a square png, jpeg or webp."); else set({ fam: "img", url }); });
  };

  const grid = (): ReactElement => {
    if (tab === "upload") {
      return (
        <View style={st.up}>
          <Pressable accessibilityRole="button" accessibilityLabel="Upload a picture" testID={`${testID}-upload`} style={({ hovered }: { hovered?: boolean }) => [st.drop, hovered === true && st.hover]}>
            {Platform.OS === "web" ? createElement("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/*", "data-testid": `${testID}-file`, "aria-label": "Upload a picture", onChange: (e: { target: { files?: Blob[] } }) => upload(e.target.files?.[0]), style: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" } }) : null}
            <Text style={st.dropTitle}>Upload a picture</Text>
            <Text style={st.dropNote}>Square works best. It is cropped to the shape.</Text>
          </Pressable>
          {problem !== null ? <Text accessibilityRole="alert" testID={`${testID}-problem`} style={st.problem}>{problem}</Text> : null}
          {cur.fam === "img" ? <Text style={st.dropNote}>Using your picture. Pick another tab to go back to a drawn face.</Text> : null}
        </View>
      );
    }
    const cells: ReactElement[] = tab === "emoji"
      ? EMOJI.map((e) => { const s: FaceSpec = { fam: "emoji", e, tint }; const on = cur.fam === "emoji" && cur.e === e; return cell(s, on, `emoji-${e}`, e); })
      : Array.from({ length: PER_FAMILY }, (_, i) => { const s: FaceSpec = { fam: tab as (typeof DRAWN)[number], i, tint }; const on = cur.fam === tab && cur.i === i; return cell(s, on, `${tab}-${i}`, `${tab} ${i + 1}`); });
    return <View testID={`${testID}-grid`} style={st.grid}>{cells}</View>;
  };
  const cell = (s: FaceSpec, on: boolean, key: string, label: string): ReactElement => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} testID={`${testID}-${key}`} onPress={() => set(s)} style={({ hovered }: { hovered?: boolean }) => [st.cell, on && st.cellOn, hovered === true && !on && st.cellHover]}>
      <Avatar name={label} seedId="face-picker" kind="agent" size={52} face={formatFace(s)} />
    </Pressable>
  );

  return (
    <Dialog title="Choose a face" onClose={finish} width={520} testID={testID} actions={[{ label: "Done", primary: true, onPress: finish, testID: `${testID}-done` }]}>
      <View style={st.pre}>
        <Avatar name="Preview" seedId="face-picker" kind="agent" size={112} face={text} state={hasExpressions(cur) ? stateOf(expr) : undefined} testID={`${testID}-preview`} />
        <Text testID={`${testID}-name`} style={st.name}>{name || "New agent"}</Text>
        {hasExpressions(cur) ? (
          <View style={st.exprs}>
            {EXPRESSIONS.map((x) => (
              <Pressable key={x.key} accessibilityRole="button" accessibilityLabel={x.label} accessibilityState={{ selected: expr === x.key }} testID={`${testID}-expr-${x.key}`} onPress={() => setExpr(x.key)} style={({ hovered }: { hovered?: boolean }) => [st.expr, expr === x.key && st.exprOn, hovered === true && st.hover]}>
                <Avatar name={x.label} seedId="face-picker" kind="agent" size={32} face={text} state={stateOf(x.key)} />
                <Text style={st.exprText}>{x.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View accessibilityRole="tablist" style={st.tabs}>
        {FAMILIES.map((f) => (
          <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: tab === f.key }} testID={`${testID}-tab-${f.key}`} onPress={() => setTab(f.key)} style={[st.tab, tab === f.key && st.tabOn]}>
            <Text style={[st.tabText, tab === f.key && st.tabTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {grid()}
      <View style={st.tints}>
        <View accessibilityRole="radiogroup" style={st.swatches}>
          {TINTS.map((t, i) => (
            <Pressable key={t.name} accessibilityRole="radio" accessibilityLabel={t.name} accessibilityState={{ checked: cur.fam !== "img" && tint === i }} testID={`${testID}-tint-${i}`} onPress={() => set(withTint(cur.fam === "img" ? shuffleFace("faces") : cur, i))} style={[st.swatch, { backgroundColor: t.hex as string }, cur.fam !== "img" && tint === i && st.swatchOn]} />
          ))}
        </View>
        <View style={st.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="Shuffle" testID={`${testID}-shuffle`} onPress={() => { const fam = tab === "upload" ? "faces" : tab; if (tab === "upload") setTab("faces"); set(shuffleFace(fam)); }} style={({ hovered }: { hovered?: boolean }) => [st.quiet, hovered === true && st.hover]}><Text style={st.quietText}>Shuffle</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Upload" testID={`${testID}-upload-tab`} onPress={() => setTab("upload")} style={({ hovered }: { hovered?: boolean }) => [st.quiet, hovered === true && st.hover]}><Text style={st.quietText}>Upload</Text></Pressable>
      </View>
      <Text style={st.credit}>Drawings by Zoish, Lisa Wischofsky and DiceBear, public domain (CC0)</Text>
    </Dialog>
  );
}

const st = StyleSheet.create({
  pre: { alignItems: "center", gap: 6, paddingTop: 4 },
  name: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, marginTop: 4 },
  exprs: { flexDirection: "row", gap: 10, marginTop: 4 },
  expr: { alignItems: "center", gap: 3, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 10 },
  exprOn: { backgroundColor: "var(--sel)" as string },
  exprText: { fontSize: 11.5, color: "var(--ink-3)" as string },
  hover: { backgroundColor: "var(--hover)" },
  tabs: { flexDirection: "row", gap: 18, marginTop: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tab: { height: 34, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: "var(--accent)" as string },
  tabText: { fontSize: 13, color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 14 },
  cell: { borderRadius: 18, padding: 2, borderWidth: 2, borderColor: "transparent" },
  cellOn: { borderColor: "var(--accent)" as string },
  cellHover: { backgroundColor: "var(--hover)" },
  up: { paddingTop: 14, gap: 8 },
  drop: { position: "relative", alignItems: "center", gap: 4, paddingVertical: 26, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: "var(--line-2)" as string, overflow: "hidden" },
  dropTitle: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  dropNote: { fontSize: 12.5, color: "var(--ink-3)" as string },
  problem: { fontSize: 12.5, color: "var(--danger)" as string },
  tints: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 12 },
  swatches: { flexDirection: "row", gap: 7 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: "var(--line-2)" as string },
  swatchOn: { borderWidth: 2, borderColor: "var(--accent)" as string },
  grow: { flex: 1 },
  quiet: { height: 30, paddingHorizontal: 10, borderRadius: 9, justifyContent: "center" },
  quietText: { fontSize: 13, color: "var(--ink-3)" as string },
  credit: { fontSize: 11.5, color: "var(--ink-4)" as string, marginTop: 10 },
});
