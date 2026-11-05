// Citations in the parent's answer (owner, 4 Nov 2026, prototype p-crew): the agent marks which helper a claim came from with [1], [2] after it, numbered in the order the helpers' rows appear. Each mark is a small
// chip: hovering shows who it was and what it found, pressing opens that helper's peek. A number with no helper behind it stays the plain text the agent wrote.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { lineOf, nameOf, roleOf } from "./model.ts";
import type { CrewMember } from "./model.ts";

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

function Chip({ n, member, onOpen, onCard }: { n: number; member: CrewMember; onOpen: (m: CrewMember) => void; onCard?: ((open: boolean) => void) | undefined }): ReactElement {
  const [over, setOver] = useState(false);
  useEffect(() => { onCard?.(over); return () => { if (over) onCard?.(false); }; }, [over]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ position: "relative" } as object}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${nameOf(member)}: ${lineOf(member)}`} testID={`cite-${n}`} onPress={() => onOpen(member)} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} style={st.chip}>
        <Text style={st.n}>{n}</Text>
      </Pressable>
      {over ? (
        <View testID={`cite-${n}-pop`} style={st.pop}>
          <Text numberOfLines={1} style={st.who}>{nameOf(member)} <Text style={st.role}>{roleOf(member)}</Text></Text>
          <Text numberOfLines={3} style={st.line}>{lineOf(member)}</Text>
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
  pop: { position: "absolute", top: 24, left: -8, width: 262, padding: 10, borderRadius: 14, gap: 4, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)", zIndex: 70 } as object,
  who: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  role: { fontSize: 12.5, fontWeight: "400", color: "var(--ink-3)" as string },
  line: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
});
