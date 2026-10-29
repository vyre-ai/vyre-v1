// Console Overview (spec 3.10): what needs you, the server at a glance, and the last admin acts. One live query (console.overview), each tile opens its page.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useConsoleData, useScreenQuery } from "../../shell/data.tsx";
import { actionPhrase, ago, money } from "../../shell/format.ts";
import { Dot, Glyph } from "../../shell/glyphs.tsx";
import type { Tone } from "../../shell/glyphs.tsx";
import { Empty, Group, LinkButton, Section, pointer } from "../../shell/ui.tsx";

type Out = CapMap["console.overview"]["out"];
type Attention = Out["attention"][number];

export const HEALTH_LABEL: Readonly<Record<Out["health"], string>> = { healthy: "Healthy", degraded: "Degraded", down: "Down" };
export const HEALTH_TONE: Readonly<Record<Out["health"], Tone>> = { healthy: "ok", degraded: "warn", down: "bad" };

/** The page each kind of attention item is dealt with on. */
export const ATTENTION_PAGE: Readonly<Record<Attention["kind"], string>> = {
  failing_check: "server",
  expiring_certificate: "network",
  failed_run: "agents",
  stuck_update: "server",
  limit_hit: "spend",
  access_review_due: "reviews",
};

export const ATTENTION_SENTENCE: Readonly<Record<Attention["kind"], string>> = {
  failing_check: "A health check is failing",
  expiring_certificate: "A certificate is about to expire",
  failed_run: "A run failed",
  stuck_update: "An update is stuck",
  limit_hit: "A limit was reached",
  access_review_due: "An access review is due",
};

export function Overview(): ReactElement {
  const data = useConsoleData();
  const q = useScreenQuery<Out>("console.overview", "overview", {});
  if (q.status !== "ready") return <Text style={s.loading} accessibilityRole="progressbar">Loading</Text>;
  const o = q.data;
  const now = data.clock().now;
  const tiles: { page: string; label: string; icon: string; big: string; sub: string; tone?: Tone }[] = [
    { page: "server", label: "Server", icon: "server", big: HEALTH_LABEL[o.health], sub: o.attention.length ? `${o.attention.length} need${o.attention.length === 1 ? "s" : ""} you` : "Nothing waiting", tone: HEALTH_TONE[o.health] },
    { page: "people", label: "Members", icon: "people", big: String(o.usage.members), sub: "in this Space" },
    { page: "agents", label: "Agents", icon: "agent", big: String(o.usage.agents), sub: "in the register" },
    { page: "spend", label: "Turns today", icon: "pulse", big: o.usage.turnsToday.toLocaleString("en-US"), sub: "across people and agents" },
    { page: "spend", label: "Spend this month", icon: "ai", big: money(o.usage.costMicrosMonth), sub: "model providers" },
  ];
  return (
    <View testID="overview">
      <Section title="Needs you" count={o.attention.length || ""}>
        <Group testID="attention">
          {o.attention.length === 0 ? (
            <View style={s.none} testID="attention-none"><Glyph name="ok" size={15} color="var(--ok)" /><Text style={s.noneText}>Nothing needs you</Text></View>
          ) : o.attention.map((a, i) => (
            <Row
              key={`${a.kind}-${a.ref ?? i}`}
              id={`attn-${a.kind}-${a.ref ?? i}`}
              title={a.title}
              note={`${ATTENTION_SENTENCE[a.kind]} since ${ago(now, a.since)}`}
              leading={<Glyph name="warn" size={16} color="var(--warn)" />}
              trailing={<LinkButton label={a.next} onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])} testID={`attn-go-${i}`} />}
              onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])}
            />
          ))}
        </Group>
      </Section>
      <Section title="Server">
        <View style={s.grid} testID="tiles">
          {/* ui-rows-lint: not a list (overview tiles) */}
          {tiles.map((t) => (
            <Pressable key={t.label} accessibilityRole="button" accessibilityLabel={`${t.label}: ${t.big}`} testID={`tile-${t.label}`} onPress={() => data.nav.openPage(t.page)} style={[s.tile, pointer]}>
              <View style={s.tileHead}><Glyph name={t.icon} size={14} color="var(--ink-3)" /><Text style={s.tileLabel}>{t.label}</Text></View>
              <View style={s.tileBig}>{t.tone ? <Dot tone={t.tone} size={8} /> : null}<Text style={s.big}>{t.big}</Text></View>
              <Text style={s.tileSub}>{t.sub}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title="Recent admin activity" right={<LinkButton label="Audit log" onPress={() => data.nav.openPage("audit")} testID="to-audit" />}>
        <Group testID="activity">
          {o.activity.length === 0 ? <Empty testID="activity-none">No admin activity yet</Empty> : o.activity.slice(0, 5).map((e, i) => {
            const who = data.name(e.actor);
            return (
              <Row
                key={`${e.at}-${i}`}
                id={`act-${i}`}
                title={`${who} ${actionPhrase(e.action)}${e.resource ? ` ${data.name(e.resource)}` : ""}`}
                leading={<Avatar name={who} size={22} />}
                trailing={<Text style={s.time}>{ago(now, e.at)}</Text>}
                onPress={() => data.nav.openPage("audit")}
              />
            );
          })}
        </Group>
      </Section>
    </View>
  );
}

const s = StyleSheet.create({
  loading: { fontSize: 13, color: "var(--ink-3)" as string, padding: 14 },
  none: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 12 },
  noneText: { fontSize: 13, color: "var(--ink-2)" as string },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: 196, minHeight: 92, padding: 12, gap: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  tileLabel: { fontSize: 12, color: "var(--ink-3)" as string },
  tileBig: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  big: { fontSize: 20, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  tileSub: { fontSize: 12, color: "var(--ink-3)" as string },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
});
