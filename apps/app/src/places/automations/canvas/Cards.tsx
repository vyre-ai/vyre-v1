// The cards of the canvas: a Trigger card holding every trigger (any one starts a run), and one card per step. A card is a 52 px row: icon tile, title and a line of what it does,
// then a warning when something is missing, the agent's face on an AI step, and a ... button that shows on hover, selection and keyboard focus.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { Glyph } from "./icons.tsx";
import { PreviewMark } from "../builder/marks.tsx";
import { isPreviewKey } from "../catalog/model.ts";
import { CARD_H, CARD_W, TRIG_HEAD, TRIG_ROW, messages, triggerMeta } from "./model.ts";
import type { CardNode, DefTrigger, IconKey, Issue, RunState } from "./model.ts";
import { Face, IconButton, pointer, shadow, webOnly } from "./parts.tsx";
import type { KeyEventLike } from "./parts.tsx";

const RUN_RING: Record<RunState, string | null> = {
  done: "var(--ok)", failed: "var(--danger)", waiting: "var(--warn)", running: "var(--accent)", skipped: null, pending: null,
};

export interface CardHandlers {
  onSelect(id: string): void;
  /** Open the step panel (double click, Enter, Edit this step). */
  onOpen(id: string): void;
  onMenu(id: string, x: number, y: number): void;
  onAdd(id: string, x: number, y: number): void;
  onKey(e: KeyEventLike, id: string): void;
  onFocusId?(id: string | null): void;
}

const DOUBLE_MS = 450;

export function StepCard({ card, selected, hovered, handlers, agent, onHover }: {
  card: CardNode;
  selected: boolean;
  hovered: boolean;
  handlers: CardHandlers;
  /** The name of the agent on an AI step, for its face. */
  agent?: string | undefined;
  onHover(id: string | null): void;
}): ReactElement {
  const [focus, setFocus] = useState(false);
  const last = useRef(0);
  const errors = card.issues.filter((i) => i.severity === "error");
  const ring = card.state ? RUN_RING[card.state] : null;
  const dim = card.state === "skipped" || card.state === "pending";
  const tools = hovered || selected || focus;
  const trig = menuTrigger((x, y) => handlers.onMenu(card.id, x, y));
  const trigKey = (trig as { onKeyDown?: (e: unknown) => void }).onKeyDown;
  const problem = messages(card.issues).join(". ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${card.sub}${card.issues.length ? `. ${card.issues.length} to fix` : ""}`}
      accessibilityState={{ selected }}
      aria-selected={selected}
      testID={`card-${card.id}`}
      onPress={() => { handlers.onSelect(card.id); const now = Date.now(); if (now - last.current < DOUBLE_MS) { last.current = 0; handlers.onOpen(card.id); } else last.current = now; }}
      onHoverIn={() => onHover(card.id)}
      onHoverOut={() => onHover(null)}
      onFocus={() => { setFocus(true); handlers.onFocusId?.(card.id); }}
      onBlur={() => setFocus(false)}
      {...trig}
      {...webOnly({ onKeyDown: (e: KeyEventLike) => { handlers.onKey(e, card.id); trigKey?.(e); }, tabIndex: 0, dataSet: { card: card.id } })}
      style={[
        c.card, { left: card.x, top: card.y, width: card.w, height: card.h }, pointer,
        errors.length > 0 && { borderColor: "var(--danger)" as string },
        ring ? { borderColor: ring as string } : null,
        selected && c.cardSel, selected && shadow("0 0 0 3px var(--accent-wash)"),
        dim && ring === null && card.state ? { opacity: 0.55 } : null,
      ]}
    >
      <View style={c.tile}><Glyph name={card.icon ?? "record"} size={16} color="var(--ink-2)" /></View>
      <View style={c.text}>
        <Text numberOfLines={1} style={c.title}>{card.title}</Text>
        <Text numberOfLines={1} style={c.sub}>{card.sub}</Text>
      </View>
      {card.issues.length > 0 ? (
        <View testID={`issue-${card.id}`} accessibilityLabel={problem} {...webOnly({ title: problem })}>
          <Glyph name="warn" size={14} color={errors.length > 0 ? "var(--danger)" : "var(--warn)"} />
        </View>
      ) : null}
      {card.node && isPreviewKey(card.node.key) ? <PreviewMark testID={`preview-${card.node.key}`} /> : null}
      {card.kind === "ai" && agent ? <Face name={agent} kind="agent" size={18} /> : null}
      {tools ? (
        <View style={c.more}>
          <IconButton icon="more" label={`More for ${card.title}`} size={22} testID={`more-${card.id}`} onPress={() => handlers.onMenu(card.id, -1, -1)} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function TriggerCard({ card, triggers, selected, hovered, onHover, handlers, selectedIndex, onSelectTrigger, onOpenTrigger, onAddTrigger, onTriggerMenu, describe }: {
  card: CardNode;
  triggers: readonly DefTrigger[];
  selected: boolean;
  hovered: boolean;
  onHover(id: string | null): void;
  handlers: CardHandlers;
  selectedIndex: number | null;
  onSelectTrigger(i: number): void;
  onOpenTrigger(i: number): void;
  onAddTrigger(x: number, y: number): void;
  onTriggerMenu(i: number, x: number, y: number): void;
  describe(t: DefTrigger): string;
}): ReactElement {
  const issues: Issue[] = card.issues;
  const rows: ReactElement[] = [];
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i]!;
    const meta = triggerMeta(t.key, t.config);
    rows.push(
      <TriggerRow
        key={`${t.key}-${i}`} index={i} title={meta.title} sub={describe(t)} icon={meta.icon} selected={selectedIndex === i}
        onPress={() => onSelectTrigger(i)} onOpen={() => onOpenTrigger(i)} onMenu={(x, y) => onTriggerMenu(i, x, y)} hovered={hovered} preview={isPreviewKey(t.key, "trigger")}
      />,
    );
  }
  return (
    <View
      testID="card-trigger"
      style={[c.trig, { left: card.x, top: card.y, width: card.w, height: card.h }, selected && c.cardSel, selected && shadow("0 0 0 3px var(--accent-wash)"), issues.some((i) => i.severity === "error") && { borderColor: "var(--danger)" as string }]}
      {...webOnly({ onKeyDown: (e: KeyEventLike) => handlers.onKey(e, "trigger") })}
    >
      <View style={c.trigHead}>
        <Text style={c.trigLabel}>Trigger</Text>
        <Text numberOfLines={1} style={c.trigNote}>Any one starts a run</Text>
        <View style={{ flex: 1 }} />
        <IconButton icon="plus" label="Add a trigger" size={20} testID="add-trigger" onPress={() => onAddTrigger(-1, -1)} />
      </View>
      {rows}
      {triggers.length === 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a trigger" testID="trigger-empty" onPress={() => onAddTrigger(-1, -1)} style={[c.trigRow, pointer]}>
          <View style={c.tile}><Glyph name="plus" size={16} color="var(--ink-3)" /></View>
          <View style={c.text}><Text style={c.title}>Add a trigger</Text><Text style={c.sub}>Something has to start this</Text></View>
        </Pressable>
      ) : null}
    </View>
  );
}

function TriggerRow({ index, title, sub, icon, selected, onPress, onOpen, onMenu, hovered, preview = false }: { index: number; title: string; sub: string; icon: IconKey; selected: boolean; onPress(): void; onOpen(): void; onMenu(x: number, y: number): void; hovered: boolean; preview?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  const last = useRef(0);
  const trig = menuTrigger(onMenu);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      accessibilityState={{ selected }}
      testID={`trigger-${index}`}
      onPress={() => { onPress(); const now = Date.now(); if (now - last.current < DOUBLE_MS) { last.current = 0; onOpen(); } else last.current = now; }}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      {...trig}
      style={[c.trigRow, (over || selected) && { backgroundColor: selected ? "var(--sel)" as string : "var(--hover)" as string }, pointer]}
    >
      <View style={[c.tile, { backgroundColor: "var(--accent-wash)" as string }]}><Glyph name={icon} size={16} color="var(--accent)" /></View>
      <View style={c.text}>
        <Text numberOfLines={1} style={c.title}>{title}</Text>
        <Text numberOfLines={1} style={c.sub}>{sub}</Text>
      </View>
      {preview ? <PreviewMark testID={`preview-trigger-${index}`} /> : null}
      {over || selected || hovered ? <IconButton icon="more" label={`More for ${title}`} size={22} onPress={() => onMenu(-1, -1)} /> : null}
    </Pressable>
  );
}

/** The small plus on the line under a card: add a step here. */
export function AddDot({ x, y, label, onPress }: { x: number; y: number; label: string; onPress(px: number, py: number): void }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`add-${label}`}
      onPress={() => onPress(-1, -1)}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      {...webOnly({ title: label })}
      style={[c.addDot, { left: x - 9, top: y }, over && { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string }, pointer]}
    >
      <Glyph name="plus" size={11} color={over ? "var(--accent-ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

export const cardWidth = CARD_W;
export const cardHeight = CARD_H;
export const trigRow = TRIG_ROW;
export const trigHead = TRIG_HEAD;

export const c = StyleSheet.create({
  card: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 8, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  cardSel: { borderColor: "var(--accent)" as string },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string, flexShrink: 0 },
  text: { flex: 1, minWidth: 0, justifyContent: "center" },
  title: { fontSize: 13, lineHeight: 17, color: "var(--ink)" as string },
  sub: { fontSize: 11.5, lineHeight: 15, color: "var(--ink-3)" as string },
  more: { position: "absolute", right: 6, top: 4 },
  trig: { position: "absolute", borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  trigHead: { height: TRIG_HEAD, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  trigLabel: { fontSize: 11, fontWeight: "600", color: "var(--ink-2)" as string },
  trigNote: { fontSize: 11, color: "var(--ink-4)" as string },
  trigRow: { height: TRIG_ROW, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 8, borderTopWidth: 0 },
  addDot: { position: "absolute", width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, alignItems: "center", justifyContent: "center" },
});
