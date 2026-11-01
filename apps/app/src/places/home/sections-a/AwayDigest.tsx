// Home > While you were away: the digest the assistant wrote, three lines on top and at most seven ranked items (decisions with Undo, finished work, changes on records I
// follow, routine results, things waiting). "See all" opens the full activity; "Mark seen" resets it. It reads from the kept copy, so it opens offline. Data: home.digest.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useActions } from "./actions.ts";
import { useHomeData, useScreenQuery, useSelection } from "./data.tsx";
import { DIGEST_KIND_LABEL, digestLimit, rowKeysBy, whenLabel } from "./model.ts";
import type { DigestItem } from "./model.ts";
import { EmptyLine, Glyph, HRow, LinkButton, RowText, Section, SectionHeader, Skeleton } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { useAllClear, useSectionKind } from "./allclear.ts";

export const AWAY_SCREEN = "home.away-digest";
type Out = CapMap["home.digest"]["out"];

const KINDS: readonly DigestItem["kind"][] = ["waiting", "decision", "finished", "record_change", "routine"];
const ICON: Record<DigestItem["kind"], IconName> = { decision: "decision", finished: "done", record_change: "change", routine: "run", waiting: "waiting" };

export function AwayDigest(): ReactElement {
  const data = useHomeData();
  const sel = useSelection();
  const actions = useActions();
  const menu = useMenu();
  const q = useScreenQuery<Out>(AWAY_SCREEN, "digest");
  const digest = q.status === "ready" ? q.data.digest : null;
  const shown = digestLimit(digest);
  const clock = data.clock();
  const keyList = rowKeysBy("away", shown.items, (_, i) => i).join("|");
  useEffect(() => { sel.register(3, keyList ? keyList.split("|") : []); }, [keyList]);

  const undo = (it: DigestItem): void => void actions.undoDigestItem(it);
  const open = (it: DigestItem) => (): void => { if (it.subject) data.nav.openSubject(it.subject); };

  const rows: ReactElement[] = [];
  shown.items.forEach((it, i) => {
    const entries: MenuEntry[] = [];
    if (it.subject) entries.push({ label: "Open", onSelect: open(it) });
    if (it.undo) entries.push({ label: "Undo", onSelect: () => undo(it) });
    rows.push(
      <HRow
        key={i} rowKey={`away:${i}`} label={`${it.title}, ${it.line}`} onOpen={it.subject ? open(it) : undefined}
        onMenu={entries.length ? (x, y) => menu.show(entries, x, y, "context", { label: it.title }) : undefined} tools={entries.length > 0}
      >
        <View style={local.icon} accessibilityLabel={DIGEST_KIND_LABEL[it.kind]}><Glyph name={ICON[it.kind]} size={15} /></View>
        <RowText title={it.title} sub={it.line} />
        {it.undo ? <LinkButton label="Undo" onPress={() => undo(it)} testID={`away-undo-${i}`} /> : null}
        {it.at !== undefined ? <Text style={local.when}>{whenLabel(it.at, clock)}</Text> : null}
      </HRow>,
    );
  });

  // the digest's headline as chips: a count per kind of thing with its icon; the words the assistant wrote are the tooltip
  const counts = new Map<DigestItem["kind"], number>();
  for (const it of digest?.items ?? []) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  const chips: ReactElement[] = [];
  for (const kind of KINDS) {
    const n = counts.get(kind);
    if (!n) continue;
    chips.push(
      <Tooltip key={kind} text={DIGEST_KIND_LABEL[kind]}>
        <View style={local.chip} testID={`away-chip-${kind}`} accessibilityLabel={`${DIGEST_KIND_LABEL[kind]}, ${n}`}><Glyph name={ICON[kind]} size={13} /><Text style={local.chipText}>{n}</Text></View>
      </Tooltip>,
    );
  }

  useSectionKind("away", q.status === "loading" ? "loading" : shown.show ? "items" : "empty");
  if (useAllClear()) return null;
  return (
    <Section id="s-away">
      <SectionHeader id="away" title="While you were away" count={shown.show ? shown.items.length : undefined}>
        {shown.show ? <LinkButton label="See all" onPress={() => data.nav.openActivity()} testID="away-all" /> : null}
        {shown.show && digest ? <LinkButton label="Mark seen" onPress={() => void actions.markDigestSeen(digest.id)} testID="away-seen" /> : null}
      </SectionHeader>
      {q.status === "loading" ? <Skeleton rows={3} id="away" /> : shown.show ? (
        <View>
          {chips.length ? <Tooltip text={shown.headline.join("\n")}><View style={local.chips} testID="away-summary">{chips}</View></Tooltip> : null}
          <View accessibilityRole="list">{rows}</View>
        </View>
      ) : <EmptyLine id="away" text="Nothing happened while you were away" />}
      {menu.element}
    </Section>
  );
}

const local = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  chipText: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  icon: { width: 18, alignItems: "center", justifyContent: "center" },
  when: { minWidth: 64, textAlign: "right", color: "var(--ink-3)" as string, fontSize: 12.5 },
});
