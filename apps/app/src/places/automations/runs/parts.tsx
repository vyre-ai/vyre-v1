// Small pieces of the Runs views: the quiet text button of the prototype (.qb), icon buttons, the status mark, the Automation tile and the face of a person or agent.
// Colours are skin tokens, so a skin switch repaints with no re-render. Sizes follow the prototype's Automations place (vyre-automations.html).
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { Glyph } from "./glyphs.tsx";
import type { GlyphName } from "./glyphs.tsx";
import type { RunStatus } from "./model.ts";

export const web = Platform.OS === "web";
export const webOnly = (o: Record<string, unknown>): Record<string, unknown> => (web ? o : {});
export const pointer = (web ? { cursor: "pointer" } : {}) as ViewStyle;

export interface KeyEventLike { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }

/** A 24 px icon button; hover paints the quiet hover token. The label is the accessible name and the tooltip. */
export function IconButton({ icon, label, onPress, size = 24, testID }: { icon: GlyphName; label: string; onPress?: (event: unknown) => void; size?: number; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      {...webOnly({ title: label })}
      style={[s.iconBtn, { width: size, height: size }, over && { backgroundColor: "var(--press)" }, pointer]}
    >
      <Glyph name={icon} size={14} color={over ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

export type QuietTone = "plain" | "accent" | "danger" | "filled";
/** The prototype's .qb: 26 px, 12.5 px type, tinted on hover. */
export function QuietButton({ label, icon, onPress, tone = "plain", disabled = false, testID, title }: { label: string; icon?: GlyphName; onPress?: (event: unknown) => void; tone?: QuietTone; disabled?: boolean; testID?: string; title?: string }): ReactElement {
  const [over, setOver] = useState(false);
  const filled = tone === "filled";
  const fg = filled ? "var(--win)" : tone === "accent" ? "var(--accent)" : tone === "danger" ? "var(--danger)" : over ? "var(--ink)" : "var(--ink-2)";
  // react-native-web drops a color-mix() backgroundColor, so the danger wash is a one-colour gradient layer
  const dangerLayer = "linear-gradient(color-mix(in srgb, var(--danger) 12%, transparent), color-mix(in srgb, var(--danger) 12%, transparent))";
  const wash = tone === "danger" ? { backgroundImage: dangerLayer as unknown as undefined } : { backgroundColor: (tone === "accent" ? "var(--accent-wash)" : "var(--hover)") as string };
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} testID={testID} disabled={disabled} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      {...webOnly({ dataSet: { tone }, ...(title ? { title } : {}) })}
      style={[s.qb, filled && { backgroundColor: "var(--ink)" as string, paddingHorizontal: 12, borderRadius: 7 }, over && !disabled && !filled && wash, disabled && { opacity: 0.4 }, pointer]}
    >
      {icon ? <Glyph name={icon} size={13} color={fg} /> : null}
      <Text style={[s.qbText, { color: fg as string }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const STATUS_ICON: Readonly<Record<RunStatus, GlyphName>> = { succeeded: "check", failed: "x", waiting: "hourglass", running: "retry", stopped: "stop", queued: "clock" };
const STATUS_COLOR: Readonly<Record<RunStatus, string>> = { succeeded: "var(--ok)", failed: "var(--danger)", waiting: "var(--warn)", running: "var(--accent)", stopped: "var(--ink-3)", queued: "var(--ink-3)" };
export const statusColor = (s: RunStatus): string => STATUS_COLOR[s];
export const statusGlyph = (s: RunStatus): GlyphName => STATUS_ICON[s];

/** The 20 px status mark at the left of a run row. */
export function StatusMark({ status, size = 16 }: { status: RunStatus; size?: number }): ReactElement {
  return <View testID={`status-${status}`} style={s.mark}><Glyph name={STATUS_ICON[status]} size={size} color={STATUS_COLOR[status]} /></View>;
}

/** An Automation's tile: the accent wash with a bolt. */
export function Tile({ size = 28 }: { size?: number }): ReactElement {
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center" }}>
      <Glyph name="bolt" size={Math.round(size * 0.55)} color="var(--accent)" />
    </View>
  );
}

function hueOf(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return (h % 12) * 30;
}

/** A person is a circle, an agent a rounded square; the colour comes from the id (the name when no id is passed). */
export function Face({ name, seedId, kind = "person", size = 24 }: { name: string; seedId?: string | undefined; kind?: string; size?: number }): ReactElement {
  const hue = hueOf(seedId !== undefined && seedId !== "" ? seedId : name);
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: kind === "person" ? size : Math.round(size * 0.3), backgroundColor: `hsla(${hue}, 65%, 52%, 0.22)` as string, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: `hsl(${hue}, 55%, 46%)` as string, fontSize: Math.max(9, Math.round(size * 0.48)), fontWeight: "600" }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

/** The quiet "Test" badge beside a title. */
export function TestBadge(): ReactElement {
  return <View style={s.tbadge}><Glyph name="flask" size={11} color="var(--ink-3)" /><Text style={s.tbadgeText}>Test</Text></View>;
}

/** The 52 px header of a main view: a tile, the title, a quiet meta line, and the controls at the right. */
export function MainHead({ tile, title, meta, children }: { tile: ReactElement; title: string; meta?: string; children?: ReactNode }): ReactElement {
  return (
    <View style={s.head}>
      {tile}
      <Text accessibilityRole="header" numberOfLines={1} style={s.headTitle}>{title}</Text>
      {meta ? <Text numberOfLines={1} style={s.headMeta}>{meta}</Text> : null}
      <View style={{ flex: 1 }} />
      {children}
    </View>
  );
}

export const s = StyleSheet.create({
  head: { height: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 20, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  headTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  headMeta: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  iconBtn: { alignItems: "center", justifyContent: "center", borderRadius: 6 },
  qb: { height: 26, paddingHorizontal: 9, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  qbText: { fontSize: 12.5, lineHeight: 16, fontWeight: "500" },
  mark: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  tbadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  tbadgeText: { fontSize: 11, lineHeight: 14, fontWeight: "500", color: "var(--ink-3)" as string },
});

interface RowNode { contains?(n: unknown): boolean; querySelector(sel: string): { focus?: () => void } | null }
/** Moves the focus to the next or previous row inside `container` (the arrow keys in a list). Rows carry data-row; a row the list has not drawn yet is not reachable until it scrolls in. */
export function moveRowFocus(container: unknown, from: unknown, dir: 1 | -1): boolean {
  const c = container as { querySelectorAll?(sel: string): ArrayLike<RowNode> } | null;
  const rows = c?.querySelectorAll ? Array.from(c.querySelectorAll("[data-row]")) : [];
  if (rows.length === 0) return false;
  const at = rows.findIndex((r) => r === from || r.contains?.(from));
  const to = rows[at < 0 ? (dir === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + dir))];
  to?.querySelector("[role=button]")?.focus?.();
  return true;
}
