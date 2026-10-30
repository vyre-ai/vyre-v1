// ui/Row: the one list item. Hover and selection paint the whole row, edge to edge (spec UI rows).
// Least height 28 with one line, 44 with a note, 62 for the two-line variant: a list can lay rows out without measuring, because the text never wraps (one line, or two clamped), and a row
// whose content is taller (a button in the trailing slot, a note that wraps in a card) simply grows, so nothing paints over the next row. The note sits under the title.
// Optional leading and trailing slots sit inside the Pressable, so the hover and selection paint stays whole-row (ruling 36): leading and trailing are centred to the text column.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, memo, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { RowProps } from "./props.ts";
import { injectCss } from "../theme/css.ts";

export type { RowProps } from "./props.ts";

export const ROW_HEIGHT = 28;
export const ROW_HEIGHT_WITH_NOTE = 44;
export const ROW_HEIGHT_TALL = 62;

export function rowHeight(note?: string, tall = false): number {
  if (tall) return ROW_HEIGHT_TALL;
  return note ? ROW_HEIGHT_WITH_NOTE : ROW_HEIGHT;
}

// On the web a row is plain elements, not React Native views: a list scrolls by mounting a few rows a frame, and what one row costs is what a scroll costs (the Records table and the Files list
// were over the frame budget on the views alone). The styles come from one stylesheet set once; only what changes per row (height, hover and selection tokens) is inline. Every list gets this, and
// the test ids, heights, tokens and keys are the ones the views drew. Off the web the Pressable below draws the row.
// The layout is set inline (element styles from script are always allowed, so a page that drops injected <style> text still lays a row out); the sheet only adds what inline cannot, the hover paint.
let cssDone = false;
function ensureRowCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (!d || !d.head) return;
  injectCss(d, "vyre-ui-row", ".vyre-row:hover{background-color:var(--hover)}.vyre-row{outline-offset:-2px;cursor:pointer}");
  cssDone = true;
}
ensureRowCss();

const ROW_S = { display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, position: "relative", boxSizing: "border-box", width: "100%", padding: "0 8px", borderRadius: 6 } as const;
const LEAD_S = { flex: "none", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center" } as const;
const TRAIL_S = { flex: "none", display: "flex", flexDirection: "row", alignItems: "center", marginLeft: 8 } as const;
const TEXT_S = { flex: "1 1 0%", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" } as const;
const TITLE_S = { color: "var(--ink)", fontSize: 13, lineHeight: "18px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const TLINE_S = { display: "flex", flexDirection: "row", alignItems: "baseline", minWidth: 0, gap: 6 } as const;
const TITLE_IN_LINE_S = { ...TITLE_S, flex: "none", maxWidth: "70%" } as const;
const SUFFIX_S = { flex: "0 1 auto", minWidth: 0, color: "var(--ink-3)", fontSize: 12, lineHeight: "18px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const MARKS_S = { flex: "none", display: "flex", flexDirection: "row", alignItems: "center", gap: 4 } as const;
const NOTE_S = { color: "var(--ink-3)", fontSize: 11.5, lineHeight: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const NOTE2_S = { color: "var(--ink-3)", fontSize: 11.5, lineHeight: "16px", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 } as const;

const h = createElement;
function WebRow({ id, title, titleSuffix, titleMarks, noteLead, noteLeadTone = "accent", tall = false, emphasis = false, note, selected = false, hovered = false, leading, trailing, onPress, domProps }: RowProps): ReactElement {
  ensureRowCss();
  const tid = (suffix: string): string | undefined => (id ? `row-${id}${suffix}` : undefined);
  const { style: extra, ...dom } = (domProps ?? {}) as { style?: Record<string, unknown> } & Record<string, unknown>;
  const titleEl = h("span", { style: emphasis ? { ...TITLE_S, ...BOLD } : TITLE_S }, title);
  return h(
    "div",
    {
      role: "button", tabIndex: 0, "aria-label": title, "aria-selected": selected, "data-testid": tid(""), className: "vyre-row",
      style: { ...ROW_S, minHeight: rowHeight(note, tall), ...(onPress ? { cursor: "pointer" } : null), ...(selected ? SELECTED : hovered ? HOVER : null), ...extra },
      ...(onPress ? {
        onClick: (e: unknown) => onPress(e as never),
        onKeyDown: (e: { key?: string; preventDefault?: () => void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault?.(); onPress(e as never); } },
      } : {}),
      ...dom,
    },
    leading ? h("div", { style: LEAD_S, "data-testid": tid("-leading") }, leading) : null,
    h(
      "div", { style: TEXT_S },
      titleSuffix || titleMarks
        ? h("div", { style: TLINE_S }, h("span", { style: emphasis ? { ...TITLE_IN_LINE_S, ...BOLD } : TITLE_IN_LINE_S }, title), titleSuffix ? h("span", { style: SUFFIX_S, "data-testid": tid("-suffix") }, titleSuffix) : null, titleMarks ? h("div", { style: MARKS_S, "data-testid": tid("-marks") }, titleMarks) : null)
        : titleEl,
      note ? h("div", { style: tall ? NOTE2_S : NOTE_S }, noteLead ? h("span", { "data-testid": tid("-notelead"), style: noteLeadTone === "warning" ? NOTE_LEAD_WARN : NOTE_LEAD }, noteLead) : null, noteLead ? " \u00b7 " : null, note) : null,
    ),
    trailing ? h("div", { style: TRAIL_S, "data-testid": tid("-trailing") }, trailing) : null,
  );
}

export const Row = memo(function Row(props: RowProps) {
  return Platform.OS === "web" ? WebRow(props) : <NativeRow {...props} />;
});

const NativeRow = memo(function NativeRow({ id, title, titleSuffix, titleMarks, noteLead, noteLeadTone = "accent", tall = false, emphasis = false, note, selected = false, hovered = false, leading, trailing, onPress }: RowProps) {
  const [over, setOver] = useState(false);
  const lit = hovered || over;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={id ? `row-${id}` : undefined}
      style={[styles.row, { minHeight: rowHeight(note, tall) }, lit && HOVER, selected && SELECTED]}
    >
      {leading ? <View testID={id ? `row-${id}-leading` : undefined} style={styles.leading}>{leading}</View> : null}
      <View style={styles.text}>
        {titleSuffix || titleMarks ? (
          <View style={styles.titleLine}>
            <Text numberOfLines={1} style={[styles.title, styles.titleMain, emphasis && BOLD]}>{title}</Text>
            {titleSuffix ? <Text numberOfLines={1} testID={id ? `row-${id}-suffix` : undefined} style={styles.suffix}>{titleSuffix}</Text> : null}
            {titleMarks ? <View testID={id ? `row-${id}-marks` : undefined} style={styles.marks}>{titleMarks}</View> : null}
          </View>
        ) : <Text numberOfLines={1} style={[styles.title, emphasis && BOLD]}>{title}</Text>}
        {note ? (
          <Text numberOfLines={tall ? 2 : 1} style={styles.note}>
            {noteLead ? <><Text testID={id ? `row-${id}-notelead` : undefined} style={noteLeadTone === "warning" ? NOTE_LEAD_WARN : NOTE_LEAD}>{noteLead}</Text>{" \u00b7 "}</> : null}
            {note}
          </Text>
        ) : null}
      </View>
      {trailing ? <View testID={id ? `row-${id}-trailing` : undefined} style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
});

// Plain objects (not StyleSheet ids) so the painted token is visible in the element's inline style.
const HOVER = { backgroundColor: "var(--hover)" };
const NOTE_LEAD = { color: "var(--accent)", fontWeight: "500" as const };
const NOTE_LEAD_WARN = { color: "var(--warn)", fontWeight: "500" as const };
const BOLD = { fontWeight: "600" as const };
const SELECTED = { backgroundColor: "var(--sel)" };

const styles = StyleSheet.create({
  row: { width: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: 6 },
  leading: { flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  trailing: { flexShrink: 0, flexDirection: "row", alignItems: "center", marginLeft: 8 },
  text: { flex: 1, minWidth: 0, justifyContent: "center" },
  title: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 18 },
  titleLine: { flexDirection: "row", alignItems: "baseline", minWidth: 0, gap: 6 },
  titleMain: { flexShrink: 0, maxWidth: "70%" },
  suffix: { flexShrink: 1, color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 18 },
  marks: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  note: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16 },
});
