// Helpers side by side while they work (lane r42-subagents, prototype sub42, 19 Nov 2026): one tile each, three across, a face in a ring, what it was asked, a three-line live window, tokens and cost, a clock.
// The same piece of work as a row (CrewBlock) in another shape; both read a RunView, so they never disagree. A tile that needs you turns amber; one that could not finish says why and offers Retry for that one.
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { MemberRing, timeOf } from "../crew/strip.tsx";
import { money, tokens, faceSeed } from "../crew/model.ts";
import type { RunView } from "../crew/run-view.ts";

const web = Platform.OS === "web";

export function HelperTile({
  r,
  now,
  selected,
  index,
  onPress,
  onRetry,
  onDecide,
  decided,
}: {
  r: RunView;
  now: number;
  selected: boolean;
  index: number;
  onPress: (id: string) => void;
  onRetry?: ((id: string) => void) | undefined;
  /** Answer the held request: Allow or Deny, inside the tile. */
  onDecide?: ((id: string, verdict: "approve" | "reject") => void) | undefined;
  /** What was pressed for this tile, so it says so and cannot be answered twice. */
  decided?: "approve" | "reject" | "failed" | undefined;
}): ReactElement {
  const id = `crew-tile-${r.id}`;
  const live = r.state === "working";
  const canRetry = (r.state === "failed" || r.state === "stopped") && onRetry !== undefined;
  const meter = [r.tokens > 0 ? `${tokens(r.tokens)} tokens` : "", r.costMicros > 0 ? money(r.costMicros) : ""]
    .filter((x) => x !== "")
    .join(" · ");
  const lines = r.lines.length > 0 ? r.lines : [live ? "Starting" : ""];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${lines[lines.length - 1] ?? ""}`}
      testID={id}
      onPress={() => onPress(r.id)}
      {...(web ? { dataSet: { state: r.state, kind: r.kind } } : {})}
      style={[
        st.tile,
        r.state === "needs_you" && st.need,
        selected && st.sel,
        web ? ({ animationDelay: `${index * 60}ms` } as object) : null,
      ]}
    >
      <View style={st.head}>
        <View style={st.av}>
          <MemberRing state={r.state} id={id} size={32} />
          <Avatar name={r.name} seedId={faceSeed(r)} kind="agent" size={24} />
        </View>
        <View style={st.who}>
          <Text numberOfLines={1} style={st.name}>
            {r.name}
          </Text>
          {r.task !== "" ? (
            <Text numberOfLines={1} testID={`${id}-task`} style={st.task}>
              {r.task}
            </Text>
          ) : null}
        </View>
        <Text testID={`${id}-time`} style={st.time}>
          {timeOf(r, now)}
        </Text>
      </View>
      <View testID={`${id}-window`} style={st.win}>
        {/* ui-rows-lint: not a list (the three live lines of one tile: plain text, no row to press) */}
        {lines.map((x, i) => (
          <Text
            key={`${i}-${x}`}
            numberOfLines={r.state === "working" ? 1 : 3}
            testID={`${id}-line-${i}`}
            style={[
              st.line,
              live && i < lines.length - 1 && st.dim,
              r.state === "needs_you" && st.lineNeed,
              r.state === "failed" && st.lineFail,
            ]}
          >
            {x}
          </Text>
        ))}
        {r.state === "needs_you" && r.holdTaskId !== undefined && onDecide !== undefined ? (
          decided === "approve" || decided === "reject" ? (
            <Text testID={`${id}-decided`} style={st.line}>
              {decided === "approve" ? "Allowed" : "Denied"}
            </Text>
          ) : (
            <View style={st.decide}>
              {decided === "failed" ? (
                <Text testID={`${id}-decide-failed`} style={st.line}>
                  Could not answer. Try again.
                </Text>
              ) : null}
              <View style={st.decideRow}>
                <Pressable
                  accessibilityRole="button"
                  testID={`${id}-allow`}
                  onPress={() => onDecide(r.id, "approve")}
                  style={st.allow}
                >
                  <Text style={st.allowText}>Allow</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  testID={`${id}-deny`}
                  onPress={() => onDecide(r.id, "reject")}
                  style={st.retry}
                >
                  <Text style={st.retryText}>Deny</Text>
                </Pressable>
              </View>
            </View>
          )
        ) : null}
        {canRetry ? (
          <Pressable accessibilityRole="button" testID={`${id}-retry`} onPress={() => onRetry!(r.id)} style={st.retry}>
            <Text style={st.retryText}>{r.state === "stopped" ? "Start again" : "Retry"}</Text>
          </Pressable>
        ) : null}
      </View>
      {meter !== "" || r.model !== "" ? (
        <Text numberOfLines={1} testID={`${id}-meter`} style={st.meter}>
          {[meter, r.model].filter((x) => x !== "").join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The grid: three across, fewer when there are fewer. A plain flex wrap off the web. */
export function CrewTiles({
  runs,
  now,
  selectedId,
  onPress,
  onRetry,
  onDecide,
  decided,
}: {
  runs: readonly RunView[];
  now: number;
  selectedId?: string | null | undefined;
  onPress: (id: string) => void;
  onRetry?: ((id: string) => void) | undefined;
  onDecide?: ((id: string, verdict: "approve" | "reject") => void) | undefined;
  decided?: Readonly<Record<string, "approve" | "reject" | "failed">> | undefined;
}): ReactElement {
  const cols = Math.min(3, Math.max(1, runs.length));
  return (
    <View
      testID="crew-tiles"
      style={[
        st.grid,
        web ? ({ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as object) : null,
      ]}
    >
      {/* ui-rows-lint: not a list (the tiles of one crew block, drawn side by side as the prototype sub42 shows them) */}
      {runs.map((r, i) => (
        <HelperTile
          key={r.id}
          r={r}
          now={now}
          index={i}
          selected={selectedId === r.id}
          onPress={onPress}
          onRetry={onRetry}
          onDecide={onDecide}
          decided={decided?.[r.id]}
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  grid: {
    gap: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 4,
    borderRadius: 14,
    backgroundColor: "var(--sunk)" as string,
  },
  tile: {
    flexGrow: 1,
    minWidth: 0,
    gap: 7,
    padding: 10,
    paddingBottom: 9,
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
  },
  need: { backgroundColor: "var(--warn-wash, var(--sel))" as string },
  sel: { boxShadow: "inset 0 0 0 1.5px var(--accent)" } as object,
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  av: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  who: { flex: 1, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  task: { fontSize: 12, color: "var(--ink-3)" as string },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  win: { gap: 2, minHeight: 36 },
  line: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  dim: { color: "var(--ink-4)" as string },
  lineNeed: { color: "var(--ink)" as string },
  lineFail: { color: "var(--ink)" as string },
  decide: { gap: 4 },
  decideRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  allow: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--accent)" as string,
  },
  allowText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent-ink)" as string },
  retry: {
    alignSelf: "flex-start",
    marginTop: 6,
    height: 26,
    paddingHorizontal: 11,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--sel)" as string,
  },
  retryText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  meter: { fontSize: 11.5, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
});
