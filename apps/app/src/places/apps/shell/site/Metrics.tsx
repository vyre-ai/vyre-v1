// "Right now" on a site's Overview: CPU, memory, requests and response time as four small cards, each with its chart. Pressing one opens the chart large with its lowest, average and highest.
// Reads sites.metrics (one sample a minute), again every thirty seconds. A site never measured says "Measuring"; nothing here shows a zero that would read as "all quiet" when it means "unknown".
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSpaceZone } from "../../../../../../../ui/src/Time/index.tsx";
import { deviceZone } from "../../../../../../../lib/zones.ts";
import { useRead } from "../editor-ui.tsx";
import { Chart } from "./Chart.tsx";
import { MenuButton } from "./parts.tsx";
import { cards, edgeLabels, summary } from "./ops-model.ts";
import type { Card, CardKey, Metrics } from "./ops-model.ts";

const WINDOWS = [
  { key: "1h", title: "Last hour" },
  { key: "6h", title: "Last 6 hours" },
  { key: "24h", title: "Last day" },
] as const;
const REFRESH_MS = 30_000;

export function useMetrics(siteId: string, window: string): { metrics: Metrics | null; error: string | null } {
  const r = useRead<Metrics>("sites.metrics", { siteId, window }, "sites");
  useEffect(() => {
    const t = setInterval(() => r.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [r.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return { metrics: r.data, error: r.error };
}

export function MetricCards({
  siteId,
  onOpen,
}: {
  siteId: string;
  /** When the page has a right pane, it opens the card's detail there; without it the detail opens under the cards. */
  onOpen?(card: CardKey, window: string): void;
}): ReactElement {
  const [window, setWindow] = useState<string>("1h");
  const [open, setOpen] = useState<CardKey | null>(null);
  const { metrics } = useMetrics(siteId, window);
  const list = cards(metrics);
  const picked = list.find((c) => c.key === open) ?? null;
  return (
    <View style={s.block} testID="site-metrics">
      <View style={s.head}>
        <Text accessibilityRole="header" style={s.title}>
          Right now
        </Text>
        <MenuButton
          title={WINDOWS.find((w) => w.key === window)?.title ?? "Last hour"}
          testID="site-metrics-window"
          entries={WINDOWS.map((w) => ({
            label: w.title,
            checked: w.key === window,
            onSelect: () => setWindow(w.key),
          }))}
        />
      </View>
      <View style={s.grid}>
        {list.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={`${c.title}: ${c.value} ${c.sub}`.trim()}
            testID={`site-metric-${c.key}`}
            onPress={() => (onOpen ? onOpen(c.key, window) : setOpen(open === c.key ? null : c.key))}
            style={({ hovered }: { hovered?: boolean }) => [
              s.card,
              hovered === true && s.cardOver,
              open === c.key && s.cardOn,
            ]}
          >
            <Text style={s.cardTitle}>{c.title}</Text>
            <Text style={[s.value, c.value === "Measuring" && s.measuring]} numberOfLines={1}>
              {c.value}
            </Text>
            <Text style={s.sub} numberOfLines={1}>
              {c.sub || " "}
            </Text>
            <View style={s.chart}>
              <Chart series={c.series} height={26} />
            </View>
          </Pressable>
        ))}
      </View>
      {picked && !onOpen ? <MetricDetail card={picked} window={window} /> : null}
    </View>
  );
}

/** One card large: its value, a chart with the start of the window and Now under it, and the lowest, average and highest. It is the content of the right pane. */
export function MetricDetail({ card, window }: { card: Card; window: string }): ReactElement {
  const zone = useSpaceZone() ?? deviceZone();
  const sum = summary(card.series);
  const edge = edgeLabels(Date.now(), window, zone);
  const label = WINDOWS.find((w) => w.key === window)?.title ?? "Last hour";
  return (
    <View style={s.detail} testID="site-metric-detail">
      <Text accessibilityRole="header" style={s.detailTitle}>
        {card.title}
      </Text>
      <Text style={s.sub}>{card.key === "response" ? `${label} · 95 in 100 are faster` : label}</Text>
      <View style={s.big}>
        <Text style={s.bigValue}>{card.value}</Text>
        <Chart series={card.series} height={120} strokeWidth={2} />
        <View style={s.edges}>
          <Text style={s.edge}>{edge.from}</Text>
          <Text style={s.edge}>{edge.to}</Text>
        </View>
      </View>
      {sum ? (
        <View>
          {(
            [
              ["Lowest", sum.low],
              ["Average", sum.avg],
              ["Highest", sum.high],
            ] as const
          ).map(([name, n]) => (
            <View key={name} style={s.stat}>
              <Text style={s.statName}>{name}</Text>
              <Text style={s.statValue}>{card.say(n)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={s.sub}>Nothing measured in this time yet.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  block: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--raised)" as string,
    paddingTop: 12,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  cardOver: { borderColor: "var(--line-2)" as string },
  cardOn: { borderColor: "var(--accent)" as string },
  cardTitle: { fontSize: 12, color: "var(--ink-3)" as string },
  value: { marginTop: 6, fontSize: 21, fontWeight: "600", color: "var(--ink)" as string },
  measuring: { fontSize: 15, fontWeight: "500", color: "var(--ink-3)" as string, lineHeight: 28 },
  sub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  chart: { marginTop: 8, marginHorizontal: -14 },
  detail: { gap: 10, paddingTop: 6 },
  detailTitle: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  big: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    overflow: "hidden",
    backgroundColor: "var(--sunk)" as string,
  },
  bigValue: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as string, padding: 12 },
  edges: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6 },
  edge: { fontSize: 11, color: "var(--ink-4)" as string },
  stat: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderColor: "var(--line)" as string,
  },
  statName: { fontSize: 13, color: "var(--ink-3)" as string },
  statValue: { fontSize: 13, color: "var(--ink)" as string },
});
