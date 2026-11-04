// Console Overview (spec 3.10): what needs you, the server at a glance, and the last admin acts. One live query (console.overview), each tile opens its page.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useConsoleData, useScreenQuery } from "../../shell/data.tsx";
import { activityTitle, ago, money, namedResource } from "../../shell/format.ts";
import { Dot, Glyph } from "../../shell/glyphs.tsx";
import type { Tone } from "../../shell/glyphs.tsx";
import { Empty, Group, Lead, LinkButton, Section, pointer } from "../../shell/ui.tsx";
import { useAction, useRead } from "../shared.tsx";
import { TeamNowSection } from "./TeamNow.tsx";

type Out = CapMap["console.overview"]["out"];
type Attention = Out["attention"][number];

export const HEALTH_LABEL: Readonly<Record<Out["health"], string>> = { healthy: "Healthy", degraded: "Degraded", down: "Down" };
export const HEALTH_TONE: Readonly<Record<Out["health"], Tone>> = { healthy: "ok", degraded: "warn", down: "bad" };

/** The page each kind of attention item is dealt with on. */
export const ATTENTION_PAGE: Readonly<Record<Attention["kind"], string>> = {
  join_stuck: "people",
  home_channel: "overview",
  failing_check: "server",
  expiring_certificate: "network",
  failed_run: "agents",
  stuck_update: "server",
  limit_hit: "spend",
  access_review_due: "reviews",
  no_ai_account: "models",
};

export const ATTENTION_SENTENCE: Readonly<Record<Attention["kind"], string>> = {
  join_stuck: "A new member's join has not finished",
  home_channel: "Older Spaces start with #general",
  failing_check: "A health check is failing",
  expiring_certificate: "A certificate is about to expire",
  failed_run: "A run failed",
  stuck_update: "An update is stuck",
  limit_hit: "A limit was reached",
  access_review_due: "An access review is due",
  no_ai_account: "Your team has no AI account",
};

export function Overview(): ReactElement {
  const data = useConsoleData();
  const q = useScreenQuery<Out>("console.overview", "overview", {});
  const width = useWindowDimensions().width, compact = width > 0 && width < 720;   // an unmeasured screen (a static render) keeps the desktop layout
  const act = useAction(() => (data.screens as { invalidate?: () => void }).invalidate?.());
  // machine alerts (a disk nearly full, memory pressure, a machine offline with pinned work, a failed backup, an update waiting): a line here, a dot on Machines, one Inbox line for each admin
  const machineAlerts = useRead<CapMap["network.machine_alerts"]["out"]>("network.machine_alerts").data?.alerts ?? [];
  if (q.status !== "ready") return <Text style={s.loading} accessibilityRole="progressbar">Loading</Text>;
  // the two kinds a press here settles: a stuck join is retried now, and #general is renamed to #vyre or kept (never renamed without asking)
  const fix = (a: Attention, i: number): ReactElement | null => {
    if (a.kind === "join_stuck" && a.ref) return <LinkButton label="Retry" testID={`attn-retry-${i}`} onPress={() => void act.run("members.joins.retry", { personId: a.ref }, (out: { pending: number }) => (out.pending === 0 ? "Done. They have everything now." : "Tried again. It still did not work; it is tried every two minutes."))} />;
    if (a.kind === "home_channel" && a.ref) return (
      <View style={s.pair}>
        <LinkButton label="Rename to #vyre" testID={`attn-rename-${i}`} onPress={() => void act.run("channels.update", { channelId: a.ref, name: "vyre" }, "Renamed. Your first channel is #vyre.")} />
        <LinkButton label="Keep #general" testID={`attn-keep-${i}`} onPress={() => void act.run("settings.set", { key: "chat.keep_general", value: true }, "Kept. #general stays your first channel.")} />
      </View>
    );
    return null;
  };
  const o = q.data;
  const now = data.clock().now;
  const tiles: { page: string; label: string; icon: string; big: string; sub: string; tone?: Tone }[] = [
    { page: "server", label: "Server", icon: "server", big: HEALTH_LABEL[o.health], sub: o.attention.length ? `${o.attention.length} need${o.attention.length === 1 ? "s" : ""} you` : "Nothing waiting", tone: HEALTH_TONE[o.health] },
    { page: "machines", label: "Machine alerts", icon: "server", big: machineAlerts.length ? String(machineAlerts.length) : "All clear", sub: machineAlerts.length ? [...new Set(machineAlerts.map((a) => a.kind))].join(", ") : "Every machine is fine", ...(machineAlerts.length ? { tone: "warn" as Tone } : {}) },
    { page: "people", label: "Members", icon: "people", big: String(o.usage.members), sub: "in this Space" },
    { page: "agents", label: "Agents", icon: "agent", big: String(o.usage.agents), sub: "in the register" },
    { page: "spend", label: "Turns today", icon: "pulse", big: o.usage.turnsToday.toLocaleString("en-US"), sub: "across people and agents" },
    { page: "spend", label: "Spend this month", icon: "ai", big: money(o.usage.costMicrosMonth), sub: "model providers" },
  ];
  return (
    <View testID="overview">
      <Section title="Needs you" count={o.attention.length + machineAlerts.length || ""}>
        <Group testID="attention">
          {o.attention.length + machineAlerts.length === 0 ? (
            <View style={s.none} testID="attention-none"><Glyph name="ok" size={15} color="var(--ok)" /><Text style={s.noneText}>Nothing needs you</Text></View>
          ) : [...o.attention.map((a, i) => (
            <Row
              key={`${a.kind}-${a.ref ?? i}`}
              id={`attn-${a.kind}-${a.ref ?? i}`}
              title={a.title}
              note={a.kind === "home_channel" ? a.next : `${ATTENTION_SENTENCE[a.kind]} since ${ago(now, a.since)}${compact ? `. ${a.next}` : ""}`}
              leading={<Lead><Glyph name="warn" size={16} color="var(--warn)" /></Lead>}
              {...(compact ? {} : { trailing: fix(a, i) ?? <LinkButton label={a.next} onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])} testID={`attn-go-${i}`} /> })}
              onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])}
            />
          )), ...machineAlerts.map((a) => (
            <Row key={a.alertId} id={`attn-machine-${a.alertId}`} title={a.title} note={a.detail} leading={<Lead><Glyph name={a.kind === "offline" ? "server" : "warn"} size={16} color="var(--warn)" /></Lead>}
              {...(compact ? {} : { trailing: <LinkButton label="Open" onPress={() => data.nav.openPage("machines", { machineId: a.serverId })} testID={`attn-machine-go-${a.serverId}`} /> })}
              onPress={() => data.nav.openPage("machines", { machineId: a.serverId })} />
          ))]}
        </Group>
        {/* ui-rows-lint: not a list (the buttons of the rows above, on a phone) */}
        {compact ? <View style={s.compactFix}>{o.attention.map((a, i) => { const f = fix(a, i); return f ? <View key={`fix-${i}`}>{f}</View> : null; })}</View> : null}
        {act.note ? <Text accessibilityRole="status" style={s.note} testID="attn-note">{act.note}</Text> : null}
      </Section>
      <TeamNowSection />
      <Section title="Health">
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
                title={activityTitle(who, e.action, namedResource(e.resource, data.name))}
                leading={<Lead><Avatar name={who} size={22} /></Lead>}
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
  pair: { flexDirection: "row", alignItems: "center", gap: 18 },
  compactFix: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 6 },
  note: { fontSize: 12.5, color: "var(--ink-2)" as string, marginTop: 8, paddingHorizontal: 4 },
});
