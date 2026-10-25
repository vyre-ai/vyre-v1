// Home > Starred: everything you starred (spec 2.23), newest first. Terminals carry their live status, running or exited with the last line; one click reattaches.
// Data: stars.list and terminal.status (screen home.today-starred-ask, queries "stars" and "terminals"), live from the kept copy; status frames arrive as the terminal module emits them.
// A Personal Space cannot hold agent computers or the Apps, so those stars leave the list and one "Needs a Team Space" line says why.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { NeedsTeamSpace } from "../../../../../../ui/src/NeedsTeamSpace/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useHomeData, useHomeLine, useScreenQuery, useSelection } from "../sections-a/data.tsx";
import { EmptyLine, LinkButton, Section, SectionHeader, Skeleton, useNarrow } from "../sections-a/parts.tsx";
import { unstar } from "./actions.ts";
import { isPersonal, useExtras } from "./data.tsx";
import { STARRED_LIMIT, TODAY_SCREEN, splitForSpace, starRows, teamOnlyWhat, terminalIds } from "./model.ts";
import type { StarRow } from "./model.ts";
import { Icon, ListRow } from "./parts.tsx";

type StarsOut = CapMap["stars.list"]["out"];
type StatusOut = CapMap["terminal.status"]["out"];
export const STARRED_SECTION = 6;

export function Starred(): ReactElement {
  const data = useHomeData();
  const extras = useExtras();
  const line = useHomeLine();
  const sel = useSelection();
  const menu = useMenu();
  const narrow = useNarrow();
  const [all, setAll] = useState(false);
  const stars = useScreenQuery<StarsOut>(TODAY_SCREEN, "stars");
  const ids = stars.status === "ready" ? terminalIds(stars.data.stars) : [];
  const status = useScreenQuery<StatusOut>(TODAY_SCREEN, "terminals", { terminalIds: ids });
  const built = stars.status === "ready" ? starRows(stars.data.stars, status.status === "ready" ? status.data.rows : []) : [];
  const split = splitForSpace(built, isPersonal(extras));
  const shown = all ? split.rows : split.rows.slice(0, STARRED_LIMIT);
  const keys: string[] = [];
  for (const r of shown) keys.push(r.key);
  const keyList = keys.join("|");
  useEffect(() => { sel.register(STARRED_SECTION, keyList ? keyList.split("|") : []); }, [keyList]);

  const deps = { call: data.call, note: line.note };
  const open = (r: StarRow): void => data.nav.openSubject({ type: r.type, id: r.id });
  const rows: ReactElement[] = [];
  for (const r of shown) {
    const entries: MenuEntry[] = [
      { label: r.terminal ? "Reattach" : "Open", icon: "open", onSelect: () => open(r) },
      { separator: true },
      { label: "Remove star", icon: "trash", onSelect: () => void unstar(deps, { type: r.type, id: r.id }, r.title) },
    ];
    rows.push(
      <ListRow
        key={r.key}
        rowKey={r.key}
        title={r.title}
        note={r.note}
        label={`${r.title}, ${r.note}`}
        leading={<View style={local.icon}><Icon name={r.icon} color={r.tone === "live" ? "var(--accent)" : "var(--ink-3)"} /></View>}
        trailing={r.terminal && r.tone === "live" ? <View testID={`star-live-${r.id}`} accessibilityLabel="Running" style={local.live} /> : r.tone === "warn" ? <Text style={local.warn}>Failed</Text> : null}
        onOpen={() => open(r)}
        onMenu={(x, y) => menu.show(entries, x, y, "context", { label: r.title })}
        onRemove={() => void unstar(deps, { type: r.type, id: r.id }, r.title)}
      />,
    );
  }

  const more = split.rows.length - STARRED_LIMIT;
  return (
    <Section id="s-starred">
      <SectionHeader id="starred" title="Starred" count={stars.status === "ready" ? split.rows.length || undefined : undefined}>
        {more > 0 ? <LinkButton label={all ? "Show fewer" : `Show all ${split.rows.length}`} onPress={() => setAll(!all)} testID="starred-all" /> : null}
      </SectionHeader>
      {stars.status === "loading" ? <Skeleton rows={2} id="starred" /> : rows.length ? <View accessibilityRole="list">{rows}</View> : split.blocked.length ? null : <EmptyLine id="starred" text="Star a chat, record, file or terminal and it shows here" />}
      {split.blocked.length ? <View style={local.team}><NeedsTeamSpace what={teamOnlyWhat(split.blocked)} density={narrow ? "compact" : "regular"} onAction={() => extras.go("team_space")} /></View> : null}
      {menu.element}
    </Section>
  );
}

const local = StyleSheet.create({
  icon: { width: 26, alignItems: "flex-start", justifyContent: "center" },
  live: { width: 7, height: 7, borderRadius: 99, backgroundColor: "var(--ok)" as string },
  warn: { fontSize: 12, fontWeight: "600", color: "var(--warn)" as string },
  team: { marginTop: 6 },
});
