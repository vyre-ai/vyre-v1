// One card on the Kanban: its face (cover, owner, amount, day in the stage, the progress of the fields its next stage needs, the Journey mark), its states (selected, lifted, refused with the
// reason on it, waiting on fields with the form on it) and the ways to move it (drag, menu, keys). The face is the type's or the person's own (spec 3.4, card face).
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { GateFields } from "../journey/GateSheet.tsx";
import type { Entered } from "../journey/model.ts";
import { Face, Glyph } from "../sidebar/parts.tsx";
import { cellText, hueOf } from "../table/model.ts";
import { cardFields, each, laneOfRow } from "../views-a/model.ts";
import type { Lane, RecordRow } from "../views-a/model.ts";
import { Value } from "../views-a/parts.tsx";
import type { Board } from "./ctx.ts";
import { ageOf, amountOf, needLine, splitFace } from "./face.ts";
import { holds, movedWords } from "./machine.ts";
import { beginPointerDrag } from "./pointerdrag.ts";
import { moneyText } from "../table/model.ts";
import { requiredProgress } from "./stats.ts";

const shadow = (v: string): ViewStyle => (Platform.OS === "web" ? ({ boxShadow: v } as ViewStyle) : {});

/** The ring of required fields: filled of needed, one arc. */
export function Ring({ filled, of, size = 18 }: { filled: number; of: number; size?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const done = filled >= of;
  return createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      role: "img",
      "aria-label": `${filled} of ${of} required fields filled`,
      "data-testid": "card-ring",
      style: { display: "block", flex: "none" },
    },
    createElement("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "var(--line-2)", strokeWidth: 2 }),
    createElement("circle", {
      cx: size / 2,
      cy: size / 2,
      r,
      fill: "none",
      stroke: done ? "var(--ok)" : "var(--accent)",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeDasharray: `${c * (of === 0 ? 1 : filled / of)} ${c}`,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }),
  );
}

/** The form on a card whose next stage wants fields: Save writes them and moves the card; Move back leaves it where it was. */
function Inline({ row, board }: { row: RecordRow; board: Board }): ReactElement | null {
  const s = board.move;
  const [entered, setEntered] = useState<Entered>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (s.kind !== "needs" || s.id !== row.id) return null;
  const save = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    board
      .fieldsDone(entered)
      .then((msg) => {
        if (msg) setError(msg);
      })
      .finally(() => setBusy(false));
  };
  return (
    <View style={k.inline} testID={`card-fields-${row.id}`}>
      <GateFields
        def={board.ctx.def}
        missing={s.missing}
        entered={entered}
        put={(key, v) => {
          setEntered((e) => ({ ...e, [key]: v }));
          setError(null);
        }}
        save={save}
        compact
      />
      {error ? (
        <Text style={k.reason} accessibilityRole="alert" testID={`card-fields-error-${row.id}`}>
          {error}
        </Text>
      ) : null}
      <View style={k.rw}>
        <Pressable
          accessibilityRole="button"
          testID={`card-fields-cancel-${row.id}`}
          onPress={() => board.send({ t: "fields-cancel" })}
          style={({ hovered }: { hovered?: boolean }) => [k.btn, hovered === true && k.btnOver]}
        >
          <Text style={k.btnText}>Move back</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID={`card-fields-save-${row.id}`}
          disabled={busy}
          onPress={save}
          style={({ hovered }: { hovered?: boolean }) => [k.btn, k.btnOn, hovered === true && k.btnOnOver]}
        >
          <Text style={[k.btnText, k.btnOnText]}>{busy ? "Saving" : "Save and move"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function KCard({ row, board, lane }: { row: RecordRow; board: Board; lane: Lane }): ReactElement {
  const { ctx, st, field, face, now } = board;
  const names = board.names;
  const tf = ctx.def.fields.find((f) => f.key === ctx.def.titleField);
  const title = (tf ? cellText(tf, row.fields[tf.key], names) : "") || "Untitled";
  const shown = cardFields(ctx.def, st.v.hidden, field.key, 3, face);
  // Simple is the plain card: the title and its few values as small text. Detailed and Visual lift the owner (a face) and the amount (a figure) out of them.
  const lean = face.preset === "simple";
  const { owner, amount, rest } = lean ? { owner: undefined, amount: undefined, rest: shown } : splitFace(shown);
  const stage = board.stages[lane.key];
  const lanes = board.lanes.filter((l) => !l.none);
  const next = lanes[lanes.findIndex((l) => l.key === lane.key) + 1];
  const nextStage = next ? board.stages[next.key] : undefined;
  const progress = requiredProgress(row, nextStage?.needToEnter);
  const age = ctx.journey ? ageOf(board.enteredAt(row), now, stage?.limitHours) : null;
  const selected = board.selected.has(row.id);
  const lifted = board.move.kind === "lifted" && board.move.id === row.id;
  const held = holds(board.move, row.id);
  const refused = board.move.kind === "refused" && board.move.id === row.id ? board.move : null;
  const conflict = board.move.kind === "conflict" && board.move.id === row.id ? board.move : null;
  const focused = board.focus === row.id;
  const multi = board.selected.size > 0;
  const needs =
    progress && progress.missing.length > 0 && !held
      ? needLine(
          progress.missing.map((m) => ctx.def.fields.find((f) => f.key === m)?.title ?? m),
          nextStage?.title,
        )
      : null;
  const person = owner ? row.fields[owner.key] : undefined;
  const amt = amountOf(row, amount);
  const entries = (): MenuEntry[] => [
    { label: "Open", onSelect: () => board.open(row.id) },
    { label: selected ? "Deselect" : "Select", onSelect: () => board.toggle(row.id) },
    { separator: true },
    { head: "Move to" },
    ...each(
      board.lanes.filter((l) => !l.none || lane.none || (board.counts.current[l.key] ?? 0) > 0),
      (l): MenuEntry => ({
        label: l.title,
        checked: l.key === lane.key,
        onSelect: () => board.moveTo(selected && board.selected.size > 1 ? selectedRows(board) : [row], l, "menu"),
      }),
    ),
  ];
  const trig = menuTrigger((x, y) => {
    board.setFocus(row.id);
    board.show(entries(), x, y);
  });
  const ref = useRef<unknown>(null);
  useEffect(() => {
    if (!focused || Platform.OS !== "web") return;
    const el = ref.current as { focus?: () => void; contains?: (n: unknown) => boolean } | null;
    const active = (globalThis as { document?: { activeElement?: unknown } }).document?.activeElement;
    // keys moved the focus here: bring the real focus along, unless a person is typing somewhere on the board
    if (el?.focus && active && !(active as { matches?: (s: string) => boolean }).matches?.("input,textarea"))
      el.focus();
  }, [focused]);
  const [hover, setHover] = useState(false);
  // a screen with no hover (a phone, a tablet) has no way to reveal the tick, so it is always drawn there
  const coarse =
    Platform.OS === "web" &&
    (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia?.("(hover: none)")?.matches ===
      true;
  const edge = age?.late === true;
  const card = (
    <Pressable
      ref={ref as never}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${lane.title}${age?.late ? `, ${age.text}` : ""}`}
      accessibilityState={{ selected }}
      focusable={focused}
      testID={`card-${row.id}`}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onPress={() => {
        board.setFocus(row.id);
        if (multi) board.toggle(row.id);
        else board.open(row.id);
      }}
      {...trig}
      style={({ hovered }: { hovered?: boolean }) => [
        k.card,
        face.preset === "simple" && k.cardTight,
        shadow(
          selected
            ? "var(--sh-1), 0 0 0 2px var(--accent)"
            : focused
              ? "var(--sh-1), 0 0 0 2px var(--accent-line)"
              : hovered === true
                ? "var(--sh-2), inset 0 0 0 1px var(--line-2)"
                : "var(--sh-1), inset 0 0 0 1px var(--line)",
        ),
        lifted && k.lifted,
      ]}
    >
      {edge ? <View style={k.edge} testID={`card-late-${row.id}`} /> : null}
      {face.preset === "visual" ? (
        <View
          testID={`cover-${row.id}`}
          style={[k.cover, { backgroundColor: `hsl(${hueOf(title)} 38% 44%)` as string }]}
        >
          <Text style={k.coverText}>{title.charAt(0).toUpperCase()}</Text>
        </View>
      ) : null}
      <View style={k.t1}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Select ${title}`}
          accessibilityState={{ checked: selected }}
          testID={`tick-${row.id}`}
          focusable={false}
          onPress={() => board.toggle(row.id)}
          style={[k.ck, selected && k.ckOn, !selected && !multi && !hover && !coarse && k.ckHidden]}
        >
          {selected ? <Glyph name="check" size={11} color="#fff" width={2} /> : null}
        </Pressable>
        <Text numberOfLines={2} style={[k.title, face.preset !== "simple" ? k.titleBold : null]}>
          {title}
        </Text>
        {face.mark && progress && progress.of > 0 ? <Ring filled={progress.filled} of={progress.of} /> : null}
      </View>
      {amt !== null && !lean ? (
        <Text style={k.amount} testID={`card-amount-${row.id}`}>
          {moneyText(row.fields[amount!.key])}
        </Text>
      ) : null}
      {rest.length > 0 ? (
        <View style={k.meta}>
          {each(rest, (f) => (
            <Value key={f.key} field={f} row={row} names={names} />
          ))}
        </View>
      ) : null}
      <View style={[k.t2, lean && !age && !(face.mark && ctx.journey) ? k.none : null]}>
        {!lean && person !== undefined && person !== null && person !== "" ? (
          <Face name={names(String(person))} seedId={String(person)} size={26} />
        ) : null}
        {age ? (
          <View style={k.age} testID={`card-age-${row.id}`}>
            {age.late ? <Glyph name="clock" size={12} color="var(--warn)" /> : null}
            <Text style={[k.ageText, age.late && k.late]}>{age.text}</Text>
          </View>
        ) : null}
        <View style={k.sp} />
        {face.mark && ctx.journey ? (
          <View accessibilityLabel="On a Journey" testID={`card-journey-${row.id}`}>
            <Glyph name="route" size={13} color="var(--ink-3)" />
          </View>
        ) : null}
      </View>
      {needs ? (
        <View style={k.need} testID={`card-need-${row.id}`}>
          <Glyph name="flag" size={12} color="var(--warn)" />
          <Text style={k.needText}>{needs}</Text>
        </View>
      ) : null}
      {refused ? (
        <View style={k.gate} accessibilityRole="alert" testID={`card-refused-${row.id}`}>
          <Glyph name="lock" size={14} color="var(--warn)" />
          <Text style={k.gateText}>{refused.reason}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            testID={`card-refused-dismiss-${row.id}`}
            onPress={() => board.send({ t: "dismiss" })}
          >
            <Glyph name="cross" size={12} color="var(--ink-3)" />
          </Pressable>
        </View>
      ) : null}
      {conflict ? (
        <View style={k.gate} accessibilityRole="alert" testID={`card-moved-${row.id}`}>
          <Glyph name="route" size={14} color="var(--warn)" />
          <Text style={k.gateText}>
            {movedWords(conflict.by, board.lanes.find((l) => l.key === conflict.at)?.title ?? "another stage")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            testID={`card-moved-dismiss-${row.id}`}
            onPress={() => board.send({ t: "dismiss" })}
          >
            <Glyph name="cross" size={12} color="var(--ink-3)" />
          </Pressable>
        </View>
      ) : null}
      <Inline row={row} board={board} />
    </Pressable>
  );
  if (Platform.OS !== "web") return card;
  const laneNow = laneOfRow(field, row, board.lanes).key;
  const lift = (): void => {
    board.drag.current = row;
    board.send({ t: "lift", id: row.id, from: laneNow, version: row.version });
  };
  const end = (): void => {
    board.drag.current = null;
    board.send({ t: "release" });
  };
  return createElement(
    "div",
    {
      "data-testid": `drag-${row.id}`,
      "data-card-id": row.id,
      onClickCapture: (e: {
        shiftKey?: boolean;
        metaKey?: boolean;
        ctrlKey?: boolean;
        preventDefault(): void;
        stopPropagation(): void;
      }) => {
        if (e.shiftKey === true) {
          e.preventDefault();
          e.stopPropagation();
          board.range(row.id);
        } else if (e.metaKey === true || e.ctrlKey === true) {
          e.preventDefault();
          e.stopPropagation();
          board.toggle(row.id);
        }
      },
      // one drag for mouse, touch and pen (board/pointerdrag.ts)
      onPointerDown: (e: {
        button?: number;
        pointerType?: string;
        pointerId: number;
        clientX: number;
        clientY: number;
        target?: { closest?: (s: string) => unknown };
        currentTarget: { cloneNode(d: boolean): unknown; getBoundingClientRect(): { width: number; height: number } };
      }) => {
        if ((e.button ?? 0) !== 0) return;
        if (board.move.kind === "needs" || board.move.kind === "committing") return;
        if (e.target?.closest?.('input,textarea,button,a,[role="checkbox"]')) return;
        beginPointerDrag(
          { pointerType: e.pointerType ?? "mouse", pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY },
          e.currentTarget,
          {
            lift,
            over: (l) => board.send({ t: "over", lane: l }),
            drop: () => board.send({ t: "drop" }),
            end,
            cancel: () => board.send({ t: "cancel" }),
          },
        );
      },
      // the same lift and put-down, for a caller that has no pointer
      onDragStart: lift,
      onDragEnd: end,
      style: { width: "100%", touchAction: "manipulation", userSelect: "none" },
    },
    card,
  );
}

/** The cards in the selection, as the rows the board last drew. */
export function selectedRows(board: Board): RecordRow[] {
  const out: RecordRow[] = [];
  for (const id of board.selected) {
    const r = board.rows.current[id];
    if (r) out.push(r);
  }
  return out;
}

const k = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
    overflow: "hidden",
  },
  cardTight: { gap: 4 },
  lifted: { opacity: 0.35 },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: "var(--warn)" as string },
  cover: {
    height: 52,
    marginTop: -10,
    marginHorizontal: -12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  coverText: { fontSize: 24, fontWeight: "700", color: "rgba(255,255,255,0.92)" },
  t1: { flexDirection: "row", alignItems: "center", gap: 8 },
  ck: {
    width: 16,
    height: 16,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "inset 0 0 0 1.5px var(--line-2)",
  } as object,
  ckOn: { backgroundColor: "var(--accent)" as string, boxShadow: "none" } as object,
  ckHidden: { display: "none" },
  title: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: "500", color: "var(--ink)" as string },
  titleBold: { fontSize: 13.5, fontWeight: "600" },
  amount: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  t2: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  sp: { flex: 1 },
  none: { display: "none" },
  age: { flexDirection: "row", alignItems: "center", gap: 4 },
  ageText: { fontSize: 12, color: "var(--ink-3)" as string },
  late: { color: "var(--warn)" as string, fontWeight: "600" },
  need: { flexDirection: "row", alignItems: "center", gap: 6 },
  needText: { fontSize: 12, fontWeight: "500", color: "var(--warn)" as string, flexShrink: 1 },
  gate: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 8,
    marginHorizontal: -4,
    marginBottom: -4,
    borderRadius: 10,
    backgroundColor: "var(--sunk)" as string,
    boxShadow: "inset 0 0 0 1px var(--warn)",
  } as object,
  gateText: { flex: 1, fontSize: 12, lineHeight: 16, color: "var(--ink-2)" as string },
  inline: {
    gap: 8,
    padding: 10,
    marginHorizontal: -4,
    marginBottom: -4,
    borderRadius: 10,
    backgroundColor: "var(--sunk)" as string,
  },
  reason: { fontSize: 12, color: "var(--danger)" as string },
  rw: { flexDirection: "row", justifyContent: "flex-end", gap: 6 },
  btn: { height: 28, paddingHorizontal: 10, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnOn: { backgroundColor: "var(--accent)" as string },
  btnOnOver: { opacity: 0.9 },
  btnText: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  btnOnText: { color: "#fff" },
});
