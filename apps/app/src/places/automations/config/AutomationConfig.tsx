// The config pane of an Automation (spec 3.7): a header with the Automation's name and whose it is, then three tabs, Settings, Alerts and Runs. It sits in the side pane beside the canvas
// and the canvas' own Settings tab can show the same body. Each tab reads the Automation through the live screen query, so a change made elsewhere shows at once.
import { useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CONFIG, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { SubTabs } from "../canvas/parts.tsx";
import { AlertsTab } from "./AlertsTab.tsx";
import { Glyph } from "./glyphs.tsx";
import { scopeLine } from "./model.ts";
import { RunsTab } from "./RunsTab.tsx";
import { SettingsTab } from "./SettingsTab.tsx";

type GetOut = CapMap["automations.get"]["out"];
export type ConfigTab = "settings" | "alerts" | "runs";

export interface AutomationConfigProps {
  automationId: string;
  initialTab?: ConfigTab;
  /** Open with the Promote sheet or the Share sheet already showing (a link from the sidebar, and the screenshots). */
  openPromote?: boolean;
  openShare?: boolean;
}

export function AutomationConfig({ automationId, initialTab = "settings", openPromote = false, openShare = false }: AutomationConfigProps): ReactElement {
  const data = useAutomationsData();
  const q = useScreenQuery<GetOut>(CONFIG, "automation", { automationId });
  const [tab, setTab] = useState<ConfigTab>(initialTab);
  if (q.status !== "ready") return <View testID="config-loading" style={s.frame}><View style={s.skHead} /></View>;
  const a = q.data.automation as GetOut["automation"] | undefined;
  if (!a) return <View testID="config-gone" style={s.frame}><Text style={s.gone}>This Automation is not available</Text></View>;
  return (
    <View testID="automation-config" accessibilityLabel={`${a.name}, configuration`} style={s.frame}>
      <View style={s.head}>
        <View aria-hidden style={s.tile}><Glyph name="bolt" size={17} color="var(--accent)" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={s.name}>{a.name}</Text>
          <Text numberOfLines={1} style={s.sub}>{scopeLine(a, data.name, data.me.id)}</Text>
        </View>
      </View>
      <SubTabs
        label="Configuration" active={tab} onSelect={(k) => setTab(k as ConfigTab)}
        tabs={[{ key: "settings", label: "Settings" }, { key: "alerts", label: "Alerts" }, { key: "runs", label: "Runs" }]}
      />
      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
        {tab === "settings" ? <SettingsTab key={a.id} automation={a} openPromote={openPromote} openShare={openShare} /> : null}
        {tab === "alerts" ? <AlertsTab key={a.id} automation={a} /> : null}
        {tab === "runs" ? <RunsTab key={a.id} automationId={a.id} version={a.version} /> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 14, paddingBottom: 12, paddingLeft: 16, paddingRight: 14 },
  tile: { width: 30, height: 30, borderRadius: 9, backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  scroll: { flex: 1, minHeight: 0 },
  skHead: { height: 48, margin: 14, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  gone: { fontSize: 13, color: "var(--ink-3)" as string, padding: 24 },
});
