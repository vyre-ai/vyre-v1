// Home > Routines and automations today: what my agents run today, one line each: scheduled (with the time), running, done (with the result line) or failed.
// Click selects; double-click or Enter opens the run, or the agent when it has not run yet. Data: home.routines_today (screen home.routines-today), live from the kept copy.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useHomeData, usePrincipals, useScreenQuery, useSelection } from "./data.tsx";
import { routineRows, rowKeysBy } from "./model.ts";
import { EmptyLine, Face, Glyph, HRow, Section, SectionHeader, Skeleton, s, tone } from "./parts.tsx";

export const ROUTINES_SCREEN = "home.routines-today";
type Out = CapMap["home.routines_today"]["out"];

export function RoutinesToday(): ReactElement {
  const data = useHomeData();
  const p = usePrincipals();
  const sel = useSelection();
  const menu = useMenu();
  const q = useScreenQuery<Out>(ROUTINES_SCREEN, "routines");
  const list = q.status === "ready" ? routineRows(q.data.routines, data.clock()) : [];
  const keyList = rowKeysBy("routine", list, (r) => r.id).join("|");
  useEffect(() => { sel.register(4, keyList ? keyList.split("|") : []); }, [keyList]);

  const rows: ReactElement[] = [];
  for (const r of list) {
    const openRun = (): void => (r.runId ? data.nav.openRun(r.runId) : data.nav.openAgent(r.agentId));
    const entries: MenuEntry[] = [];
    if (r.runId) entries.push({ label: "Open the run", onSelect: () => data.nav.openRun(r.runId!) });
    entries.push({ label: `Open ${p.name(r.agentId)}`, onSelect: () => data.nav.openAgent(r.agentId) });
    const subStyle = r.tone === "warn" ? tone.warn : r.tone === "live" ? tone.accent : undefined;
    rows.push(
      <HRow key={r.id} rowKey={`routine:${r.id}`} label={`${r.title}, ${r.sub}`} onOpen={openRun} onMenu={(x, y) => menu.show(entries, x, y, "context", { label: r.title })} tools={false}>
        <View style={local.icon}><Glyph name={r.tone === "live" ? "run" : "clock"} size={15} /></View>
        <View style={s.text}>
          <Text numberOfLines={1} style={s.title}>{r.title}</Text>
          <Text numberOfLines={1} style={[s.sub, subStyle]}>{r.sub}</Text>
        </View>
        <Face name={p.name(r.agentId)} kind="agent" size={20} />
      </HRow>,
    );
  }

  return (
    <Section id="s-routines">
      <SectionHeader id="routines" title="Routines and automations today" count={q.status === "ready" ? list.length : undefined} />
      {q.status === "loading" ? <Skeleton rows={2} id="routines" /> : rows.length ? <View accessibilityRole="list">{rows}</View> : <EmptyLine id="routines" text="No routines today" />}
      {menu.element}
    </Section>
  );
}

const local = StyleSheet.create({
  icon: { width: 18, alignItems: "center", justifyContent: "center" },
});
