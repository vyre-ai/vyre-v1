// The card face editor: three presets (Simple, Detailed, Visual), the fields on the card (up to six, in order), the Journey mark, and a live preview. "Just for me" writes the face into this
// person's view; "Everyone" writes it onto the record type, the same face an agent or the API sets with type.update. Both are the one value: { preset, fields, mark }.
import { createElement, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Segmented } from "../../../../../../ui/src/Segmented/index.tsx";
import { Switch } from "../../../../../../ui/src/Switch/index.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { commitChange, stageChange } from "../typeedit/model.ts";
import { cardFields, each } from "../views-a/model.ts";
import type { CardFace, CardPreset, FieldDef, RecordRow } from "../views-a/model.ts";
import type { Board } from "./ctx.ts";
import { IDLE } from "./machine.ts";
import { KCard } from "./KCard.tsx";

const PRESETS: { id: CardPreset; label: string }[] = [
  { id: "simple", label: "Simple" },
  { id: "detail", label: "Detailed" },
  { id: "visual", label: "Visual" },
];
/** Fields a card can show: not the title, not the field the lanes run on, and no long text, files, sealed values or relations. */
const SHOWABLE = new Set([
  "person",
  "money",
  "date",
  "datetime",
  "rating",
  "number",
  "choice",
  "status",
  "checkbox",
  "text",
  "email",
  "phone",
  "url",
  "duration",
]);
export const MAX_FIELDS = 6;

/** The fields the editor offers, in the type's order. */
export function showable(board: Pick<Board, "ctx" | "field">): FieldDef[] {
  return board.ctx.def.fields.filter(
    (f) => f.key !== board.ctx.def.titleField && f.key !== board.field.key && SHOWABLE.has(f.type),
  );
}

/** The face a switch flip makes: the field added at the end (up to six) or taken off. A face with no list yet starts from what the card shows now. */
export function toggledFields(current: readonly string[], key: string): string[] {
  if (current.includes(key)) return current.filter((k) => k !== key);
  return current.length >= MAX_FIELDS ? [...current] : [...current, key];
}

function Tile({ preset, on, onPress }: { preset: CardPreset; on: boolean; onPress: () => void }): ReactElement {
  const label = PRESETS.find((p) => p.id === preset)!.label;
  const art =
    Platform.OS === "web"
      ? createElement(
          "svg",
          { width: 60, height: 36, viewBox: "0 0 60 36", style: { display: "block" }, "aria-hidden": true },
          createElement("rect", {
            x: 1,
            y: 1,
            width: 58,
            height: 34,
            rx: 6,
            fill: "var(--win)",
            stroke: "var(--line-2)",
          }),
          preset === "visual"
            ? createElement("path", { d: "M1 13V7a6 6 0 016-6h46a6 6 0 016 6v6z", fill: "var(--accent)", opacity: 0.7 })
            : null,
          createElement("rect", {
            x: 7,
            y: preset === "visual" ? 18 : preset === "detail" ? 7 : 9,
            width: 28,
            height: 4,
            rx: 2,
            fill: "var(--ink-3)",
          }),
          preset === "detail"
            ? createElement("rect", { x: 7, y: 15, width: 20, height: 7, rx: 2, fill: "var(--ink-2)" })
            : null,
          createElement("circle", { cx: 12, cy: preset === "simple" ? 25 : 29, r: 3.5, fill: "var(--ink-4)" }),
        )
      : null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      testID={`face-preset-${preset}`}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [f.tile, on && f.tileOn, hovered === true && !on && f.tileOver]}
    >
      {art}
      <Text style={f.tileText}>{label}</Text>
    </Pressable>
  );
}

export function FacePanel({
  board,
  onClose,
  onDraft,
  onPersist,
}: {
  board: Board;
  onClose: () => void;
  /** The face as it is being edited: the board draws it at once. */
  onDraft: (face: CardFace) => void;
  /** The person's own face is ready to keep (for Everyone it is written to the type here). */
  onPersist: (face: CardFace, who: "me" | "all") => void;
}): ReactElement {
  const { ctx } = board;
  const data = ctx.def;
  const canType = board.canEditType;
  const [who, setWho] = useState<"me" | "all">("me");
  const [draft, setDraft] = useState<CardFace>(board.face);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const options = showable(board);
  // what the card shows now when nobody chose a list: the defaults by rank, so the switches start where the card is
  const current = draft.fields ?? cardFields(data, board.st.v.hidden, board.field.key, 3).map((x) => x.key);
  const apply = (next: CardFace): void => {
    setDraft(next);
    onDraft(next);
    setNote(null);
    const payload = { preset: next.preset, fields: next.fields ?? current, mark: next.mark };
    if (who === "me") {
      // the person's own face: kept in their view, over the type's
      onPersist({ ...next, fields: payload.fields }, "me");
      return;
    }
    setBusy(true);
    // saves to the type go one after another, so the last switch is the last write
    const run = (): Promise<{ ok: true } | { ok: false; error: string }> =>
      stageChange(board.call, [{ op: "type.update", type: ctx.type, def: { card: payload } }]).then((r) =>
        r.ok ? commitChange(board.call, r.staged) : r,
      );
    const chain = chainRef.current.then(run, run);
    chainRef.current = chain;
    chain
      .then((r) => {
        if (!r.ok) setNote(r.error);
      })
      .finally(() => setBusy(false));
  };
  const sample = Object.values(board.rows.current)[0];
  const preview: Board = {
    ...board,
    face: draft,
    move: IDLE,
    selected: new Set<string>(),
    focus: null,
    send: () => undefined,
  };
  const rows = each(options, (o) => (
    <View key={o.key} style={f.row} testID={`face-field-${o.key}`}>
      <Text style={f.rowText}>{o.title}</Text>
      <Switch
        on={current.includes(o.key)}
        label={o.title}
        testID={`face-switch-${o.key}`}
        disabled={!current.includes(o.key) && current.length >= MAX_FIELDS}
        onChange={() => apply({ ...draft, fields: toggledFields(current, o.key) })}
      />
    </View>
  ));
  return (
    <View style={f.panel} testID="face-panel" accessibilityLabel={`Card face for ${data.plural}`}>
      <View style={f.head}>
        <Text style={f.title}>{`Card face for ${data.plural}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="face-close" onPress={onClose}>
          <Glyph name="cross" size={13} color="var(--ink-3)" />
        </Pressable>
      </View>
      {canType ? (
        <Segmented<"me" | "all">
          label="Whose face"
          value={who}
          onChange={setWho}
          options={[
            { id: "me", label: "Just for me" },
            { id: "all", label: "Everyone" },
          ]}
          testID="face-who"
        />
      ) : null}
      <View style={f.presets} accessibilityRole="radiogroup">
        {each(PRESETS, (p) => (
          <Tile key={p.id} preset={p.id} on={draft.preset === p.id} onPress={() => apply({ ...draft, preset: p.id })} />
        ))}
      </View>
      <ScrollView style={f.list} contentContainerStyle={f.listIn}>
        {rows}
        <View style={f.row}>
          <Text style={f.rowText}>Journey mark and progress</Text>
          <Switch
            on={draft.mark}
            label="Journey mark and progress"
            testID="face-switch-mark"
            onChange={(on) => apply({ ...draft, mark: on })}
          />
        </View>
      </ScrollView>
      {sample ? (
        <View style={f.preview} pointerEvents="none" testID="face-preview">
          <KCard row={sample as RecordRow} board={preview} lane={board.lanes[0]!} />
        </View>
      ) : null}
      <Text style={f.note}>
        {note ??
          (who === "me"
            ? "Only you see this. The Space keeps its own face for everyone else."
            : busy
              ? "Saving"
              : "Changes the face every person sees, unless they chose their own.")}{" "}
        Agents and the API set the same face on the type.
      </Text>
    </View>
  );
}

const f = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 8,
    right: 16,
    width: 320,
    maxHeight: "92%",
    zIndex: 20,
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-pop), inset 0 0 0 1px var(--line)",
  } as object,
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  presets: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, alignItems: "center", gap: 6, padding: 8, borderRadius: 12 },
  tileOn: { boxShadow: "inset 0 0 0 2px var(--accent)" } as object,
  tileOver: { backgroundColor: "var(--hover)" as string },
  tileText: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  list: { maxHeight: 190 },
  listIn: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32 },
  rowText: { fontSize: 13, color: "var(--ink)" as string },
  preview: { padding: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  note: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
});
