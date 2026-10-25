// Home > Projects at risk: records that are overdue, blocked or slipped, each with the reason in words. The section menu (the ... at the right of the header) shows the
// counting rule that home.at_risk returns. Click selects, double-click or Enter opens the record. Data: home.at_risk (screen home.projects-at-risk), live from the kept copy.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useHomeData, usePrincipals, useScreenQuery, useSelection } from "./data.tsx";
import { riskRows, rowKeysBy } from "./model.ts";
import { EmptyLine, Face, HRow, MoreButton, RowText, Section, SectionHeader, Skeleton, s } from "./parts.tsx";

export const RISK_SCREEN = "home.projects-at-risk";
type Out = CapMap["home.at_risk"]["out"];

export function ProjectsAtRisk(): ReactElement | null {
  const data = useHomeData();
  const p = usePrincipals();
  const sel = useSelection();
  const menu = useMenu();
  const q = useScreenQuery<Out>(RISK_SCREEN, "projects", { limit: 20 });
  const clock = data.clock();
  const projects = q.status === "ready" ? riskRows(q.data.projects, clock) : [];
  const rule = q.status === "ready" ? q.data.rule : "";
  const keyList = rowKeysBy("risk", projects, (r) => r.id).join("|");
  useEffect(() => { sel.register(2, keyList ? keyList.split("|") : []); }, [keyList]);

  const rows: ReactElement[] = [];
  for (const r of projects) {
    const open = (): void => data.nav.openRecord(r.id);
    rows.push(
      <HRow key={r.id} rowKey={`risk:${r.id}`} label={`${r.title}, ${r.why}`} onOpen={open} onMenu={(x, y) => menu.show([{ label: "Open", onSelect: open }], x, y, "context", { label: r.title })}>
        <View style={[local.dot, { backgroundColor: (r.health === "block" ? "var(--danger)" : "var(--warn)") as string }]} testID={`risk-dot-${r.health}`} />
        <RowText title={r.title} trailingTitle={<Text style={local.type}>{`  ${r.type}`}</Text>} sub={r.why} />
        {r.lead ? <Face name={p.name(r.lead)} kind={p.byId(r.lead)?.kind ?? "person"} size={20} /> : null}
        <Text style={local.due}>{r.due ?? ""}</Text>
      </HRow>,
    );
  }

  const showRule = (x: number, y: number): void => menu.show([{ head: "Projects at risk" }, { head: rule || "Overdue, blocked or slipped." }], x, y, "other", { label: "Projects at risk" });
  // an empty section is hidden on a calm day: nothing at risk is good news, not a heading
  if (q.status === "ready" && rows.length === 0) return null;
  return (
    <Section id="s-risk">
      <SectionHeader id="risk" title="Projects at risk" count={q.status === "ready" ? rows.length : undefined}>
        <MoreButton inline visible label="Projects at risk: how this is counted" onOpen={showRule} />
      </SectionHeader>
      {q.status === "loading" ? <Skeleton rows={2} id="risk" /> : rows.length ? <View accessibilityRole="list">{rows}</View> : <EmptyLine id="risk" text="No projects at risk" />}
      {menu.element}
    </Section>
  );
}

const local = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 99 },
  type: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string },
  due: { minWidth: 64, textAlign: "right", color: "var(--ink-2)" as string, fontSize: 12.5 },
});
