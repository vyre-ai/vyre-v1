// Console Overview (spec 3.10): what needs you, the server at a glance, and the last admin acts. One live query (console.overview), each tile opens its page.
import { toAlert } from "../../../machines/api.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useConsoleData, useScreenQuery } from "../../shell/data.tsx";
import { activityTitle, ago, forHowLong, money, namedResource } from "../../shell/format.ts";
import { Dot, Glyph } from "../../shell/glyphs.tsx";
import type { Tone } from "../../shell/glyphs.tsx";
import { Empty, Group, Lead, LinkButton, Section, pointer } from "../../shell/ui.tsx";
import { Button, useAction, useRead } from "../shared.tsx";
import { isPhoneWidth } from "../../../../../../ui/src/SidePane/layout.ts";

type Out = CapMap["console.overview"]["out"];
type Attention = Out["attention"][number];

export const HEALTH_LABEL: Readonly<Record<Out["health"], string>> = { healthy: "Healthy", degraded: "Degraded", down: "Down" };
export const HEALTH_TONE: Readonly<Record<Out["health"], Tone>> = { healthy: "ok", degraded: "warn", down: "bad" };

/** The page each kind of attention item is dealt with on. */
export const ATTENTION_PAGE: Readonly<Record<Attention["kind"], string>> = {
  join_stuck: "requests",
  home_channel: "overview",
  failing_check: "diagnostics",
  expiring_certificate: "network",
  failed_run: "activity",
  stuck_update: "servers",
  limit_hit: "spend",
  access_review_due: "reviews",
  no_ai_account: "aiaccounts",
  space_deletion_scheduled: "spacedel",
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
  space_deletion_scheduled: "Everything is removed then",
};


/** What the Relay tile needs from network.status: the mode, and the relay's own version when the host has read it from the relay's health answer. */
export interface RelayIn { mode?: "own_domain" | "relay"; version?: string; relayVersion?: string; /** From network.status: the relay is an older release than the Space server. */ relayOlder?: boolean; relayMs?: number; relayReachable?: boolean }
const versionParts = (v: string): number[] => v.replace(/^v/, "").split(".").map((x) => Number.parseInt(x, 10) || 0);
/** True when `relay` is an older version than `server`. */
export function relayIsOlder(relay: string, server: string): boolean {
  const a = versionParts(relay), b = versionParts(server);
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0); }
  return false;
}
/** The Relay tile: "Vyre relay · v1.4.1 · 18 ms", and amber with "Update available" when the relay is older than the Space server (it opens Computers, Servers, Updates). Nothing when the Space has no relay. */
export function relayTile(n: RelayIn | undefined, serverVersion: string | undefined): { page: string; label: string; icon: string; big: string; sub: string; tone?: Tone } | null {
  if (!n || n.mode !== "relay") return null;
  const bits = ["Vyre relay", ...(n.relayVersion ? [`v${n.relayVersion.replace(/^v/, "")}`] : []), ...(n.relayMs !== undefined ? [`${n.relayMs} ms`] : [])];
  if (n.relayOlder === true || (n.relayOlder === undefined && n.relayVersion && serverVersion && relayIsOlder(n.relayVersion, serverVersion))) return { page: "updates", label: "Relay", icon: "globe", big: "Update available", sub: bits.join(" · "), tone: "warn" };
  return { page: "network", label: "Relay", icon: "globe", big: n.relayReachable === false ? "Not reachable" : "Reachable", sub: bits.join(" · "), ...(n.relayReachable === false ? { tone: "bad" as Tone } : { tone: "ok" as Tone }) };
}


/** One row per problem: a check that says "Disk space on the server is under 10 percent" and a machine alert that says "Berlin box has 8% disk left" are the same problem, so the machine alert (it names the machine) wins. */
export function dedupeNeeds<A extends { kind: string; title: string }, M extends { kind: string }>(attention: readonly A[], machine: readonly M[]): A[] {
  const covers: Record<string, RegExp> = { disk: /disk/i, memory: /memory/i, offline: /offline/i, update: /update/i, backup: /backup/i };
  const have = machine.map((m) => covers[m.kind]).filter((r): r is RegExp => r !== undefined);
  return attention.filter((a) => a.kind !== "failing_check" && a.kind !== "stuck_update" || !have.some((r) => r.test(a.title)));
}
/** The round tile behind a row's icon, in the warning colour. */
export function WarnTile({ icon }: { icon: string }): ReactElement {
  return <View style={s.warnTile}><Glyph name={icon} size={15} color="var(--warn)" /></View>;
}

export function Overview(): ReactElement {
  const data = useConsoleData();
  const q = useScreenQuery<Out>("console.overview", "overview", {});
  const width = useWindowDimensions().width, compact = isPhoneWidth(width);   // an unmeasured screen (a static render) keeps the desktop layout
  const act = useAction(() => (data.screens as { invalidate?: () => void }).invalidate?.());
  // machine alerts (a disk nearly full, memory pressure, a machine offline with pinned work, a failed backup, an update waiting): a line here, a dot on Machines, one Inbox line for each admin
  const machineAlerts = (useRead<CapMap["machines.alerts"]["out"]>("machines.alerts").data?.alerts ?? []).map(toAlert);
  const network = useRead<RelayIn>("network.status");
  const backups = useRead<CapMap["backup.health"]["out"]>("backup.health");
  const updates = useRead<CapMap["updates.status"]["out"]>("updates.status");
  const endpoints = useRead<CapMap["network.endpoints"]["out"]>("network.endpoints");
  const fleet = useRead<{ machines: Array<{ kind: string; version?: string; cores?: number; memBytes?: number; diskBytes?: number; load?: { cpuPct: number; memUsedBytes: number; diskFreeBytes: number } }> }>("machines.list");
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
  const o = { ...q.data, attention: dedupeNeeds(q.data.attention, machineAlerts) };
  const now = data.clock().now;
  type Tile = { page: string; label: string; icon: string; big: string; sub: string; tone?: Tone; bars?: Array<[string, number]> };
  const relayEnd = endpoints.data?.endpoints.find((e) => e.kind === "relay");
  const relay = relayTile(network.data ? { ...(network.data as RelayIn), ...(relayEnd?.rttMs !== undefined ? { relayMs: relayEnd.rttMs } : {}), ...(relayEnd ? { relayReachable: relayEnd.health !== "down" } : {}) } : undefined, (network.data as RelayIn | undefined)?.version ?? updates.data?.current);
  const backupAge = backups.data?.ageHours;
  const space = fleet.data?.machines.find((m) => m.kind === "space");
  const pct = (a: number | undefined, b: number | undefined): number | undefined => (a !== undefined && b ? Math.min(100, Math.round((a / b) * 100)) : undefined);
  const bars = space?.load ? [["CPU", Math.round(space.load.cpuPct)], ["Memory", pct(space.load.memUsedBytes, space.memBytes)], ["Disk", space.diskBytes ? 100 - (pct(space.load.diskFreeBytes, space.diskBytes) ?? 0) : undefined]].filter((b): b is [string, number] => b[1] !== undefined) : [];
  const health: Tile[] = [
    { page: "diagnostics", label: "Space server", icon: "server", big: HEALTH_LABEL[o.health], sub: space?.version ? `v${space.version}` : o.attention.length ? `${o.attention.length} need${o.attention.length === 1 ? "s" : ""} you` : "Nothing waiting", tone: HEALTH_TONE[o.health], ...(bars.length ? { bars } : {}) },
    ...(relay ? [relay] : []),
    { page: "machines", label: "Sync", icon: "pulse", big: "Up to date", sub: `${(fleet.data?.machines ?? []).filter((m) => m.kind === "computer").length} computers linked`, tone: "ok" },
    ...(backupAge !== undefined ? [{ page: "backups", label: "Backups", icon: "box", big: backupAge >= 1 ? `${backupAge} h ago` : "Just now", sub: "Last good backup", ...(backupAge > 24 ? { tone: "warn" as Tone } : {}) }] : []),
    { page: "machines", label: "Machine alerts", icon: "server", big: machineAlerts.length ? String(machineAlerts.length) : "All clear", sub: machineAlerts.length ? [...new Set(machineAlerts.map((a) => a.kind))].join(", ") : "Every machine is fine", ...(machineAlerts.length ? { tone: "warn" as Tone } : {}) },
  ];
  const month: Tile[] = [
    { page: "people", label: "Members", icon: "people", big: String(o.usage.members), sub: "in this Space" },
    { page: "agents", label: "Agents", icon: "agent", big: String(o.usage.agents), sub: "in the register" },
    { page: "spend", label: "Spend", icon: "ai", big: money(o.usage.costMicrosMonth), sub: "AI this month" },
    { page: "activity", label: "Turns today", icon: "pulse", big: o.usage.turnsToday.toLocaleString("en-US"), sub: "across people and agents" },
  ];
  const tileGrid = (list: Tile[], id: string): ReactElement => (
    <View style={s.grid} testID={id}>
      {/* ui-rows-lint: not a list (overview tiles) */}
      {list.map((t) => (
        <Pressable key={t.label} accessibilityRole="button" accessibilityLabel={`${t.label}: ${t.big}`} testID={`tile-${t.label}`} onPress={() => data.nav.openPage(t.page)} style={[s.tile, t.tone === "warn" && s.tileWarn, pointer]}>
          <View style={s.tileHead}><Glyph name={t.icon} size={14} color="var(--ink-3)" /><Text style={s.tileLabel}>{t.label}</Text></View>
          <View style={s.tileBig}>{t.tone ? <Dot tone={t.tone} size={8} /> : null}<Text style={s.big}>{t.big}</Text></View>
          <Text style={s.tileSub}>{t.sub}</Text>
          {/* ui-rows-lint: not a list (the meter bars inside one tile) */}
          {t.bars ? t.bars.map(([k, v]) => <View key={k} style={s.barRow}><Text style={s.barLabel}>{k}</Text><View style={s.barTrack}><View style={[s.barFill, { width: `${v}%` as unknown as number }, v >= 85 && s.barWarn]} /></View><Text style={s.barVal}>{v}%</Text></View>) : null}
        </Pressable>
      ))}
    </View>
  );
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
              note={a.kind === "home_channel" ? a.next : a.kind === "space_deletion_scheduled" ? ATTENTION_SENTENCE[a.kind] : `${ATTENTION_SENTENCE[a.kind]}${forHowLong(now, a.since)}${compact ? `. ${a.next}` : ""}`}
              leading={<Lead><WarnTile icon="warn" /></Lead>}
              {...(compact ? {} : { trailing: fix(a, i) ?? <Button label={a.next} onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])} testID={`attn-go-${i}`} /> })}
              onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])}
            />
          )), ...machineAlerts.map((a) => (
            <Row key={a.alertId} id={`attn-machine-${a.alertId}`} title={a.title} note={a.detail} leading={<Lead><WarnTile icon={a.kind === "offline" ? "server" : "warn"} /></Lead>}
              {...(compact ? {} : { trailing: <Button label="Open" onPress={() => data.nav.openPage("machines", { machineId: a.serverId })} testID={`attn-machine-go-${a.serverId}`} /> })}
              onPress={() => data.nav.openPage("machines", { machineId: a.serverId })} />
          ))]}
        </Group>
        {/* ui-rows-lint: not a list (the buttons of the rows above, on a phone) */}
        {compact ? <View style={s.compactFix}>{o.attention.map((a, i) => { const f = fix(a, i); return f ? <View key={`fix-${i}`}>{f}</View> : null; })}</View> : null}
        {act.note ? <Text accessibilityRole="status" style={s.note} testID="attn-note">{act.note}</Text> : null}
      </Section>
      <Section title="Health">{tileGrid(health, "tiles")}</Section>
      <Section title="This month">{tileGrid(month, "tiles-month")}</Section>
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
      <Section title="Quick actions">
        <Group testID="quick-actions">
          <Row id="qa-invite" title="Invite people" note="Send a link or an email" leading={<Lead><Glyph name="people" size={16} color="var(--ink-3)" /></Lead>} trailing={<LinkButton label="Invite people" onPress={() => data.nav.openPage("people")} testID="qa-invite-go" />} onPress={() => data.nav.openPage("people")} />
          <Row id="qa-ai" title="Add an AI account" note="Claude, OpenAI and others, kept in Vault" leading={<Lead><Glyph name="ai" size={16} color="var(--ink-3)" /></Lead>} trailing={<LinkButton label="Add account" onPress={() => data.nav.openPage("aiaccounts")} testID="qa-ai-go" />} onPress={() => data.nav.openPage("aiaccounts")} />
          <Row id="qa-server" title="Add a server" note="Run agents around the clock" leading={<Lead><Glyph name="server" size={16} color="var(--ink-3)" /></Lead>} trailing={<LinkButton label="Add server" onPress={() => data.nav.openPage("servers")} testID="qa-server-go" />} onPress={() => data.nav.openPage("servers")} />
        </Group>
      </Section>
    </View>
  );
}

const s = StyleSheet.create({
  warnTile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--warn-wash, var(--sel))" as string },
  barRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  barLabel: { width: 48, fontSize: 11, color: "var(--ink-3)" as string },
  barTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "var(--line)" as string, overflow: "hidden" },
  barFill: { height: 4, backgroundColor: "var(--accent)" as string },
  barWarn: { backgroundColor: "var(--warn)" as string },
  barVal: { width: 32, fontSize: 11, color: "var(--ink-2)" as string, textAlign: "right" },
  loading: { fontSize: 13, color: "var(--ink-3)" as string, padding: 14 },
  none: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 12 },
  noneText: { fontSize: 13, color: "var(--ink-2)" as string },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tileWarn: { borderColor: "var(--warn)" as string },
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
