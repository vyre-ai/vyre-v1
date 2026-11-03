// Notes, the small pieces every part of the page draws: buttons in the prototype's three weights, the icon button with its tooltip, a picture, the link card, a clipped page's quote and
// address, faces, a tick box and a key cap. Sizes and colours follow the approved prototype; every colour is a skin token.
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Ico } from "./icons.tsx";
import type { IcoName } from "./icons.tsx";
import { hostOf, shortUrl, siteMark } from "./model.ts";
import type { LinkPreview } from "./take.ts";

export const web = Platform.OS === "web";
/** Props React Native Web passes to the element that React Native's types do not list. */
export const dom = (p: Record<string, unknown>): Record<string, unknown> => (web ? p : {});

type PressAt = (x: number, y: number) => void;
/** Where under a pressed control a popover opens: its left edge and bottom. */
export function pressPoint(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.bottom + 4 } : { x: ev.nativeEvent?.pageX ?? -1, y: ev.nativeEvent?.pageY ?? -1 };
}

/** A square icon button (28, or `size`) that tints on hover and says its name as a tooltip. `on` keeps the pressed tint. */
export function IconBtn({ icon, label, onPress, size = 28, iconSize = 16, on = false, testID, tabbable = true, color, style, over = false }: {
  icon: IcoName; label: string; onPress: PressAt; size?: number; iconSize?: number; on?: boolean; testID?: string; tabbable?: boolean; color?: string; style?: object | null;
  /** It sits over a picture: a translucent card behind it. */
  over?: boolean;
}): ReactElement {
  return (
    <Tooltip text={label}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} testID={testID}
        onPress={(e) => { (e as unknown as { stopPropagation?: () => void }).stopPropagation?.(); const p = pressPoint(e); onPress(p.x, p.y); }}
        style={[st.ib, { width: size, height: size }, on ? st.ibOn : null, style]}
        {...dom({ dataSet: { nbtn: "ghost", ...(over ? { nover: "true" } : {}) }, ...(tabbable ? {} : { tabIndex: -1 }) })}
      >
        <Ico name={icon} size={iconSize} color={color ?? (on ? "var(--ink)" : "var(--ink-3)")} />
      </Pressable>
    </Tooltip>
  );
}

/** A text button: quiet (the soft fill), ghost (no fill until hover), or primary (the accent). `sm` is the 26 high size. */
export function Btn({ label, onPress, kind = "quiet", sm = false, icon, testID, title, disabled = false }: {
  label: string; onPress: PressAt; kind?: "quiet" | "ghost" | "primary"; sm?: boolean; icon?: IcoName; testID?: string; title?: string; disabled?: boolean;
}): ReactElement {
  const ink = kind === "primary" ? "var(--accent-ink)" : kind === "ghost" ? "var(--ink-3)" : "var(--ink)";
  const btn = (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={disabled}
      onPress={(e) => { (e as unknown as { stopPropagation?: () => void }).stopPropagation?.(); const p = pressPoint(e); onPress(p.x, p.y); }}
      style={[st.btn, sm ? st.btnSm : null, kind === "primary" ? st.btnP : kind === "ghost" ? st.btnQ : null, disabled ? { opacity: 0.45 } : null]}
      {...dom({ dataSet: { nbtn: kind === "primary" ? "primary" : kind === "ghost" ? "ghost" : "quiet" } })}
    >
      {icon ? <Ico name={icon} size={14} color={ink} /> : null}
      <Text numberOfLines={1} style={[st.btnText, sm ? st.btnTextSm : null, { color: ink }]}>{label}</Text>
    </Pressable>
  );
  return title ? <Tooltip text={title}>{btn}</Tooltip> : btn;
}

/** A picture from a data address or a page's image address, the full width of its box at its own height (capped when `maxHeight` is given), centred on the sunk fill. */
export function Picture({ uri, alt, maxHeight, height, testID }: { uri: string | null; alt: string; maxHeight?: number; height?: number; testID?: string }): ReactElement | null {
  if (!web) return null;
  if (uri === null) return createElement("div", { "data-testid": testID, style: { width: "100%", height: height ?? 120, background: "var(--sunk)" } });
  const fill = maxHeight === undefined && height === undefined;
  return createElement(
    "div", { "data-testid": testID, style: { display: "flex", justifyContent: "center", background: "var(--sunk)", width: "100%" } },
    createElement("img", { src: uri, alt, draggable: false, style: fill ? { width: "100%", height: "auto", display: "block" } : { width: "auto", maxWidth: "100%", height: height ?? "auto", maxHeight, display: "block" } }),
  );
}

/** The card a read link becomes: the page's image, its site with a coloured letter, its title, and (not compact) its description and address. */
export function LinkCard({ link, compact = false, row = false, testID }: { link: LinkPreview; compact?: boolean; row?: boolean; testID?: string }): ReactElement {
  const site = link.siteName || hostOf(link.url);
  const mark = siteMark(site);
  return (
    <View testID={testID} style={[st.lk, row ? st.lkRow : null]} {...dom({ dataSet: { nlk: "true" } })}>
      {link.image && web ? createElement("div", { style: row ? { width: 150, flex: "none", overflow: "hidden" } : { width: "100%" } }, createElement("img", { src: link.image, alt: "", draggable: false, style: row ? { height: "100%", width: "100%", objectFit: "cover", display: "block" } : { width: "100%", height: "auto", display: "block" } })) : null}
      <View style={st.lx}>
        <View style={st.ls}>
          <View style={[st.fav, { backgroundColor: mark.color }]}><Text style={st.favText}>{mark.letter}</Text></View>
          <Text numberOfLines={1} style={st.lsText}>{site}</Text>
        </View>
        <Text style={st.lt}>{link.title || shortUrl(link.url)}</Text>
        {link.description && !compact ? <Text style={st.ld}>{link.description}</Text> : null}
        {compact ? null : <Source icon="link" url={link.url} />}
      </View>
    </View>
  );
}

/** A small line with an icon and an address, cut with an ellipsis. */
export function Source({ icon, url, children }: { icon: IcoName; url: string; children?: ReactNode }): ReactElement {
  return (
    <View style={st.src}>
      <Ico name={icon} size={12} color="var(--ink-3)" />
      <Text numberOfLines={1} style={st.srcText}>{shortUrl(url)}</Text>
      {children}
    </View>
  );
}

/** The selected text of a clipped page, as a quote with the accent rule. */
export function Quote({ text, big = false }: { text: string; big?: boolean }): ReactElement {
  return <View style={st.quote}><Text style={[st.quoteText, big ? { fontSize: 15, lineHeight: 22 } : null]}>{text}</Text></View>;
}

/** Faces side by side, each over the last, ringed in the card's colour. */
export function Faces({ people, size = 16, ring = "var(--raised)" }: { people: readonly { id: string; name: string }[]; size?: number; ring?: string }): ReactElement {
  return (
    <View style={st.stack}>
      {/* ui-rows-lint: not a list (overlapping faces drawn as one stack) */}
      {people.slice(0, 3).map((p, i) => (
        <View key={p.id} style={[{ width: size, height: size, borderRadius: size / 2, marginLeft: i === 0 ? 0 : -4 }, dom({ style: { boxShadow: `0 0 0 2px ${ring}` } }).style as object]}>
          <Avatar name={p.name} seedId={p.id} kind="person" size={size} />
        </View>
      ))}
    </View>
  );
}

/** A tick box, drawn (ticked: the accent with a tick). */
export function TickBox({ on, size = 16 }: { on: boolean; size?: number }): ReactElement {
  return (
    <View style={[st.box, { width: size, height: size, borderRadius: size > 15 ? 5 : 4 }, on ? st.boxOn : st.boxOff]}>
      {on ? <Ico name="check" size={size - 5} color="var(--accent-ink)" /> : null}
    </View>
  );
}

/** A colour swatch: a round of the note colour, ringed when it is the one chosen. */
export function Swatch({ fill, on, size = 18 }: { fill: string; on: boolean; size?: number }): ReactElement {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill }, dom({ style: { boxShadow: on ? "inset 0 0 0 2px var(--accent)" : "inset 0 0 0 1px var(--line-2)" } }).style as object]} />;
}

export function Keycap({ text }: { text: string }): ReactElement {
  return <View style={st.keycap}><Text style={st.keycapText}>{text}</Text></View>;
}

export const st = StyleSheet.create({
  ib: { borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  ibOn: { backgroundColor: "var(--sel)" as string },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 9, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "var(--sel)" as string, flexShrink: 0 },
  btnSm: { height: 26, paddingHorizontal: 10, borderRadius: 8 },
  btnP: { backgroundColor: "var(--accent)" as string },
  btnQ: { backgroundColor: "transparent", paddingHorizontal: 9 },
  btnText: { fontSize: 13, fontWeight: "500" },
  btnTextSm: { fontSize: 12.5 },
  lk: { marginTop: 10, borderRadius: 10, overflow: "hidden", ...(web ? ({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) : null) },
  lkRow: { flexDirection: "row" },
  lx: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 9, flex: 1, minWidth: 0 },
  ls: { flexDirection: "row", alignItems: "center", gap: 6 },
  fav: { width: 14, height: 14, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  favText: { fontSize: 9, fontWeight: "700", color: "#FFFFFF", lineHeight: 12 },
  lsText: { fontSize: 11, color: "var(--ink-3)" as string, flexShrink: 1 },
  lt: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: "var(--ink)" as string, marginTop: 3 },
  ld: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 2 },
  src: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, minWidth: 0 },
  srcText: { fontSize: 11.5, color: "var(--ink-3)" as string, flexShrink: 1, minWidth: 0 },
  quote: { marginTop: 8, paddingVertical: 2, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: "var(--accent-line)" as string },
  quoteText: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  stack: { flexDirection: "row", alignItems: "center" },
  box: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  boxOn: { backgroundColor: "var(--accent)" as string },
  boxOff: { ...(web ? ({ boxShadow: "inset 0 0 0 1.5px var(--line-2)" } as object) : { borderWidth: 1.5, borderColor: "var(--line-2)" as string }) },
  keycap: { borderWidth: 1, borderColor: "var(--line-2)" as string, borderRadius: 4, paddingHorizontal: 4 },
  keycapText: { fontSize: 10.5, lineHeight: 15, color: "var(--ink-4)" as string },
});
