// Console Overview > Working now (owner D24): the same team "Now" the Chats sidebar folds away, open here. Who is around (a steady dot) and which agents are working, in words:
// "Intake, in #sales for Omar, on the Space". Read on open, on a change in the Space, and every 30 seconds; nothing blinks.
import { useEffect, useMemo } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { teamNow } from "../../../shell/team/now.ts";
import type { PresenceRow, WorkingRow } from "../../../shell/team/now.ts";
import { useConsoleData } from "../../shell/data.tsx";
import { Dot } from "../../shell/glyphs.tsx";
import { Empty, Group, Lead, Section } from "../../shell/ui.tsx";
import { useRead } from "../shared.tsx";

export const TEAM_NOW_EVERY_MS = 30_000;

export function TeamNowSection(): ReactElement {
  const data = useConsoleData();
  const presence = useRead<{ people: PresenceRow[] }>("devices.presence", {}, { direct: true });
  const working = useRead<{ working: WorkingRow[] }>("engine.now", {}, { direct: true });
  const refreshP = presence.refresh, refreshW = working.refresh;
  useEffect(() => {
    const t = setInterval(() => { refreshP(); refreshW(); }, TEAM_NOW_EVERY_MS);
    return () => clearInterval(t);
  }, [refreshP, refreshW]);
  const now = useMemo(() => teamNow({ presence: presence.data?.people, working: working.data?.working, me: data.me.id, personName: (id) => (id === data.me.id ? "you" : data.name(id)), agentName: (id) => data.name(id) }), [presence.data, working.data, data]);
  const rows: ReactElement[] = [];
  for (const a of now.agents) rows.push(<Row key={`a:${a.id}`} id={`now-agent-${a.id}`} title={a.name} titleSuffix={a.line} leading={<Lead><Avatar name={a.name} seedId={a.id} kind="agent" size={22} /></Lead>} onPress={() => data.nav.openPage("agents")} />);
  for (const p of now.people) {
    rows.push(<Row key={`p:${p.id}`} id={`now-person-${p.id}`} title={p.name} titleSuffix={p.state === "away" ? "Away" : "Online"} leading={<Lead><Avatar name={p.name} seedId={p.id} kind="person" size={22} /></Lead>}
      trailing={<View style={{ paddingRight: 8 }}><Dot tone={p.state === "away" ? "warn" : "ok"} label={p.state === "away" ? "Away" : "Online"} /></View>} onPress={() => data.nav.openPage("people")} />);
  }
  const loading = presence.data === undefined && working.data === undefined && !presence.error && !working.error;
  return (
    <Section title="Working now" count={rows.length || ""} testID="team-now">
      <Group testID="team-now-rows">
        {loading ? <Text style={{ fontSize: 13, color: "var(--ink-3)" as string, padding: 12 }}>Loading</Text> : rows.length === 0 ? <Empty testID="team-now-none" icon="people">Nobody else is around, and no agent is working</Empty> : rows}
      </Group>
    </Section>
  );
}
