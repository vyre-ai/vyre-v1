// Small pieces the chat's memory surfaces share: the source chip (a press opens the chat at that line, or the record or run it came from), a quiet text button, a quiet icon button, the
// web-only props for focus and hover, and the glyph of a source. Colours are tokens, so a skin switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { sourceGlyph } from "../../files/memory/know.ts";
import { Icon } from "../../files/memory/parts.tsx";
import type { IconName } from "../../files/memory/parts.tsx";
import { useChatMemory } from "./data.tsx";
import type { ChatFact } from "./model.ts";

export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

/** The right-click (and menu key, and long press) props of a surface that sits inside a message: it opens its own menu and the message's menu stays closed. */
export function ownMenu(open: (x: number, y: number) => void): Record<string, unknown> {
  const base = menuTrigger(open) as Record<string, unknown>;
  type Ev = { stopPropagation?: () => void; key?: string };
  // every handler the trigger gives stops the event reaching the message's own menu; a key handler only for the menu keys
  for (const name of Object.keys(base)) {
    const f = base[name] as ((e: Ev) => void) | undefined;
    if (typeof f !== "function") continue;
    const keep = (e: Ev): boolean => name !== "onKeyDown" || (e.key ?? "").startsWith("Context") || e.key === "F10";
    base[name] = (e: Ev): void => { if (keep(e)) e.stopPropagation?.(); f(e); };
  }
  return base;
}

/** `ownMenu` plus a key handler of the surface's own: both run on one keydown (the menu key opens the menu, the rest is the surface's). */
export function ownMenuKeys(open: (x: number, y: number) => void, onKey: (e: { key: string; target: unknown; currentTarget: unknown; preventDefault?: () => void }) => void): Record<string, unknown> {
  const base = ownMenu(open);
  const menuKey = base.onKeyDown as ((e: unknown) => void) | undefined;
  return { ...base, onKeyDown: (e: { key: string; target: unknown; currentTarget: unknown; preventDefault?: () => void }): void => { onKey(e); menuKey?.(e); } };
}

const GLYPH: Record<ReturnType<typeof sourceGlyph>, IconName> = { chat: "chat", channel: "hash", record: "sheet", run: "run", note: "note" };
export const glyphOf = (kind: ChatFact["sourceKind"]): IconName => GLYPH[sourceGlyph(kind as never)];

/** The quotation mark of a quote card (the files icon set has none). */
export function QuoteIcon({ size = 14, color = "var(--accent)" }: { size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", width: size, stroke: color, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } },
    createElement("path", { key: "a", d: "M3.5 10.5V8a3 3 0 013-3M9 10.5V8a3 3 0 013-3" }), createElement("path", { key: "b", d: "M3.5 10.5h2.5V8H3.5zM9 10.5h2.5V8H9z" }));
}

/** The label of a source chip: the title of the chat, run or record when the row has it, otherwise a plain name for the kind. */
export function sourceLabel(f: Pick<ChatFact, "sourceKind" | "sourceTitle">): string {
  if (f.sourceTitle) return f.sourceTitle;
  const k = f.sourceKind;
  return k === "chat" ? "A chat" : k === "channel" ? "A channel" : k === "record" ? "A record" : k === "run" ? "An automation run" : k === "journey" ? "A journey" : k === "task" ? "A task" : "Written by hand";
}

/** Opens where a fact came from: the chat at that line, or the record, run or task. A fact whose source is gone has no link and the chip says nothing happens. */
export function useOpenSource(): (f: Pick<ChatFact, "sourceKind" | "sourceRef" | "sourceLink">) => void {
  const mem = useChatMemory();
  return (f) => {
    if (!mem) return;
    if (f.sourceLink && f.sourceKind === "chat") mem.nav.openLink(f.sourceLink);
    else mem.nav.openSource(f.sourceKind, f.sourceRef, f.sourceLink);
  };
}

/** "(chat icon) Brooks kickoff": a press jumps to that moment in the old chat. */
export function ChipLink({ icon, label, onPress, testID, a11y }: { icon: IconName; label: string; onPress: () => void; testID?: string; a11y?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="link" accessibilityLabel={a11y ?? `Open the source: ${label}`} {...(testID ? { testID } : {})} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[st.chip, over && st.chipOver]}
    >
      <Icon name={icon} size={12} color="var(--ink-3)" />
      <Text numberOfLines={1} style={st.chipText}>{label}</Text>
    </Pressable>
  );
}

/** A quiet text button in the accent colour (Undo, Edit, Restore, Open page). `quiet` draws it in ink-2 instead. */
export function LinkButton({ label, onPress, testID, quiet = false, a11y }: { label: string; onPress: () => void; testID?: string; quiet?: boolean; a11y?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={a11y ?? label} {...(testID ? { testID } : {})} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[st.link, over && st.linkOver]}
    >
      <Text style={[st.linkText, quiet && st.quiet]}>{label}</Text>
    </Pressable>
  );
}

/** A 24 px icon button with a hover wash (Edit and Forget on a Knows row). */
export function ToolButton({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} {...(testID ? { testID } : {})} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[st.tool, over && st.toolOver]}
    >
      <Icon name={icon} size={14} color={over ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  chip: { height: 20, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6, backgroundColor: "var(--sunk)" as string, maxWidth: 260, flexShrink: 1 },
  chipOver: { backgroundColor: "var(--hover)" as string },
  chipText: { flexShrink: 1, fontSize: 12, color: "var(--ink-2)" as string },
  link: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5 },
  linkOver: { backgroundColor: "var(--accent-wash)" as string },
  linkText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  quiet: { color: "var(--ink-2)" as string },
  tool: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolOver: { backgroundColor: "var(--hover)" as string },
});
