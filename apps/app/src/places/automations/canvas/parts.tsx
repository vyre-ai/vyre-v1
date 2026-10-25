// Small shared pieces of the Automations place: underline sub tabs, icon buttons, the face for an agent or person, the count badge. Colours are skin tokens, so a skin
// switch repaints with no re-render. Sizes follow the prototype's Automations place (vyre-automations.html).
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Glyph } from "./icons.tsx";
import type { GlyphName } from "./icons.tsx";
import type { IconKey } from "./model.ts";

export const web = Platform.OS === "web";
export const webOnly = (o: Record<string, unknown>): Record<string, unknown> => (web ? o : {});
export const pointer = (web ? { cursor: "pointer" } : {}) as ViewStyle;
export const shadow = (v: string): ViewStyle => (web ? ({ boxShadow: v } as ViewStyle) : {});

export interface KeyEventLike { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }

/** A 26 px icon button: hover paints the quiet hover token, label is the accessible name and the tooltip. */
export function IconButton({ icon, label, onPress, on = false, size = 26, testID }: { icon: GlyphName | IconKey; label: string; onPress?: () => void; on?: boolean; size?: number; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      {...webOnly({ title: label })}
      style={[s.iconBtn, { width: size, height: size }, (over || on) && { backgroundColor: "var(--hover)" }, pointer]}
    >
      <Glyph name={icon} size={15} color={over || on ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

/** A text button in the prototype's header style: quiet by default, accent when primary. */
export function TextButton({ label, icon, onPress, primary = false, disabled = false, testID, trailing }: { label: string; icon?: GlyphName | IconKey; onPress?: () => void; primary?: boolean; disabled?: boolean; testID?: string; trailing?: ReactNode }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[s.textBtn, primary && s.textBtnPrimary, over && !primary && { backgroundColor: "var(--hover)" }, over && primary && { opacity: 0.9 }, disabled && { opacity: 0.45 }, pointer]}
    >
      {icon ? <Glyph name={icon} size={14} color={primary ? "var(--accent-ink)" : "var(--ink-2)"} /> : null}
      <Text style={[s.textBtnLabel, primary && { color: "var(--accent-ink)" as string }]} numberOfLines={1}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

export interface SubTab { key: string; label: string; note?: string; tone?: "danger" | "muted" }

/** Underline tabs (the prototype's pane tabs): the active one is ink with a 2 px accent bar under it; left and right arrows move, Home and End jump. */
export function SubTabs({ tabs, active, onSelect, label }: { tabs: readonly SubTab[]; active: string; onSelect: (key: string) => void; label: string }): ReactElement {
  const keys = (key: string) => (e: KeyEventLike): void => {
    const i = tabs.findIndex((t) => t.key === key);
    const to = e.key === "ArrowRight" ? tabs[Math.min(tabs.length - 1, i + 1)] : e.key === "ArrowLeft" ? tabs[Math.max(0, i - 1)] : e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : undefined;
    if (to && to.key !== key) { e.preventDefault?.(); onSelect(to.key); }
  };
  const items: ReactElement[] = [];
  for (const t of tabs) {
    const on = t.key === active;
    items.push(
      <Pressable
        key={t.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        aria-selected={on}
        accessibilityLabel={t.label}
        testID={`subtab-${t.key}`}
        onPress={() => onSelect(t.key)}
        {...webOnly({ onKeyDown: keys(t.key), tabIndex: on ? 0 : -1 })}
        style={[s.tab, on && s.tabOn, pointer]}
      >
        <Text style={[s.tabText, on && { color: "var(--ink)" as string }]}>{t.label}</Text>
        {t.note ? <Text style={[s.tabNote, t.tone === "danger" && { color: "var(--danger)" as string }]}>{t.note}</Text> : null}
      </Pressable>,
    );
  }
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={s.tabs}>
      {items}
    </View>
  );
}

/** A small count pill; tone danger for failed runs. */
export function Badge({ n, tone = "muted", testID }: { n: number | string; tone?: "muted" | "danger" | "accent"; testID?: string }): ReactElement {
  const bg = tone === "danger" ? "var(--danger)" : tone === "accent" ? "var(--accent)" : "var(--press)";
  const fg = tone === "muted" ? "var(--ink-2)" : "#fff";
  return (
    <View testID={testID} style={[s.badge, { backgroundColor: bg as string }]}>
      <Text style={[s.badgeText, { color: fg as string }]}>{String(n)}</Text>
    </View>
  );
}

/** A dot in a status colour. */
export function Dot({ tone, size = 7 }: { tone: "ok" | "warn" | "danger" | "muted" | "accent"; size?: number }): ReactElement {
  const bg = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : tone === "accent" ? "var(--accent)" : "var(--ink-4)";
  return <View aria-hidden style={{ width: size, height: size, borderRadius: size, backgroundColor: bg as string }} />;
}

/** A person is a round marble, an agent a pixel face on a soft tint: the shared Avatar. */
export function Face({ name, kind = "person", size = 18 }: { name: string; kind?: string; size?: number }): ReactElement {
  return (
    <View aria-hidden style={{ width: size, height: size, flexShrink: 0 }}>
      <Avatar name={name} kind={kind === "person" ? "person" : "agent"} size={size} />
    </View>
  );
}

export const s = StyleSheet.create({
  iconBtn: { alignItems: "center", justifyContent: "center", borderRadius: 7 },
  textBtn: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 7 },
  textBtnPrimary: { backgroundColor: "var(--accent)" as string },
  textBtnLabel: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  tabs: { flexDirection: "row", alignItems: "flex-end", gap: 18, paddingHorizontal: 20, height: 38, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tab: { height: 38, flexDirection: "row", alignItems: "center", gap: 6, borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: "var(--ink)" as string },
  tabText: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string },
  tabNote: { fontSize: 12, lineHeight: 16, color: "var(--ink-4)" as string },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
});
