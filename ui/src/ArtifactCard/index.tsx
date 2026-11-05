// ui/ArtifactCard: one artifact as a card. A small picture on the left (taken at publish; a drawn stand-in until there is one), the title, one quiet line, and Open, Copy link and "...".
// The whole card opens the artifact and paints a hover. The same card sits in a chat and in the Artifacts grid (`grid` adds the "From <chat>" link). Colours are skin tokens.

import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { standIn, subline } from "./model.ts";
import type { ArtifactInfo } from "./model.ts";
import { TimePop } from "../Time/index.tsx";

export * from "./model.ts";

export interface ArtifactCardProps {
  info: ArtifactInfo;
  meId: string;
  now: number;
  nameOf?: (id: string) => string;
  /** A card in the Artifacts grid also says which chat made it. */
  grid?: boolean;
  onOpen: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onBrowser: () => void;
  /** Deletes it, after the card has asked. Omitted for an artifact someone else owns. */
  onDelete?: (() => void) | undefined;
  onFrom?: ((chatId: string) => void) | undefined;
  testID?: string;
  /** The card's menu, built by the host (right-click, long press and the More button open the same one). It gets the way to ask "Delete?" on the card. Absent: Share, Open in browser, Delete. */
  menu?: ((askDelete: () => void) => MenuEntry[]) | undefined;
}

const RING = { boxShadow: "inset 0 0 0 1px var(--line)" } as unknown as ViewStyle;
const RING_HOVER = { boxShadow: "inset 0 0 0 1px var(--line-2)", backgroundColor: "var(--hover)" } as unknown as ViewStyle;

/** Where a menu opens when it comes from a button: under the control that has focus. */
function anchor(): { x: number; y: number } {
  const doc = (globalThis as { document?: { activeElement?: { getBoundingClientRect?: () => { right: number; bottom: number } } | null } }).document;
  const box = doc?.activeElement?.getBoundingClientRect?.();
  return box ? { x: Math.max(8, box.right - 200), y: box.bottom + 4 } : { x: 8, y: 48 };
}

/** The drawing shown until the picture taken at publish arrives: four quiet page shapes in the accent. */
export function Thumb({ info, size }: { info: ArtifactInfo; size?: { w: number; h: number } }): ReactElement {
  const w = size?.w ?? 120;
  const h = size?.h ?? 80;
  const box = [st.thumb, { width: w, height: h }];
  if (info.thumb !== undefined && info.thumb !== "") return <Image testID="artifact-thumb" accessibilityIgnoresInvertColors source={{ uri: info.thumb }} style={[...box, st.img]} />;
  const k = standIn(info.id);
  const bar = (wd: string, strong = false): ReactElement => <View style={[st.bar, strong && st.barStrong, { width: wd as unknown as number }]} />;
  return (
    <View testID="artifact-thumb-drawn" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={box}>
      {k === 0 ? <>{bar("46%", true)}{bar("92%")}{bar("84%")}{bar("90%")}{bar("52%")}</> : null}
      {/* ui-rows-lint: not a list (bars of a drawn placeholder thumbnail) */}
      {k === 1 ? <>{bar("38%", true)}<View style={st.bars}>{[30, 52, 40, 72, 60, 88].map((p, i) => <View key={i} style={[st.col, { height: `${p}%` as unknown as number }]} />)}</View></> : null}
      {/* ui-rows-lint: not a list (bars of a drawn placeholder thumbnail) */}
      {k === 2 ? <>{[70, 55, 64, 40].map((p, i) => <View key={i} style={st.rw}><View style={[st.tick, i < 2 && st.tickOn]} />{bar(`${p}%`)}</View>)}</> : null}
      {k === 3 ? <View style={st.grid}>{Array.from({ length: 12 }, (_, i) => <View key={i} style={[st.cell, i < 3 && st.cellHead]} />)}</View> : null}
    </View>
  );
}

function Quiet({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={(e: unknown) => { (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.(); onPress(); }} testID={testID} style={({ hovered }: { hovered?: boolean }) => [st.quiet, hovered === true && st.quietHover]}>
      <Text style={st.quietText}>{label}</Text>
    </Pressable>
  );
}

export function ArtifactCard(p: ArtifactCardProps): ReactElement {
  const { info } = p;
  const { element, show } = useMenu();
  const [sure, setSure] = useState(false);
  const line = useMemo(() => subline(info, p.meId, p.now, p.nameOf), [info, p.meId, p.now, p.nameOf]);
  const openMenu = useCallback((x: number, y: number) => {
    const items: MenuEntry[] = p.menu ? p.menu(() => setSure(true)) : [{ label: "Share", onSelect: p.onShare }, { label: "Open in browser", onSelect: p.onBrowser }];
    if (!p.menu && p.onDelete) items.push({ separator: true }, { label: "Delete", danger: true, onSelect: () => setSure(true) });
    show(items, x, y, "context", { label: "Artifact" });
  }, [p.menu, p.onShare, p.onBrowser, p.onDelete, show]);
  const more = useCallback(() => { const at = anchor(); openMenu(at.x, at.y); }, [openMenu]);
  const id = p.testID ?? `artifact-card-${info.id}`;
  if (sure) {
    return (
      <View testID={`${id}-sure`} style={[st.card, RING]}>
        <View style={st.body}>
          <Text style={st.title} numberOfLines={1}>{`Delete “${info.name}”?`}</Text>
          <Text style={st.line}>The link stops working for everyone it was shared with.</Text>
          <View style={st.acts}>
            <Quiet label="Keep it" testID={`${id}-keep`} onPress={() => setSure(false)} />
            <Quiet label="Delete" testID={`${id}-delete`} onPress={() => { setSure(false); p.onDelete?.(); }} />
          </View>
        </View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${info.name}`}
      testID={id}
      onPress={p.onOpen}
      {...menuTrigger(openMenu)}
      {...(Platform.OS === "web" ? { dataSet: { artifactCard: info.id } } : {})}
      style={({ hovered }: { hovered?: boolean }) => [st.card, hovered === true ? RING_HOVER : RING, p.grid === true && st.cardGrid]}
    >
      <Thumb info={info} />
      <View style={st.body}>
        <Text style={st.title} numberOfLines={1}>{info.name}</Text>
        {info.updatedAt !== undefined ? <TimePop at={info.updatedAt}><Text testID={`${id}-line`} style={st.line} numberOfLines={2}>{line}</Text></TimePop> : <Text testID={`${id}-line`} style={st.line} numberOfLines={2}>{line}</Text>}
        {p.grid === true && p.onFrom !== undefined && info.from !== undefined
          ? <Pressable accessibilityRole="link" testID={`${id}-from`} onPress={(e: unknown) => { (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.(); p.onFrom?.(info.from!.id); }} style={st.from}><Text style={st.fromText} numberOfLines={1}>{`From ${info.from.title}`}</Text></Pressable>
          : null}
        <View style={st.acts}>
          <Quiet label="Open" testID={`${id}-open`} onPress={p.onOpen} />
          <Quiet label="Copy link" testID={`${id}-copy`} onPress={p.onCopyLink} />
          <Pressable accessibilityRole="button" accessibilityLabel="More" testID={`${id}-more`} onPress={(e: unknown) => { (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.(); more(); }} style={({ hovered }: { hovered?: boolean }) => [st.more, hovered === true && st.quietHover]}>
            <Text style={st.moreText}>{"…"}</Text>
          </Pressable>
        </View>
      </View>
      {element}
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: "row", gap: 14, padding: 10, borderRadius: 16, backgroundColor: "var(--raised)" as string, maxWidth: 560, width: "100%" },
  cardGrid: { maxWidth: 9999 },
  body: { flex: 1, minWidth: 0, justifyContent: "center" },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  from: { alignSelf: "flex-start", marginTop: 2 },
  fromText: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string, textDecorationLine: "underline" },
  acts: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 6, marginLeft: -9 },
  quiet: { height: 28, paddingHorizontal: 9, borderRadius: 9, justifyContent: "center" },
  quietHover: { backgroundColor: "var(--hover)" },
  quietText: { fontSize: 13, color: "var(--ink-3)" as string, fontWeight: "500" },
  more: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  moreText: { fontSize: 16, lineHeight: 18, color: "var(--ink-3)" as string },
  thumb: { borderRadius: 10, backgroundColor: "var(--sunk)" as string, padding: 9, gap: 5, overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--line)" } as ViewStyle,
  img: { padding: 0 },
  bar: { height: 5, borderRadius: 3, backgroundColor: "var(--ink-4)" as string, opacity: 0.45 },
  barStrong: { height: 7, backgroundColor: "var(--accent)" as string, opacity: 0.8 },
  bars: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  col: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: "var(--accent)" as string, opacity: 0.55 },
  rw: { flexDirection: "row", alignItems: "center", gap: 6 },
  tick: { width: 8, height: 8, borderRadius: 3, borderWidth: 1.3, borderColor: "var(--ink-4)" as string },
  tickOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cell: { width: "31%", height: 9, borderRadius: 3, backgroundColor: "var(--ink-4)" as string, opacity: 0.45 },
  cellHead: { backgroundColor: "var(--accent)" as string, opacity: 0.8 },
});
