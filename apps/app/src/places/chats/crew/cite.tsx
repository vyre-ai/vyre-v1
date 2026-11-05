// Citations in the parent's answer (owner, 4 Nov 2026, prototype p-crew): the agent marks which helper a claim came from with [1], [2] after it, numbered in the order the helpers' rows appear. Each mark is a small
// chip: hovering shows who it was and what it found, pressing opens that helper's peek. A number with no helper behind it stays the plain text the agent wrote.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { faceSeed, lineOf, nameOf, roleOf, stateWord } from "./model.ts";
import type { CrewMember } from "./model.ts";

export const CARD_W = 262;
export const CARD_GAP = 8;
export const EDGE = 8;

/** Where the card goes: above the chip when its real height fits, else below when that fits, else the side with more room; and shifted sideways to stay inside the viewport. `left` is relative to the chip. */
export function cardPlace(chip: { top: number; bottom: number; left: number }, card: { w: number; h: number }, view: { w: number; h: number }): { side: "above" | "below"; left: number } {
  const above = chip.top - CARD_GAP - EDGE;
  const below = view.h - chip.bottom - CARD_GAP - EDGE;
  const side = card.h <= above ? "above" : card.h <= below ? "below" : above >= below ? "above" : "below";
  const x = Math.max(EDGE, Math.min(chip.left - 8, view.w - card.w - EDGE));
  return { side, left: x - chip.left };
}

export const CITE_HOST = "https://cite.vyre.invalid/";
const MARK = /(?<![\[\w(])\[([1-9])\](?![(\w])/g;

/** The helpers a mark can point at, in the order their rows appear: the order they started in. */
export const citable = (members: readonly CrewMember[]): CrewMember[] => members.filter((m) => m.kind === "helper").sort((a, b) => a.startedAt - b.startedAt);

/** [n] becomes a link the renderer draws as a chip, only where n names a helper; code spans and fences are left alone. */
export function citeBody(body: string, count: number): string {
  if (count === 0 || !MARK.test(body)) { MARK.lastIndex = 0; return body; }
  MARK.lastIndex = 0;
  return body.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => (i % 2 === 1 ? part : part.replace(MARK, (all, n: string) => (Number(n) <= count ? `[${n}](${CITE_HOST}${n})` : all)))).join("");
}

const view = (): { w: number; h: number } => (typeof window === "undefined" ? { w: 1024, h: 768 } : { w: window.innerWidth, h: window.innerHeight });

/** The card's position from what is measured: hidden until its height is known, then above or below the chip and inside the viewport. */
function placeStyle(spot: { chip: { top: number; bottom: number; left: number }; h: number | null } | null): object[] {
  if (!spot || spot.h === null) return [{ opacity: 0 }];
  const p = cardPlace(spot.chip, { w: CARD_W, h: spot.h }, view());
  return [p.side === "below" ? { top: 19 + CARD_GAP, bottom: undefined, left: p.left } : { bottom: 19 + CARD_GAP, left: p.left }];
}

function Chip({ n, member, onOpen, onCard }: { n: number; member: CrewMember; onOpen: (m: CrewMember) => void; onCard?: ((open: boolean) => void) | undefined }): ReactElement {
  const [over, setOver] = useState(false);
  useEffect(() => { onCard?.(over); return () => { if (over) onCard?.(false); }; }, [over]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [spot, setSpot] = useState<{ chip: { top: number; bottom: number; left: number }; h: number | null } | null>(null);
  return (
    <View style={{ position: "relative" } as object}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${nameOf(member)}: ${lineOf(member)}`} testID={`cite-${n}`} onPress={() => onOpen(member)} onHoverIn={(e: unknown) => { const r = (e as { currentTarget?: { getBoundingClientRect?: () => { top: number; bottom: number; left: number } } }).currentTarget?.getBoundingClientRect?.(); setSpot(r ? { chip: { top: r.top, bottom: r.bottom, left: r.left }, h: null } : null); setOver(true); }} onHoverOut={() => setOver(false)} style={st.chip}>
        <Text style={st.n}>{n}</Text>
      </Pressable>
      {over ? (
        <View testID={`cite-${n}-pop`} onLayout={(e) => { const h = e.nativeEvent.layout.height; setSpot((cur) => (cur && cur.h !== h ? { ...cur, h } : cur)); }} style={[st.pop, ...placeStyle(spot)]}>
          <View style={st.top}>
            <Avatar name={nameOf(member)} seedId={faceSeed(member)} kind="agent" size={22} />
            <Text numberOfLines={1} style={[st.who, { flexShrink: 1 }]}>{nameOf(member)} <Text style={st.role}>{roleOf(member)}</Text></Text>
            <Text testID={`cite-${n}-state`} style={st.role}>{stateWord(member.state)}</Text>
          </View>
          <Text numberOfLines={3} style={st.line}>{lineOf(member)}</Text>
          <Text style={st.role}>Opens in Crew</Text>
        </View>
      ) : null}
    </View>
  );
}

/** While a citation card is open the message's hover toolbar is not drawn (it covered the card): the toolbar shows when `barShows` says so. */
export const barShows = (hovered: boolean, cardOpen: boolean): boolean => hovered && !cardOpen;

/** The link renderer for the cite hrefs, or none when there is nothing to cite. */
export function citeRender(members: readonly CrewMember[], onOpen: (m: CrewMember) => void, onCard?: (open: boolean) => void): ((href: string, kids: ReactNode, key: number) => ReactElement | null) | undefined {
  const list = citable(members);
  if (list.length === 0) return undefined;
  return (href, kids, key) => {
    if (!href.startsWith(CITE_HOST)) return null;
    const n = Number(href.slice(CITE_HOST.length));
    const m = list[n - 1];
    return m ? <Chip key={key} n={n} member={m} onOpen={onOpen} onCard={onCard} /> : <>{kids}</>;
  };
}

const st = StyleSheet.create({
  chip: { minWidth: 19, height: 19, paddingHorizontal: 5, marginHorizontal: 1, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  n: { fontSize: 11.5, fontWeight: "600", color: "var(--accent)" as string },
  pop: { position: "absolute", bottom: 27, left: -8, borderWidth: 1, borderColor: "var(--line-2)" as string, width: 262, padding: 10, borderRadius: 14, gap: 4, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)", zIndex: 90 } as object,
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  who: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  role: { fontSize: 12.5, fontWeight: "400", color: "var(--ink-3)" as string },
  line: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
});
